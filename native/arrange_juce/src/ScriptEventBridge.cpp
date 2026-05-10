#include <arrange/juce/ScriptEventBridge.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>

#include <sstream>

namespace arrange::juce {
    namespace {
        std::string nodeProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr) {
            if (const auto it = node.props.find(camelCase); it != node.props.end()) return it->second;
            if (kebabCase != nullptr) {
                if (const auto it = node.props.find(kebabCase); it != node.props.end()) return it->second;
            }
            return {};
        }
    } // namespace

    arrange::core::EventSlotId ScriptEventBridge::eventSlotFromProp(const arrange::core::ArrangeNode& node, const char* key) {
        return arrange::core::parseEventSlotId(nodeProp(node, key));
    }

    arrange::core::EventSlotId ScriptEventBridge::eventSlotFromAnyProp(
        const arrange::core::ArrangeNode& node,
        arrange::core::EventSlotKind kind,
        const char* camelCase,
        const char* kebabCase) {
        const auto generatedCamelSlotKey = std::string("__arrangeEventSlot.") + camelCase;
        auto slot = eventSlotFromProp(node, generatedCamelSlotKey.c_str());
        std::string generatedKebabSlotKey;
        if (!slot.valid() && kebabCase != nullptr) {
            generatedKebabSlotKey = std::string("__arrangeEventSlot.") + kebabCase;
            slot = eventSlotFromProp(node, generatedKebabSlotKey.c_str());
        }
        if (!slot.valid()) slot = eventSlotFromProp(node, camelCase);
        if (!slot.valid() && kebabCase != nullptr) slot = eventSlotFromProp(node, kebabCase);
        return slot;
    }

    std::string ScriptEventBridge::scrollSnapshotJson(const arrange::core::ScrollResult& result) {
        std::ostringstream out;
        out << "{\"value\":" << result.value
            << ",\"maxValue\":" << result.maxValue
            << ",\"viewportSize\":" << result.viewportSize
            << ",\"contentSize\":" << result.contentSize
            << ",\"isScrollInProgress\":false}";
        return out.str();
    }

#if ARRANGE_WITH_QUICKJS_NG
    ScriptEventInvokeResult ScriptEventBridge::invoke(
        arrange::quickjs::QuickJsScriptHost* host,
        const arrange::core::EventSlotId& slot,
        double nowMillis) const {
        if (host == nullptr || !slot.valid()) return {};
        host->setFrameTimeMillis(nowMillis);
        const auto invoked = host->invokeEventSlot(slot);
        if (!invoked.ok) return {true, false, invoked.error};
        return {true, true, {}};
    }

    ScriptEventInvokeResult ScriptEventBridge::invoke(
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

    ScriptEventInvokeResult ScriptEventBridge::invokeString(
        arrange::quickjs::QuickJsScriptHost* host,
        const arrange::core::EventSlotId& slot,
        double nowMillis,
        const std::string& value) const {
        arrange::quickjs::CallbackInvokeOptions options;
        options.hasStringArgument = true;
        options.stringArgument = value;
        return invoke(host, slot, nowMillis, options);
    }
#endif
} // namespace arrange::juce

#endif
