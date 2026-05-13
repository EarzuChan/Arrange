#include <arrange/juce/ScriptEventDispatcher.h>

#if ARRANGE_JUCE_WITH_JUCE

namespace arrange::juce {
    arrange::core::EventSlotId ScriptEventDispatcher::eventSlot(
        const arrange::core::ArrangeNode& node,
        arrange::core::EventSlotKind kind) {
        if (const auto it = node.eventSlots.find(kind); it != node.eventSlots.end()) return it->second;
        return {};
    }

#if ARRANGE_WITH_QUICKJS_NG
    ScriptEventInvokeResult ScriptEventDispatcher::invoke(
        arrange::quickjs::QuickJsScriptHost* host,
        const arrange::core::EventSlotId& slot,
        double nowMillis) const {
        if (host == nullptr || !slot.valid()) return {};
        host->setFrameTimeMillis(nowMillis);
        const auto invoked = host->invokeEventSlot(slot);
        if (!invoked.ok) return {true, false, invoked.error};
        return {true, true, {}};
    }

    ScriptEventInvokeResult ScriptEventDispatcher::invoke(
        arrange::quickjs::QuickJsScriptHost* host,
        const arrange::core::EventSlotId& slot,
        double nowMillis,
        const arrange::quickjs::CallbackInvokeOptions& options) const {
        if (host == nullptr || !slot.valid()) return {};
        host->setFrameTimeMillis(nowMillis);
        const auto invoked = host->invokeEventSlot(slot, options);
        if (!invoked.ok) return {true, false, invoked.error};
        return {true, true, {}};
    }

    ScriptEventInvokeResult ScriptEventDispatcher::invokeString(
        arrange::quickjs::QuickJsScriptHost* host,
        const arrange::core::EventSlotId& slot,
        double nowMillis,
        const std::string& value) const {
        arrange::quickjs::CallbackInvokeOptions options;
        options.hasStringArgument = true;
        options.stringArgument = value;
        return invoke(host, slot, nowMillis, options);
    }

    ScriptEventInvokeResult ScriptEventDispatcher::invokeScroll(
        arrange::quickjs::QuickJsScriptHost* host,
        const arrange::core::EventSlotId& slot,
        double nowMillis,
        const arrange::core::ScrollResult& result) const {
        if (host == nullptr || !slot.valid()) return {};
        host->setFrameTimeMillis(nowMillis);
        const auto invoked = host->invokeEventSlot(slot, result);
        if (!invoked.ok) return {true, false, invoked.error};
        return {true, true, {}};
    }
#endif
} // namespace arrange::juce

#endif
