#include <arrange/juce/PackageRuntimeSource.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <iterator>
#include <utility>

namespace arrange::juce {
    namespace {
        RuntimeLoadDiagnostic makeDiagnostic(LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast = true) {
            return RuntimeLoadDiagnostic{level, std::move(title), std::move(message), toast, coalesceToast};
        }

        PackageLoadOutcome packageOutcomeFromRuntimeLoad(RuntimePackageLoadResult loaded, PackageSource source) {
            PackageLoadOutcome outcome;
            outcome.loaded = loaded.ok;
            outcome.serverUnavailable = loaded.serverUnavailable;
            outcome.activeSource = loaded.ok ? source : PackageSource::None;
            outcome.packageDir = std::move(loaded.packageDir);
            outcome.error = std::move(loaded.error);
            if (loaded.diagnostic) {
                outcome.diagnostics.push_back(std::move(*loaded.diagnostic));
            }
            outcome.initialTransaction = std::move(loaded.initialTransaction);
#if ARRANGE_WITH_QUICKJS_NG
            outcome.scriptHost = std::move(loaded.scriptHost);
#endif
            return outcome;
        }
    }  // namespace

    const char* packageSourceLabel(PackageSource source) noexcept {
        switch (source) {
            case PackageSource::Live:
                return "live";
            case PackageSource::Dist:
                return "dist";
            case PackageSource::None:
                return "none";
        }
        return "none";
    }

    PackageRuntimeSource::~PackageRuntimeSource() {
        stopDevServerClient();
    }

