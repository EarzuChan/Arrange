#pragma once

#include "PropValue.h"

#include <cstdint>
#include <optional>
#include <string_view>

namespace arrange::core {
    // JS 名称只在入口解析一次；slot 不携带任意字段路径或由调用者指定的 dirty。
    enum class HostInput : std::uint16_t {
        Text, TextStyle, SingleLine, MinLines, MaxLines, TextAlign, Overflow,
        ModelValue, Value, Placeholder, SelectAllOnFocus,
        HorizontalArrangement, VerticalArrangement, ContentAlignment, HorizontalAlignment, VerticalAlignment,
        Source, Size, ContentScale, Alignment, Alpha, Tint,
        ContentDescription, Label, Description, Role, Enabled,
    };

    std::optional<HostInput> hostInputFromName(std::string_view name);
    std::string_view hostInputName(HostInput input);
    std::uint32_t hostInputInvalidation(HostInput input, const PropValue* before, const PropValue& after);
    bool samePropValue(const PropValue& left, const PropValue& right);
} // namespace arrange::core
