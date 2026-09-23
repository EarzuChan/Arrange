#pragma once

#include <optional>
#include <string>
#include <string_view>

#if ARRANGE_JUCE_WITH_JUCE
#include <atomic>
#include <functional>
#include <memory>
#include <deque>
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

    DevServerEndpoint parseDevServerUrl(std::string_view url);

#if ARRANGE_JUCE_WITH_JUCE

    class DevServerClient final : private ::juce::Thread {
       public:
        DevServerClient();
        ~DevServerClient() override;

        void start(std::string devServerUrl, std::function<void(std::string)> callback);
        void send(std::string message);
        void stop();

        bool isClientRunning() const noexcept {
            return running_.load();
        }

        std::string lastError() const;

       private:
        void run() override;
        bool connectAndPump(const DevServerEndpoint& endpoint);

        mutable ::juce::CriticalSection lock_;
        std::string devServerUrl_;
        std::function<void(std::string)> messageCallback_;
        std::deque<std::string> outgoing_;
        std::string lastError_;
        std::atomic<bool> running_{false};
        std::shared_ptr<::juce::StreamingSocket> socket_;
    };

#endif
}  // namespace arrange