    PackageLoadOutcome PackageRuntimeSource::configure(EditorConfig config) {
        config_ = std::move(config);
        if (config_.preferDevServer && !config_.app.hasLive()) {
            config_.app.useLive(config_.devServerUrl);
        }

        stopDevServerClient();
        liveRuntimeEnabled_ = config_.app.hasLive();
        lastLiveUnavailable_ = false;
        activeSource_ = PackageSource::None;

        startDevServerClientIfNeeded();
        auto outcome = loadConfiguredPackage();
        outcome.intentKind = PackageLoadOutcome::IntentKind::PackageLoad;
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::reload() {
        auto outcome = loadConfiguredPackage();
        outcome.intentKind = PackageLoadOutcome::IntentKind::Reload;
        prependDiagnostics(outcome, {makeDiagnostic(LogLevel::Info, "Reload requested", "Reloading Arrange app package.", true)});
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::reloadFromDevServer() {
        auto outcome = loadConfiguredPackage();
        outcome.intentKind = PackageLoadOutcome::IntentKind::HmrReload;
        prependDiagnostics(outcome, {makeDiagnostic(LogLevel::Info, "HMR reload", "Dev server requested Arrange reload.", true)});
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::manualReload(bool toggleLive) {
        std::vector<RuntimeLoadDiagnostic> prelude;
        if (toggleLive && config_.app.hasLive()) {
            liveRuntimeEnabled_ = !liveRuntimeEnabled_;
            stopDevServerClient();
            startDevServerClientIfNeeded();
            prelude.push_back(makeDiagnostic(LogLevel::Info, liveRuntimeEnabled_ ? "Live enabled" : "Live disabled", liveRuntimeEnabled_ ? "Manual reload will try live before dist." : "Manual reload will skip live and use dist.", true));
        } else {
            prelude.push_back(makeDiagnostic(LogLevel::Info, "Manual reload", "F5 requested Arrange reload.", true));
        }

        auto outcome = loadConfiguredPackage();
        outcome.intentKind = PackageLoadOutcome::IntentKind::Reload;
        prependDiagnostics(outcome, std::move(prelude));
        return outcome;
    }

    bool PackageRuntimeSource::wantsReloadPolling() const {
        return config_.app.hasLive();
    }

    PackageLoadOutcome PackageRuntimeSource::loadConfiguredPackage() {
        if (!config_.app.hasAnySource()) {
            return noSourceOutcome();
        }

        if (config_.app.hasLive() && liveRuntimeEnabled_) {
            return loadLivePackage();
        }

        if (config_.app.hasDist()) {
            return loadDistPackage();
        }

        return disabledLiveWithoutDistOutcome();
    }

    PackageLoadOutcome PackageRuntimeSource::loadLivePackage() {
        PackageLoadOutcome outcome;
        outcome.pending = true;
        if (devServerClient_) devServerClient_->requestReload();
        return outcome;
    }

    std::vector<LiveModulePacket> PackageRuntimeSource::takeLivePackets() {
        return devServerClient_ ? devServerClient_->takePackets() : std::vector<LiveModulePacket>{};
    }

    void PackageRuntimeSource::sendHotMessages(std::vector<quickjs::HotMessage> messages) {
        if (devServerClient_)
            for (const auto& message : messages) devServerClient_->send(message);
    }

    PackageLoadOutcome PackageRuntimeSource::completeLiveLoad(LiveModulePacket packet) {
        if (packet.unavailable && config_.app.hasDist()) {
            lastLiveUnavailable_ = true;
            auto outcome = loadDistPackage();
            prependDiagnostics(outcome, {makeDiagnostic(LogLevel::Warn, "Using dist fallback", packet.error, true)});
            return outcome;
        }
        auto outcome = packageOutcomeFromRuntimeLoad(runtimeLoader_.loadLiveSnapshot(config_, resolver_, packet.snapshot, packet.error), PackageSource::Live);
        outcome.intentKind = PackageLoadOutcome::IntentKind::HmrReload;
        if (outcome.loaded) {
            activeSource_ = PackageSource::Live;
            lastLiveUnavailable_ = false;
        } else
            activeSource_ = PackageSource::None;
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::loadDistPackage() {
        auto outcome = packageOutcomeFromRuntimeLoad(runtimeLoader_.loadDist(config_, resolver_), PackageSource::Dist);
        if (!outcome.loaded) {
            return outcome;
        }

        activeSource_ = PackageSource::Dist;
        const auto message = !outcome.diagnostics.empty() && !outcome.diagnostics.front().message.empty() ? outcome.diagnostics.front().message : outcome.packageDir.string();
        outcome.diagnostics.clear();
        outcome.diagnostics.push_back(makeDiagnostic(LogLevel::Info, lastLiveUnavailable_ ? "Loaded dist fallback" : "Loaded dist app", message, lastLiveUnavailable_));
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::noSourceOutcome() const {
        PackageLoadOutcome outcome;
        outcome.activeSource = PackageSource::None;
        outcome.error = makeErrorScreenModel(ErrorSource::AppPackage, "你啥也没给我给你加载啥app（笑）Call config.app.useLive(...) or config.app.useDist(...).");
        outcome.diagnostics.push_back(makeDiagnostic(LogLevel::Error, "No app source", "Call config.app.useLive(...) or config.app.useDist(...).", true));
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::disabledLiveWithoutDistOutcome() const {
        PackageLoadOutcome outcome;
        outcome.activeSource = PackageSource::None;
        outcome.error = makeErrorScreenModel(ErrorSource::AppPackage, "Live source is disabled and no dist package is configured.", "Enable live reload again or call config.app.useDist(...).", config_.app.distPath());
        outcome.diagnostics.push_back(makeDiagnostic(LogLevel::Error, "No enabled app source", "Live source is disabled and no dist package is configured.", true));
        return outcome;
    }

    void PackageRuntimeSource::startDevServerClientIfNeeded() {
        if (!config_.app.hasLive() || !liveRuntimeEnabled_) {
            return;
        }

        const auto resolved = resolver_.resolveDebug(config_.app, config_.devServerUrl);
        if (!resolved.ok || resolved.devServerUrl.empty()) {
            return;
        }

        devServerClient_ = std::make_unique<LiveModuleClient>();
        devServerClient_->start(resolved.devServerUrl);
    }

    void PackageRuntimeSource::stopDevServerClient() {
        if (devServerClient_) {
            devServerClient_.reset();
        }
    }

    void PackageRuntimeSource::prependDiagnostics(PackageLoadOutcome& outcome, std::vector<RuntimeLoadDiagnostic> diagnostics) const {
        if (diagnostics.empty()) {
            return;
        }
        diagnostics.insert(diagnostics.end(), std::make_move_iterator(outcome.diagnostics.begin()), std::make_move_iterator(outcome.diagnostics.end()));
        outcome.diagnostics = std::move(diagnostics);
    }
}  // namespace arrange::juce

#endif
