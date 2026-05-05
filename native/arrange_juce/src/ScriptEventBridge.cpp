#include <arrange/juce/ScriptEventBridge.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>

#include <sstream>
#include <utility>

namespace arrange::juce {
    namespace {
        std::string nodeProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr) {
            if (const auto it = node.props.find(camelCase); it != node.props.end()) return it->second;
            if (kebabCase != nullptr) { if (const auto it = node.props.find(kebabCase); it != node.props.end()) return it->second; }
            return {};
        }
    } // namespace

    std::uint32_t ScriptEventBridge::callbackHandleFromProp(const arrange::core::ArrangeNode& node, const char* key) {
        const auto value = nodeProp(node, key);
        return value.empty() ? 0 : arrange::core::EncodedProp(value).handleValue(0);
    }

    std::uint32_t ScriptEventBridge::callbackHandleFromAnyProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase) {
        auto handle = callbackHandleFromProp(node, camelCase);
        if (handle == 0 && kebabCase != nullptr) handle = callbackHandleFromProp(node, kebabCase);
        return handle;
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
ScriptEventInvokeResult ScriptEventBridge::invoke(arrange::quickjs::QuickJsScriptHost* host, std::uint32_t handle, double nowMillis) const {
    if (host == nullptr || handle == 0) return {};
    host->setFrameTimeMillis(nowMillis);
    const auto invoked = host->invokeCallback(handle);
    if (!invoked.ok) return {true, false, invoked.error};
    return {true, true, {}};
}

ScriptEventInvokeResult ScriptEventBridge::invoke(
    arrange::quickjs::QuickJsScriptHost* host,
    std::uint32_t handle,
    double nowMillis,
    const arrange::quickjs::CallbackInvokeOptions& options) const {
    if (host == nullptr || handle == 0) return {};
    host->setFrameTimeMillis(nowMillis);
    const auto invoked = host->invokeCallback(handle, options);
    if (!invoked.ok) return {true, false, invoked.error};
    return {true, true, {}};
}

ScriptEventInvokeResult ScriptEventBridge::invokeString(
    arrange::quickjs::QuickJsScriptHost* host,
    std::uint32_t handle,
    double nowMillis,
    const std::string& value) const {
    arrange::quickjs::CallbackInvokeOptions options;
    options.hasStringArgument = true;
    options.stringArgument = value;
    return invoke(host, handle, nowMillis, options);
}
#endif

} // namespace arrange::juce

#endif
