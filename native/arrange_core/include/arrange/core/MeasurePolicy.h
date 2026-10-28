#pragma once

#include "Alignment.h"
#include "PropValue.h"
#include "ImmutableVector.h"

#include <string>
#include <variant>
#include <vector>
#include <cstdint>

namespace arrange::core {
    struct AxisArrangement {
        Arrangement arrangement = Arrangement::Start;
        float spacing = 0.0f;
        bool operator==(const AxisArrangement&) const = default;
    };

    struct BoxMeasurePolicy {
        LayoutAlignment contentAlignment = LayoutAlignment::TopStart;
        bool propagateMinConstraints = false;
        bool operator==(const BoxMeasurePolicy&) const = default;
    };

    struct RowMeasurePolicy {
        AxisArrangement arrangement;
        LayoutAlignment verticalAlignment = LayoutAlignment::Top;
        bool operator==(const RowMeasurePolicy&) const = default;
    };

    struct ColumnMeasurePolicy {
        AxisArrangement arrangement;
        LayoutAlignment horizontalAlignment = LayoutAlignment::Start;
        bool operator==(const ColumnMeasurePolicy&) const = default;
    };

    struct MinSizeMeasurePolicy {
        bool operator==(const MinSizeMeasurePolicy&) const = default;
    };

    struct FlowMeasurePolicy {
        bool horizontal = true;
        AxisArrangement mainArrangement;
        AxisArrangement crossArrangement;
        LayoutAlignment itemAlignment = LayoutAlignment::Top;
        int maxItems = 2147483647;
        bool operator==(const FlowMeasurePolicy&) const = default;
    };

    struct LazyMeasurePolicy {
        bool horizontal = false;
        bool grid = false;
        int cells = 1;
        float adaptiveMinSize = 0;
        float mainSpacing = 0;
        float crossSpacing = 0;
        float crossBeforePadding = 0;
        float crossAfterPadding = 0;
        Arrangement mainAlignment = Arrangement::Start;
        float beforePadding = 0;
        float afterPadding = 0;
        float estimate = 48;
        LayoutAlignment itemAlignment = LayoutAlignment::Start;
        std::uint64_t version = 1;
        std::uint64_t requestVersion = 0;
        std::uint64_t workVersion = 0;
        int requestedIndex = 0;
        float requestedOffset = 0;
        ImmutableVector<std::string> keys;
        ImmutableVector<std::string> contentTypes;
        ImmutableVector<int> spans;
        std::vector<int> indices;
        std::vector<int> pinnedIndices;
        bool operator==(const LazyMeasurePolicy&) const = default;
    };

    using MeasurePolicy = std::variant<BoxMeasurePolicy, RowMeasurePolicy, ColumnMeasurePolicy, MinSizeMeasurePolicy, FlowMeasurePolicy, LazyMeasurePolicy>;

    // 边界转换只发生在输入更新时，测量与放置直接消费类型化策略
    MeasurePolicy readMeasurePolicy(const PropValue& value, const MeasurePolicy* previous = nullptr);
    std::uint32_t measurePolicyInvalidation(const MeasurePolicy& before, const MeasurePolicy& after);
}
