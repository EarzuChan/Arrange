#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <arrange/core/Painter.h>
#include <list>
#include <string>
#include <unordered_map>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    class QuickJsPainterResources {
       public:
        QuickJsPainterResources(JSContext* context, arrange::core::PainterLoader loader);
        ~QuickJsPainterResources();
        void install(JSValueConst native);
        bool hasPending() const;
        bool pump();
        static std::optional<arrange::core::PainterSnapshot> read(JSContext* context, JSValueConst value);

       private:
        struct Resource {
            arrange::core::PainterSnapshot snapshot;
            std::future<arrange::core::PainterLoadResult> pending;
            JSValue callback = JS_UNDEFINED;
            std::string location;
        };

        // 按地址缓存已解码内容，同一运行时内再次获取同一资源时首帧即可绘制；重载新建运行时即清空
        static constexpr std::size_t cachedContentLimit = 128;
        std::shared_ptr<const arrange::core::PainterContent> cached(const std::string& location);
        void remember(const std::string& location, std::shared_ptr<const arrange::core::PainterContent> content);

        static JSValue acquire(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        static JSValue release(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        static JSValue createPixels(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        static JSValue commitPixels(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        // 字体：同一条资源获取链路取字节，defineFontFamily 把已到达的字面登记进字体注册表
        static JSValue defineFontFamily(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        static JSValue removeFontFamily(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        static JSValue beginFontPreload(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        static JSValue endFontPreload(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        std::uint32_t heldPreloads_ = 0;
        JSContext* context_;
        arrange::core::PainterLoader loader_;
        std::unordered_map<std::uint64_t, Resource> resources_;
        std::list<std::pair<std::string, std::shared_ptr<const arrange::core::PainterContent>>> recent_;
    };
}

#endif
