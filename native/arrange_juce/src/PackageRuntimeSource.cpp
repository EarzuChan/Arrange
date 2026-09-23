#include <arrange/juce/PackageRuntimeSource.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <iterator>
#include <utility>

namespace arrange::juce {
    namespace {
        RuntimeLoadToast makeToast(LogLevel level, std::string title, std::string message, bool coalesce = true) {
            return RuntimeLoadToast{level, std::move(title), std::move(message), coalesce};
        }

        PackageLoadOutcome packageOutcomeFromRuntimeLoad(RuntimePackageLoadResult loaded, PackageSource source) {
            PackageLoadOutcome outcome;
            outcome.loaded = loaded.ok;
            outcome.serverUnavailable = loaded.serverUnavailable;
            outcome.activeSource = loaded.ok ? source : PackageSource::None;
            outcome.packageDir = std::move(loaded.packageDir);
            outcome.error = std::move(loaded.error);
            if (loaded.log) outcome.logs.push_back(std::move(*loaded.log));
            if (loaded.toast) outcome.toasts.push_back(std::move(*loaded.toast));
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
        prependToasts(outcome, {makeToast(LogLevel::Info, "已请求重新加载", "正在重新加载 Arrange 应用包")});
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::reloadFromDevServer() {
        auto outcome = loadConfiguredPackage();
        outcome.intentKind = PackageLoadOutcome::IntentKind::HmrReload;
        prependToasts(outcome, {makeToast(LogLevel::Info, "收到热更新重载请求", "开发服务器请求重新加载 Arrange 应用")});
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::manualReload(bool toggleLive) {
        std::vector<RuntimeLoadToast> prelude;
        if (toggleLive && config_.app.hasLive()) {
            liveRuntimeEnabled_ = !liveRuntimeEnabled_;
            stopDevServerClient();
            startDevServerClientIfNeeded();
            prelude.push_back(makeToast(LogLevel::Info, liveRuntimeEnabled_ ? "Live 已启用" : "Live 已关闭", liveRuntimeEnabled_ ? "手动重载将优先加载 Live" : "手动重载将跳过 Live 并加载 Dist"));
        } else {
            prelude.push_back(makeToast(LogLevel::Info, "手动重新加载", "已按下 F5"));
        }

        auto outcome = loadConfiguredPackage();
        outcome.intentKind = PackageLoadOutcome::IntentKind::Reload;
        prependToasts(outcome, std::move(prelude));
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
            prependToasts(outcome, {makeToast(LogLevel::Warn, "Live 不可用，正在回退到 Dist", packet.error)});
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
        const auto message = !outcome.logs.empty() && !outcome.logs.front().message.empty() ? outcome.logs.front().message : outcome.packageDir.string();
        outcome.logs.clear();
        if (lastLiveUnavailable_) outcome.toasts.push_back(makeToast(LogLevel::Info, "已加载 Dist 回退包", message));
        else outcome.logs.push_back({LogLevel::Info, "已加载 Dist 应用 " + message});
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::noSourceOutcome() const {
        PackageLoadOutcome outcome;
        outcome.activeSource = PackageSource::None;
        outcome.error = makeErrorScreenModel(ErrorSource::AppPackage, "没有配置可用的应用源，请调用 config.app.useLive(...) 或 config.app.useDist(...)");
        outcome.toasts.push_back(makeToast(LogLevel::Error, "没有可加载的应用源", "请配置 config.app.useLive(...) 或 config.app.useDist(...)"));
        return outcome;
    }

    PackageLoadOutcome PackageRuntimeSource::disabledLiveWithoutDistOutcome() const {
        PackageLoadOutcome outcome;
        outcome.activeSource = PackageSource::None;
        outcome.error = makeErrorScreenModel(ErrorSource::AppPackage, "Live 已关闭，且没有配置 Dist 应用包", "请重新启用 Live，或配置 config.app.useDist(...)", config_.app.distPath());
        outcome.toasts.push_back(makeToast(LogLevel::Error, "没有启用的应用源", "Live 已关闭，且没有配置 Dist 应用包"));
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

    void PackageRuntimeSource::prependToasts(PackageLoadOutcome& outcome, std::vector<RuntimeLoadToast> toasts) const {
        if (toasts.empty()) {
            return;
        }
        toasts.insert(toasts.end(), std::make_move_iterator(outcome.toasts.begin()), std::make_move_iterator(outcome.toasts.end()));
        outcome.toasts = std::move(toasts);
    }
}  // namespace arrange::juce

#endif
