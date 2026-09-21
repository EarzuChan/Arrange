#include <arrange/core/MeasurePolicy.h>
#include <arrange/core/Alignment.h>
#include <arrange/core/Modifier.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace arrange::core {
    namespace {
        void fields(const PropValue& value, std::initializer_list<std::string_view> allowed) {
            if (!value.isObject()) throw std::invalid_argument("MeasurePolicy 必须是对象");
            for (const auto& field : value.fields) {
                if (std::find(allowed.begin(), allowed.end(), field.key) == allowed.end()) throw std::invalid_argument("MeasurePolicy 未声明字段：" + field.key);
            }
        }

        std::string text(const PropValue& value, std::string_view key, std::string_view fallback) {
            const auto* field = value.field(key);
            if (!field) return std::string(fallback);
            if (!field->isString()) throw std::invalid_argument("MeasurePolicy 字段必须是字符串：" + std::string(key));
            return field->string;
        }

        AxisArrangement arrangement(const PropValue* value, bool horizontal) {
            if (!value) return {horizontal ? "Start" : "Top"};
            AxisArrangement result;
            if (value->isString())
                result.alignment = value->string;
            else {
                fields(*value, {"kind", "space", "alignment"});
                if (text(*value, "kind", "") != "spacedBy") throw std::invalid_argument("排列策略对象必须声明 spacedBy");
                const auto* space = value->field("space");
                if (!space || !space->isNumber() || !std::isfinite(space->number) || space->number < 0) throw std::invalid_argument("排列间距必须是非负有限数值");
                result.spacing = static_cast<float>(space->number);
                result.alignment = text(*value, "alignment", horizontal ? "Start" : "Top");
            }
            const auto distributed = value->isString() && (result.alignment == "SpaceBetween" || result.alignment == "SpaceAround" || result.alignment == "SpaceEvenly" || result.alignment == "Center");
            if (!distributed && !(horizontal ? isHorizontalAlignment(result.alignment) : isVerticalAlignment(result.alignment))) throw std::invalid_argument("排列对齐方向不匹配：" + result.alignment);
            return result;
        }
    }  // namespace

    MeasurePolicy readMeasurePolicy(const PropValue& value) {
        const auto kind = text(value, "kind", "");
        if (kind == "Box") {
            fields(value, {"kind", "contentAlignment", "propagateMinConstraints"});
            BoxMeasurePolicy result;
            result.contentAlignment = text(value, "contentAlignment", "TopStart");
            if (!isBoxAlignment(result.contentAlignment)) throw std::invalid_argument("BoxMeasurePolicy 对齐值无效");
            if (const auto* propagate = value.field("propagateMinConstraints")) {
                if (!propagate->isBoolean()) throw std::invalid_argument("propagateMinConstraints 必须是布尔值");
                result.propagateMinConstraints = propagate->boolean;
            }
            return result;
        }
        if (kind == "Row") {
            fields(value, {"kind", "horizontalArrangement", "verticalAlignment"});
            RowMeasurePolicy result{arrangement(value.field("horizontalArrangement"), true), text(value, "verticalAlignment", "Top")};
            if (!isVerticalAlignment(result.verticalAlignment) && result.verticalAlignment != "Baseline") throw std::invalid_argument("RowMeasurePolicy 对齐值无效");
            return result;
        }
        if (kind == "Column") {
            fields(value, {"kind", "verticalArrangement", "horizontalAlignment"});
            ColumnMeasurePolicy result{arrangement(value.field("verticalArrangement"), false), text(value, "horizontalAlignment", "Start")};
            if (!isHorizontalAlignment(result.horizontalAlignment)) throw std::invalid_argument("ColumnMeasurePolicy 对齐值无效");
            return result;
        }
        fields(value, {"kind"});
        if (kind == "MinSize") return MinSizeMeasurePolicy{};
        throw std::invalid_argument("未知 MeasurePolicy：" + kind);
    }

    std::uint32_t measurePolicyInvalidation(const MeasurePolicy& before, const MeasurePolicy& after) {
        if (before == after) return 0;
        constexpr auto placement = dirtyMask(DirtyFlag::Placement) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        if (const auto* a = std::get_if<ColumnMeasurePolicy>(&before)) {
            if (const auto* b = std::get_if<ColumnMeasurePolicy>(&after); b && a->arrangement.spacing == b->arrangement.spacing) return placement;
        }
        if (const auto* a = std::get_if<RowMeasurePolicy>(&before)) {
            if (const auto* b = std::get_if<RowMeasurePolicy>(&after); b && a->arrangement.spacing == b->arrangement.spacing && a->verticalAlignment == b->verticalAlignment) return placement;
        }
        return dirtyMask(DirtyFlag::Layout) | placement;
    }
}  // namespace arrange::core
