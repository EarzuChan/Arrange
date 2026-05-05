#pragma once

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

    class ScriptEventBridge final {
    public:
        static std::uint32_t callbackHandleFromProp(const arrange::core::ArrangeNode& node, const char* key);
        static std::uint32_t callbackHandleFromAnyProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr);
        static std::string scrollSnapshotJson(const arrange::core::ScrollResult& result);

#if ARRANGE_WITH_QUICKJS_NG
    ScriptEventInvokeResult invoke(arrange::quickjs::QuickJsScriptHost* host, std::uint32_t handle, double nowMillis) const;
    ScriptEventInvokeResult invoke(arrange::quickjs::QuickJsScriptHost* host, std::uint32_t handle, double nowMillis, const arrange::quickjs::CallbackInvokeOptions& options) const;
    ScriptEventInvokeResult invokeString(arrange::quickjs::QuickJsScriptHost* host, std::uint32_t handle, double nowMillis, const std::string& value) const;
#endif
    };

#endif
} // namespace arrange::juce
