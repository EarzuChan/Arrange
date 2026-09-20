#pragma once

#include "PropValue.h"

#include <string>
#include <variant>

namespace arrange::core {
    struct AxisArrangement {
        std::string alignment = "Start";
        float spacing = 0.0f;
        bool operator==(const AxisArrangement&) const = default;
    };

    struct BoxMeasurePolicy {
        std::string contentAlignment = "TopStart";
        bool propagateMinConstraints = false;
        bool operator==(const BoxMeasurePolicy&) const = default;
    };

    struct RowMeasurePolicy {
        AxisArrangement arrangement;
        std::string verticalAlignment = "Top";
        bool operator==(const RowMeasurePolicy&) const = default;
    };

    struct ColumnMeasurePolicy {
        AxisArrangement arrangement{"Top"};
        std::string horizontalAlignment = "Start";
        bool operator==(const ColumnMeasurePolicy&) const = default;
    };

    struct MinSizeMeasurePolicy { bool operator==(const MinSizeMeasurePolicy&) const = default; };
    struct TextMeasurePolicy { bool operator==(const TextMeasurePolicy&) const = default; };
    using MeasurePolicy = std::variant<BoxMeasurePolicy, RowMeasurePolicy, ColumnMeasurePolicy, MinSizeMeasurePolicy, TextMeasurePolicy>;

    // 边界转换只发生在输入更新时，测量与放置直接消费类型化策略
    MeasurePolicy readMeasurePolicy(const PropValue& value);
    std::uint32_t measurePolicyInvalidation(const MeasurePolicy& before, const MeasurePolicy& after);
}
