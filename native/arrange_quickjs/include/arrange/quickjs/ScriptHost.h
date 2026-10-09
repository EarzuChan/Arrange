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
        bool hasFocusArgument = false;
        bool focused = false;
        bool hasFocus = focused;
    };

    class ScriptHost {
       public:
        virtual ~ScriptHost() = default;
        virtual ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) = 0;
    };
}
