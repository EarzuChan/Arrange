#pragma once

#include <arrange/juce/AppResolver.h>
#include <arrange/juce/DevServerClient.h>
#include <arrange/juce/RuntimePackageLoader.h>
#include <arrange/juce/LiveModuleClient.h>

#include <atomic>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    enum class PackageSource {
        None,
        Live,
        Dist,
    };

    const char* packageSourceLabel(PackageSource source) noexcept;

    struct PackageLoadOutcome {
        enum class IntentKind {
            PackageLoad,
            Reload,
            HmrReload,
        };

        bool loaded = false;
        bool pending = false;
        bool serverUnavailable = false;
        IntentKind intentKind = IntentKind::PackageLoad;
        PackageSource activeSource = PackageSource::None;
        std::filesystem::path packageDir;
        std::optional<ErrorScreenModel> error;
        std::vector<RuntimeLoadLog> logs;
        std::vector<RuntimeLoadToast> toasts;
        std::optional<arrange::core::MutationTransaction> initialTransaction;
#if ARRANGE_WITH_QUICKJS_NG
        std::unique_ptr<arrange::quickjs::QuickJsScriptHost> scriptHost;
#endif
    };

    class PackageRuntimeSource final {
       public:
        ~PackageRuntimeSource();

        PackageLoadOutcome configure(EditorConfig config);
        PackageLoadOutcome reload();
        PackageLoadOutcome reloadFromDevServer();
        PackageLoadOutcome manualReload(bool toggleLive);

        bool wantsReloadPolling() const;
        std::vector<LiveModulePacket> takeLivePackets();
        PackageLoadOutcome completeLiveLoad(LiveModulePacket packet);
        void sendHotMessages(std::vector<quickjs::HotMessage> messages);

        const EditorConfig& config() const noexcept {
            return config_;
        }

        PackageSource activeSource() const noexcept {
            return activeSource_;
        }

        bool liveRuntimeEnabled() const noexcept {
            return liveRuntimeEnabled_;
        }

        bool lastLiveUnavailable() const noexcept {
            return lastLiveUnavailable_;
        }

       private:
        PackageLoadOutcome loadConfiguredPackage();
        PackageLoadOutcome loadLivePackage();
        PackageLoadOutcome loadDistPackage();
        PackageLoadOutcome noSourceOutcome() const;
        PackageLoadOutcome disabledLiveWithoutDistOutcome() const;

        void startDevServerClientIfNeeded();
        void stopDevServerClient();
        void prependToasts(PackageLoadOutcome& outcome, std::vector<RuntimeLoadToast> toasts) const;

        EditorConfig config_;
        AppResolver resolver_;
        RuntimePackageLoader runtimeLoader_;
        std::unique_ptr<LiveModuleClient> devServerClient_;
        PackageSource activeSource_ = PackageSource::None;
        bool liveRuntimeEnabled_ = false;
        bool lastLiveUnavailable_ = false;
    };

#endif
}  // namespace arrange::juce
