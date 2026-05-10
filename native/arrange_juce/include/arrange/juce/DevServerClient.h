#pragma once

#include <optional>
#include <string>
#include <string_view>

#if ARRANGE_JUCE_WITH_JUCE
#include <atomic>
#include <functional>
#include <memory>
#include <juce_core/juce_core.h>
#endif

namespace arrange {
    struct DevServerEndpoint {
        bool ok = false;
        bool secure = false;
        std::string protocol;
        std::string host;
        int port = 0;
        std::string basePath = "/";
        std::string websocketPath = "/";
        std::string error;
    };

    struct DevReloadEvent {
        std::string payloadJson = "{}";
        std::string path;
        std::string rawMessage;
    };

    inline constexpr const char* ArrangeDevBundlePath = "/@arrange/app.js";

    DevServerEndpoint parseDevServerUrl(std::string_view url);
    std::string devBundleHttpUrl(std::string_view devServerUrl);
    std::optional<DevReloadEvent> parseViteHmrReloadMessage(std::string_view message);

#if ARRANGE_JUCE_WITH_JUCE

    class DevServerReloadClient final : private ::juce::Thread {
    public:
        using ReloadCallback = std::function<void(DevReloadEvent)>;

        DevServerReloadClient();
        ~DevServerReloadClient() override;

        void start(std::string devServerUrl, ReloadCallback callback);
        void stop();

        bool isClientRunning() const noexcept { return running_.load(); }
        std::string lastError() const;

    private:
        void run() override;
        bool connectAndPump(const DevServerEndpoint& endpoint);

        mutable ::juce::CriticalSection lock_;
        std::string devServerUrl_;
        ReloadCallback callback_;
        std::string lastError_;
        std::atomic<bool> running_{false};
        std::unique_ptr<::juce::StreamingSocket> socket_;
    };

#endif
} // namespace arrange
