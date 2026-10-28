#pragma once

#include "PropValue.h"

#include <cstdint>
#include <optional>
#include <string_view>

namespace arrange::core {
    // JS 名称只在入口解析一次；slot 不携带任意字段路径或由调用者指定的 dirty
    enum class HostInput : std::uint16_t {
        MeasurePolicy,
        Enabled,
    };

    std::optional<HostInput> hostInputFromName(std::string_view name);
    std::string_view hostInputName(HostInput input);
    // 宿主输入变化时的失效阶段；measurePolicy 另按新旧策略比较
    std::uint32_t hostInputInvalidation(HostInput input);
}
