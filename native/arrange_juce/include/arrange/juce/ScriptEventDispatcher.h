#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/Node.h>
#include <arrange/core/Scroll.h>

#if ARRANGE_WITH_QUICKJS_NG
#include <arrange/quickjs/QuickJsScriptHost.h>
#endif

#include <cstdint>
#include <string>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct ScriptEventInvokeResult {
        bool invoked = false;
        bool ok = true;
        std::string error;
    };

    class ScriptEventDispatcher final {
    public:
        static arrange::core::EventSlotId eventSlot(
            const arrange::core::ArrangeNode& node,
            arrange::core::EventSlotKind kind);

#if ARRANGE_WITH_QUICKJS_NG
        ScriptEventInvokeResult invoke(arrange::quickjs::QuickJsScriptHost* host, const arrange::core::EventSlotId& slot, double nowMillis) const;
        ScriptEventInvokeResult invoke(
            arrange::quickjs::QuickJsScriptHost* host,
            const arrange::core::EventSlotId& slot,
            double nowMillis,
            const arrange::quickjs::CallbackInvokeOptions& options) const;
        ScriptEventInvokeResult invokeString(arrange::quickjs::QuickJsScriptHost* host, const arrange::core::EventSlotId& slot, double nowMillis, const std::string& value) const;
        ScriptEventInvokeResult invokeScroll(arrange::quickjs::QuickJsScriptHost* host, const arrange::core::EventSlotId& slot, double nowMillis, const arrange::core::ScrollResult& result) const;
#endif
    };

#endif
} // namespace arrange::juce

