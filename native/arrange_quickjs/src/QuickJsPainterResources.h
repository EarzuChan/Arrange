#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <arrange/core/Painter.h>
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
        };

        static JSValue acquire(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        static JSValue release(JSContext* context, JSValueConst self, int argc, JSValueConst* argv);
        JSContext* context_;
        arrange::core::PainterLoader loader_;
        std::unordered_map<std::uint64_t, Resource> resources_;
    };
}  // namespace arrange::quickjs

#endif
