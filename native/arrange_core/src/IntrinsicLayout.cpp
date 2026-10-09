#include <arrange/core/Layout.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/core/TextMetrics.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace arrange::core {
    namespace {
        float checkedOpposite(float value) {
            if (std::isnan(value) || value < 0) throw std::invalid_argument("固有尺寸查询的另一轴必须非负或无界");
            return value;
        }
    }

    float LayoutEngine::minIntrinsicWidth(const LayoutTree& tree, NodeId id, float height) const {
        return intrinsic(tree, id, 0, true, false, checkedOpposite(height));
    }

    float LayoutEngine::maxIntrinsicWidth(const LayoutTree& tree, NodeId id, float height) const {
        return intrinsic(tree, id, 0, true, true, checkedOpposite(height));
    }

    float LayoutEngine::minIntrinsicHeight(const LayoutTree& tree, NodeId id, float width) const {
        return intrinsic(tree, id, 0, false, false, checkedOpposite(width));
    }

    float LayoutEngine::maxIntrinsicHeight(const LayoutTree& tree, NodeId id, float width) const {
        return intrinsic(tree, id, 0, false, true, checkedOpposite(width));
    }

    float LayoutEngine::intrinsic(const LayoutTree& tree, NodeId id, std::size_t index, bool width, bool maximum, float opposite) const {
        const auto& node = tree.node(id);
        if (index < node.modifier.elements().size()) {
            const auto& descriptor = node.modifier.elements()[index].descriptor.value;
            if (const auto* item = std::get_if<LayoutModifierSemantics>(&descriptor)) {
                const auto kind = item->kind;
                if (kind == LayoutModifierKind::Padding) {
                    const auto queried = width ? item->padding.start + item->padding.end : item->padding.top + item->padding.bottom;
                    const auto other = width ? item->padding.top + item->padding.bottom : item->padding.start + item->padding.end;
                    return queried + intrinsic(tree, id, index + 1, width, maximum, std::max(0.0f, opposite - other));
                }
                const auto fixesWidth = kind == LayoutModifierKind::Width || kind == LayoutModifierKind::RequiredWidth || kind == LayoutModifierKind::Size || kind == LayoutModifierKind::RequiredSize;
                const auto fixesHeight = kind == LayoutModifierKind::Height || kind == LayoutModifierKind::RequiredHeight || kind == LayoutModifierKind::Size || kind == LayoutModifierKind::RequiredSize;
                const auto fixedWidth = kind == LayoutModifierKind::Width || kind == LayoutModifierKind::RequiredWidth ? item->value : item->width;
                const auto fixedHeight = kind == LayoutModifierKind::Height || kind == LayoutModifierKind::RequiredHeight ? item->value : item->height;
                if (width && fixesWidth || !width && fixesHeight) return width ? fixedWidth : fixedHeight;
                if (width && fixesHeight || !width && fixesWidth) opposite = width ? fixedHeight : fixedWidth;
                if (kind == LayoutModifierKind::IntrinsicWidth || kind == LayoutModifierKind::IntrinsicHeight) {
                    const auto ownWidth = kind == LayoutModifierKind::IntrinsicWidth;
                    if (ownWidth == width) return intrinsic(tree, id, index + 1, width, item->intrinsicMaximum, opposite);
                    opposite = intrinsic(tree, id, index + 1, ownWidth, item->intrinsicMaximum, Constraints::Infinity);
                }
                const auto rangesWidth = kind == LayoutModifierKind::WidthIn || kind == LayoutModifierKind::SizeIn || kind == LayoutModifierKind::DefaultMinSize;
                const auto rangesHeight = kind == LayoutModifierKind::HeightIn || kind == LayoutModifierKind::SizeIn || kind == LayoutModifierKind::DefaultMinSize;
                if (width && rangesHeight || !width && rangesWidth) {
                    const auto min = width ? item->minHeight : item->minWidth, max = width ? item->maxHeight : item->maxWidth;
                    opposite = std::max(opposite, min < 0 ? 0 : min);
                    if (max >= 0) opposite = std::min(opposite, max);
                }
                auto result = intrinsic(tree, id, index + 1, width, maximum, opposite);
                if (width && rangesWidth || !width && rangesHeight) {
                    const auto min = width ? item->minWidth : item->minHeight, max = width ? item->maxWidth : item->maxHeight;
                    result = std::max(result, min < 0 ? 0 : min);
                    if (max >= 0) result = std::min(result, max);
                }
                return result;
            }
            auto result = intrinsic(tree, id, index + 1, width, maximum, opposite);
            if (const auto* paint = std::get_if<PaintModifier>(&descriptor); paint && paint->sizeToIntrinsics && paint->painter.content && paint->painter.content->intrinsicSize) result = std::max(result, width ? paint->painter.content->intrinsicSize->width : paint->painter.content->intrinsicSize->height);
            if (const auto* text = textPresentation(descriptor)) {
                const auto source = modifierText(descriptor);
                float natural = 0;
                if (!width) {
                    const auto layoutWidth = std::isfinite(opposite) ? std::max(opposite, std::numeric_limits<float>::min()) : 0;
                    const auto layout = textLayoutService_->layout(source, text->style, {text->singleLine ? 1 : text->maxLines, layoutWidth, text->singleLine, false});
                    natural = std::max(layout->height, layout->lineHeight * text->minLines);
                } else if (maximum || text->singleLine || text->maxLines == 1)
                    natural = textLayoutService_->layout(source, text->style, {text->singleLine ? 1 : 0, 0, text->singleLine, false})->width;
                else {
                    std::size_t tokenStart = 0;
                    const auto finish = [&](std::size_t end) {
                        if (end > tokenStart) natural = std::max(natural, textLayoutService_->layout(source.substr(tokenStart, end - tokenStart), text->style, {1, 0, true, false})->width);
                    };
                    for (std::size_t cursor = 0; cursor < source.size();) {
                        const auto start = cursor;
                        const auto codepoint = decodeUtf8Codepoint(source, cursor);
                        const auto space = codepoint == U' ' || codepoint == U'\t' || codepoint == U'\n' || codepoint == U'\r';
                        const auto ideograph = codepoint >= 0x2e80 && codepoint <= 0x9fff;
                        if (space || ideograph) {
                            finish(start);
                            tokenStart = start;
                            if (ideograph) finish(cursor);
                            tokenStart = cursor;
                        } else if (codepoint == U'-') {
                            finish(cursor);
                            tokenStart = cursor;
                        }
                    }
                    finish(source.size());
                }
                result = std::max(result, natural);
            }
            return result;
        }
        const auto childQuery = [&](NodeId child, bool queryWidth, bool queryMaximum, float other) {
            return intrinsic(tree, child, 0, queryWidth, queryMaximum, other);
        };
        return std::visit(
            [&](const auto& policy) -> float {
                using Policy = std::decay_t<decltype(policy)>;
                if constexpr (std::is_same_v<Policy, MinSizeMeasurePolicy>)
                    return 0;
                else if constexpr (std::is_same_v<Policy, BoxMeasurePolicy>) {
                    float result = 0;
                    for (auto child : node.children)
                        if (!tree.node(child).modifier.parentData().matchParentSize) result = std::max(result, childQuery(child, width, maximum, opposite));
                    return result;
                } else if constexpr (std::is_same_v<Policy, RowMeasurePolicy> || std::is_same_v<Policy, ColumnMeasurePolicy>) {
                    const auto horizontal = std::is_same_v<Policy, RowMeasurePolicy>;
                    const auto gap = node.children.empty() ? 0.0f : policy.arrangement.spacing * (node.children.size() - 1);
                    float result = 0, fixed = gap, totalWeight = 0, weightUnit = 0;
                    for (auto child : node.children) {
                        const auto weight = tree.node(child).modifier.parentData().weight;
                        totalWeight += weight;
                        if (width == horizontal) {
                            const auto value = childQuery(child, width, maximum, opposite);
                            if (weight > 0)
                                weightUnit = std::max(weightUnit, value / weight);
                            else
                                result += value;
                        } else if (weight <= 0) {
                            const auto main = std::min(childQuery(child, horizontal, true, Constraints::Infinity), std::max(0.0f, opposite - fixed));
                            fixed += main;
                            result = std::max(result, childQuery(child, width, maximum, main));
                        }
                    }
                    if (width == horizontal) return result + weightUnit * totalWeight + gap;
                    const auto remaining = std::max(0.0f, opposite - fixed);
                    for (auto child : node.children) {
                        const auto weight = tree.node(child).modifier.parentData().weight;
                        if (weight <= 0) continue;
                        const auto main = std::isfinite(opposite) ? remaining * weight / totalWeight : Constraints::Infinity;
                        result = std::max(result, childQuery(child, width, maximum, main));
                    }
                    return result;
                } else if constexpr (std::is_same_v<Policy, FlowMeasurePolicy>) {
                    const auto crossExtent = [&](float availableMain, const std::vector<float>* mains = nullptr, const std::vector<float>* crosses = nullptr) {
                        float lineMain = 0, lineCross = 0, total = 0;
                        int count = 0;
                        for (std::size_t childIndex = 0; childIndex < node.children.size(); ++childIndex) {
                            const auto child = node.children[childIndex];
                            const auto cross = crosses ? (*crosses)[childIndex] : childQuery(child, !policy.horizontal, false, availableMain);
                            const auto main = mains ? (*mains)[childIndex] : childQuery(child, policy.horizontal, false, cross);
                            if (count && (count >= policy.maxItems || lineMain + policy.mainArrangement.spacing + main > availableMain)) {
                                total += lineCross + policy.crossArrangement.spacing;
                                lineMain = lineCross = 0;
                                count = 0;
                            }
                            lineMain += (count ? policy.mainArrangement.spacing : 0) + main;
                            lineCross = std::max(lineCross, cross);
                            ++count;
                        }
                        return total + lineCross;
                    };
                    if (width != policy.horizontal) return crossExtent(opposite);
                    float lower = 0, upper = 0, line = 0;
                    int count = 0;
                    std::vector<float> mains, crosses;
                    for (auto child : node.children) {
                        const auto value = childQuery(child, width, maximum, opposite);
                        mains.push_back(value);
                        crosses.push_back(childQuery(child, !width, false, value));
                        lower = std::max(lower, value);
                        if (count == policy.maxItems) {
                            upper = std::max(upper, line);
                            line = 0;
                            count = 0;
                        }
                        line += (count ? policy.mainArrangement.spacing : 0) + value;
                        ++count;
                    }
                    upper = std::max(upper, line);
                    if (maximum) return upper;
                    if (!std::isfinite(opposite)) return lower;
                    for (int step = 0; step < 32; ++step) {
                        const auto middle = (lower + upper) / 2;
                        if (crossExtent(middle, &mains, &crosses) > opposite)
                            lower = middle;
                        else
                            upper = middle;
                    }
                    return upper;
                } else
                    throw std::invalid_argument("此布局不支持固有尺寸查询；Lazy 需要显式尺寸，不能全量物化条目求固有尺寸");
            },
            node.measurePolicy);
    }
}
