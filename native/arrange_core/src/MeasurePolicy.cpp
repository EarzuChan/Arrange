#include <arrange/core/MeasurePolicy.h>
#include <arrange/core/Alignment.h>
#include <arrange/core/Modifier.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <unordered_set>

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
    }

    MeasurePolicy readMeasurePolicy(const PropValue& value, const MeasurePolicy* previous) {
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
        if (kind == "FlowRow" || kind == "FlowColumn") {
            fields(value, kind == "FlowRow" ? std::initializer_list<std::string_view>{"kind", "horizontalArrangement", "verticalArrangement", "itemVerticalAlignment", "maxItemsInEachRow"} : std::initializer_list<std::string_view>{"kind", "horizontalArrangement", "verticalArrangement", "itemHorizontalAlignment", "maxItemsInEachColumn"});
            FlowMeasurePolicy result;
            result.horizontal = kind == "FlowRow";
            result.mainArrangement = arrangement(value.field(result.horizontal ? "horizontalArrangement" : "verticalArrangement"), result.horizontal);
            result.crossArrangement = arrangement(value.field(result.horizontal ? "verticalArrangement" : "horizontalArrangement"), !result.horizontal);
            result.itemAlignment = text(value, result.horizontal ? "itemVerticalAlignment" : "itemHorizontalAlignment", result.horizontal ? "Top" : "Start");
            if (!(result.horizontal ? isVerticalAlignment(result.itemAlignment) : isHorizontalAlignment(result.itemAlignment))) throw std::invalid_argument("Flow 子项对齐方向不匹配");
            if (const auto* count = value.field(result.horizontal ? "maxItemsInEachRow" : "maxItemsInEachColumn")) {
                if (!count->isNumber() || !std::isfinite(count->number) || count->number < 1 || count->number > 2147483647 || std::floor(count->number) != count->number) throw std::invalid_argument("Flow 每行数量必须是正整数");
                result.maxItems = static_cast<int>(count->number);
            }
            return result;
        }
        if (kind == "Lazy") {
            fields(value, {"kind", "horizontal", "grid", "cells", "adaptiveMinSize", "mainSpacing", "crossSpacing", "beforePadding", "afterPadding", "crossBeforePadding", "crossAfterPadding", "mainAlignment", "estimate", "itemAlignment", "version", "requestVersion", "workVersion", "requestedIndex", "requestedOffset", "keys", "contentTypes", "spans", "indices", "pinnedIndices"});
            LazyMeasurePolicy result;
            const auto* inherited = previous ? std::get_if<LazyMeasurePolicy>(previous) : nullptr;
            const auto number = [&](const char* name, double fallback, bool integral = false) {
                const auto* field = value.field(name);
                if (!field) return fallback;
                if (!field->isNumber() || !std::isfinite(field->number) || field->number < 0 || (integral ? std::floor(field->number) != field->number || field->number > 2147483647 : field->number > std::numeric_limits<float>::max())) throw std::invalid_argument(std::string("Lazy 数值字段无效：") + name);
                return field->number;
            };
            const auto boolean = [&](const char* name) {
                const auto* field = value.field(name);
                if (field && !field->isBoolean()) throw std::invalid_argument(std::string("Lazy 布尔字段无效：") + name);
                return field && field->boolean;
            };
            const auto array = [&](const char* name) -> const std::vector<PropValue>& {
                const auto* field = value.field(name);
                if (!field || !field->isArray()) throw std::invalid_argument(std::string("Lazy 数组字段无效：") + name);
                return field->elements;
            };
            result.horizontal = boolean("horizontal");
            result.grid = boolean("grid");
            result.cells = static_cast<int>(number("cells", 1, true));
            if (result.cells < 1) throw std::invalid_argument("Lazy 网格单元数量必须大于零");
            result.adaptiveMinSize = static_cast<float>(number("adaptiveMinSize", 0));
            result.mainSpacing = static_cast<float>(number("mainSpacing", 0));
            result.crossSpacing = static_cast<float>(number("crossSpacing", 0));
            result.crossBeforePadding = static_cast<float>(number("crossBeforePadding", 0));
            result.crossAfterPadding = static_cast<float>(number("crossAfterPadding", 0));
            result.mainAlignment = text(value, "mainAlignment", result.horizontal ? "Start" : "Top");
            if (result.mainAlignment != "SpaceBetween" && result.mainAlignment != "SpaceAround" && result.mainAlignment != "SpaceEvenly" && !(result.horizontal ? isHorizontalAlignment(result.mainAlignment) : isVerticalAlignment(result.mainAlignment))) throw std::invalid_argument("Lazy 主轴排列方向不匹配");
            result.beforePadding = static_cast<float>(number("beforePadding", 0));
            result.afterPadding = static_cast<float>(number("afterPadding", 0));
            result.estimate = static_cast<float>(number("estimate", 48));
            if (result.estimate <= 0) throw std::invalid_argument("Lazy 估计尺寸必须大于零");
            result.version = static_cast<std::uint64_t>(number("version", 1, true));
            result.workVersion = static_cast<std::uint64_t>(number("workVersion", 0, true));
            result.requestVersion = static_cast<std::uint64_t>(number("requestVersion", 0, true));
            result.requestedIndex = static_cast<int>(number("requestedIndex", 0, true));
            result.requestedOffset = static_cast<float>(number("requestedOffset", 0));
            result.itemAlignment = text(value, "itemAlignment", result.horizontal ? "Top" : "Start");
            if (!(result.horizontal ? isVerticalAlignment(result.itemAlignment) : isHorizontalAlignment(result.itemAlignment))) throw std::invalid_argument("Lazy 子项对齐方向不匹配");
            const auto hasMetadata = value.hasField("keys") || value.hasField("contentTypes") || value.hasField("spans");
            if (!hasMetadata) {
                if (!inherited || inherited->version != result.version) throw std::invalid_argument("Lazy 元数据引用必须匹配当前受体的已接收版本");
                result.keys = inherited->keys;
                result.contentTypes = inherited->contentTypes;
                result.spans = inherited->spans;
            } else {
                std::vector<std::string> keys;
                std::vector<std::string> types;
                for (const auto& key : array("keys")) {
                    if (!key.isString()) throw std::invalid_argument("Lazy key 必须是规范身份字符串");
                    keys.push_back(key.string);
                }
                for (const auto& type : array("contentTypes")) {
                    if (!type.isString()) throw std::invalid_argument("Lazy contentType 必须是规范类型字符串");
                    types.push_back(type.string);
                }
                result.keys = std::move(keys);
                result.contentTypes = std::move(types);
            }
            const auto indices = [&](const char* name, std::vector<int>& target, bool spans) {
                for (const auto& item : array(name)) {
                    if (!item.isNumber() || !std::isfinite(item.number) || std::floor(item.number) != item.number || item.number < (spans ? -1 : 0) || item.number > 2147483647) throw std::invalid_argument(std::string("Lazy 索引字段无效：") + name);
                    target.push_back(static_cast<int>(item.number));
                }
            };
            if (hasMetadata) {
                std::vector<int> spans;
                indices("spans", spans, true);
                result.spans = std::move(spans);
            }
            indices("indices", result.indices, false);
            indices("pinnedIndices", result.pinnedIndices, false);
            if (result.keys.size() != result.contentTypes.size() || result.keys.size() != result.spans.size()) throw std::invalid_argument("Lazy 元数据数量不一致");
            if (hasMetadata) {
                std::unordered_set<std::string> keys;
                for (const auto& key : result.keys)
                    if (!keys.insert(key).second) throw std::invalid_argument("Lazy 出现重复 key");
            }
            for (int index : result.indices)
                if (index >= result.keys.size()) throw std::invalid_argument("Lazy 材料化索引越界");
            if (std::adjacent_find(result.indices.begin(), result.indices.end(), std::greater_equal<int>()) != result.indices.end()) throw std::invalid_argument("Lazy 材料化索引必须唯一且递增");
            for (int index : result.pinnedIndices)
                if (index >= result.keys.size()) throw std::invalid_argument("Lazy 固定索引越界");
            if (hasMetadata)
                for (int span : result.spans)
                    if (span == 0) throw std::invalid_argument("Lazy span 必须大于零或使用 maxLineSpan");
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
}
