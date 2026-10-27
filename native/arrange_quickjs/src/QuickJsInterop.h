#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <arrange/core/Interop.h>

#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <memory>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    // 一个 QuickJS 会话与 InteropHost 之间的桥：安装 JS 入口，在语义检查点交付批次，会话结束时代为收尾
    class QuickJsInterop final : public arrange::core::InteropSessionSink {
       public:
        QuickJsInterop(JSContext* context, arrange::core::InteropHost& host, std::function<void()> wakeOwner);
        ~QuickJsInterop() override;

        QuickJsInterop(const QuickJsInterop&) = delete;
        QuickJsInterop& operator=(const QuickJsInterop&) = delete;

        void install(JSValueConst native);
        void setWakeOwner(std::function<void()> wake);
        [[nodiscard]] bool hasPending() const noexcept;
        // 本会话存在持续拉取需求（播放中的走带或观测订阅）
        [[nodiscard]] bool wantsFrames() const;
        // 交付失败时返回 false，异常留在 context 上
        bool pump();
        // 结束未完成 gesture 并释放 JS 值；context 释放前调用
        void close() noexcept;

        void wake() override;
        void message(std::string name, arrange::core::InteropValue value) override;

       private:
        enum class StreamKind { Meter, Waveform, Spectrum, Transport };

        struct Subscription {
            StreamKind kind = StreamKind::Meter;
            std::string name;
            std::size_t size = 0;
        };

        struct StreamState {
            std::size_t references = 0;
            std::size_t size = 0;
            std::uint64_t waveformCount = 0;
            float meter = -1.0f;
            bool delivered = false;
        };

        struct Replies {
            std::vector<std::pair<std::uint64_t, arrange::core::InteropOutcome>> items;
            std::function<void()> wake;
        };

        static QuickJsInterop& self(JSContext* context);
        static JSValue jsInstall(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsParameters(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsParameterValue(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsToPlain(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsToNormalized(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsText(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsParse(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsGesture(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsSet(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsHost(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsTransport(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsSubscribe(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsUnsubscribe(JSContext* context, JSValueConst, int argc, JSValueConst* argv);
        static JSValue jsInvoke(JSContext* context, JSValueConst, int argc, JSValueConst* argv);

        bool parameterIndex(JSValueConst value, std::size_t& index) const;
        bool call(const char* method, std::initializer_list<JSValueConst> args);
        JSValue hostInfoValue() const;
        JSValue transportValue(const arrange::core::InteropTransport& transport) const;
        static std::string streamKey(StreamKind kind, const std::string& name);

        JSContext* context_;
        arrange::core::InteropHost* host_;
        std::function<void()> wakeOwner_;
        JSValue driver_ = JS_UNDEFINED;
        bool wakeRequested_ = true;
        std::set<std::size_t> gestures_;
        std::vector<std::pair<std::string, arrange::core::InteropValue>> messages_;
        std::shared_ptr<Replies> replies_ = std::make_shared<Replies>();
        std::uint64_t nextCall_ = 1;
        std::uint64_t nextSubscription_ = 1;
        std::unordered_map<std::uint64_t, Subscription> subscriptions_;
        std::map<std::string, StreamState> streams_;
        std::vector<std::size_t> changed_;
        arrange::core::InteropHostInfo deliveredHost_;
        arrange::core::InteropTransport deliveredTransport_;
    };

    JSValue interopValueToJs(JSContext* context, const arrange::core::InteropValue& value);
    // 只接受 null、布尔、数字、字符串、数组与普通对象；不支持的值抛出 TypeError 并返回 nullopt
    std::optional<arrange::core::InteropValue> interopValueFromJs(JSContext* context, JSValueConst value, int depth = 0);
}

#endif
