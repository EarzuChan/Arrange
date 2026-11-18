#pragma once

#include <cstdint>
#include <memory>
#include <arrange/core/UiPackage.h>
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
        // 回调返回真值，表示事件已被消费
        bool consumed = false;
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
        virtual ScriptExecutionResult executePackage(std::shared_ptr<const core::UiPackage> package) = 0;
    };
}
