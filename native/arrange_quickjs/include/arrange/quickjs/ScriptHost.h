#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>

namespace arrange::quickjs {
    struct ScriptExecutionResult {
        bool ok = false;
        std::string error;
    };

    struct CallbackInvokeResult {
        bool ok = false;
        std::string error;
    };

    struct CallbackInvokeOptions {
        bool hasStringArgument = false;
        std::string stringArgument;
    };

    class ScriptHost {
    public:
        virtual ~ScriptHost() = default;
        virtual ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) = 0;
        virtual CallbackInvokeResult invokeCallback(std::uint32_t callbackHandle, const CallbackInvokeOptions& options = {}) = 0;
    };
} // namespace arrange::quickjs
