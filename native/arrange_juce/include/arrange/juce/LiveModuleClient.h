#pragma once

#include <arrange/juce/DevServerClient.h>
#include <arrange/quickjs/LiveModule.h>
#include <deque>
#include <mutex>
#include <string_view>

#if ARRANGE_JUCE_WITH_JUCE
namespace arrange::juce {
    struct LiveModulePacket {
        quickjs::LiveModuleSnapshot snapshot;
        quickjs::HotMessage message;
        bool reload = false;
        bool unavailable = false;
        std::string error;
    };

    // 线程只负责网络与源码快照，绝不触碰 QuickJS 或 UI 场景
    class LiveModuleClient final : private ::juce::Thread {
       public:
        LiveModuleClient();
        ~LiveModuleClient() override;
        void start(std::string url);
        void requestReload();
        void send(const quickjs::HotMessage& message);
        std::vector<LiveModulePacket> takePackets();

       private:
        static constexpr std::string_view TAG = "LiveModuleClient";
        void run() override;
        void receive(std::string message);
        LiveModulePacket fetch(quickjs::HotMessage message);
        std::string url_;
        DevServerClient websocket_;
        std::mutex mutex_;
        std::deque<quickjs::HotMessage> requests_;
        std::vector<LiveModulePacket> packets_;
        bool connected_ = false;
        bool reloadPending_ = false;
        bool hasSnapshot_ = false;
        std::shared_ptr<::juce::WebInputStream> request_;
    };
}  // namespace arrange::juce
#endif
