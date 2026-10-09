#include <arrange/core/Layout.h>
#include <arrange/core/Alignment.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/core/LazyLayout.h>

#include <algorithm>
#include <cstdlib>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace arrange::core {
    namespace {
        constexpr float InfiniteConstraint = Constraints::Infinity;

        float clamp(float value, float min, float max) noexcept {
            return std::max(min, std::min(max, value));
        }

        float safeMax(float value, float fallback) noexcept {
            return std::isfinite(value) ? value : fallback;
        }

        Constraints shrink(Constraints constraints, float dx, float dy) {
            return {
                std::max(0.0f, constraints.minWidth - dx),
                std::max(0.0f, constraints.maxWidth - dx),
                std::max(0.0f, constraints.minHeight - dy),
                std::max(0.0f, constraints.maxHeight - dy),
            };
        }

        Constraints exact(Constraints constraints, float width, float height, bool hasWidth, bool hasHeight, bool required = false) {
            if (hasWidth) {
                const auto value = required ? width : clamp(width, constraints.minWidth, constraints.maxWidth);
                constraints.minWidth = constraints.maxWidth = value;
            }
            if (hasHeight) {
                const auto value = required ? height : clamp(height, constraints.minHeight, constraints.maxHeight);
                constraints.minHeight = constraints.maxHeight = value;
            }
            return constraints;
        }

        float crossAxisOffset(float parent, float child, const std::string& alignment, bool horizontal) {
            if (horizontal) {
                if (alignment == "Center" || alignment == "CenterHorizontally" || alignment == "TopCenter" || alignment == "BottomCenter") return (parent - child) * 0.5f;
                if (alignment == "End" || alignment == "TopEnd" || alignment == "CenterEnd" || alignment == "BottomEnd") return parent - child;
            } else {
                if (alignment == "Center" || alignment == "CenterVertically" || alignment == "CenterStart" || alignment == "CenterEnd") return (parent - child) * 0.5f;
                if (alignment == "Bottom" || alignment == "BottomStart" || alignment == "BottomCenter" || alignment == "BottomEnd") return parent - child;
            }
            return 0.0f;
        }

        struct MainAxisPlacement {
            float offset = 0.0f;
            float spacing = 0.0f;
        };

        MainAxisPlacement mainAxisPlacement(const LayoutTree& tree, const LayoutNode& node, float size, bool horizontal, const AxisArrangement& arrangement) {
            MainAxisPlacement result;
            result.spacing = arrangement.spacing;
            const auto count = node.children.size();
            if (count == 0) return result;

            float used = result.spacing * static_cast<float>(count - 1);
            for (auto childId : node.children) used += horizontal ? tree.node(childId).bounds.width : tree.node(childId).bounds.height;
            const auto remaining = std::max(0.0f, size - used);
            const auto& name = arrangement.alignment;

            if (name == "Center" || name == "CenterHorizontally" || name == "CenterVertically")
                result.offset = remaining * 0.5f;
            else if (name == "End" || name == "Bottom")
                result.offset = remaining;
            else if (name == "SpaceBetween" && count > 1)
                result.spacing = remaining / static_cast<float>(count - 1);
            else if (name == "SpaceAround") {
                result.spacing = remaining / static_cast<float>(count);
                result.offset = result.spacing * 0.5f;
            } else if (name == "SpaceEvenly") {
                result.spacing = remaining / static_cast<float>(count + 1);
                result.offset = result.spacing;
            }
            return result;
        }

        std::string alignModifier(const LayoutNode& node) {
            return node.modifier.parentData().align;
        }

        void validateParentData(const LayoutTree& tree, const LayoutNode& node) {
            const auto data = node.modifier.parentData();
            if (data.weight == 0 && data.align.empty() && !data.matchParentSize) return;
            const auto parent = tree.parentOf(node.id);
            if (!parent) throw std::invalid_argument("父布局 Modifier 必须用于相应布局的直接子项");
            const auto& policy = tree.node(*parent).measurePolicy;
            const auto box = std::holds_alternative<BoxMeasurePolicy>(policy), row = std::holds_alternative<RowMeasurePolicy>(policy), column = std::holds_alternative<ColumnMeasurePolicy>(policy);
            const auto* flow = std::get_if<FlowMeasurePolicy>(&policy);
            if (data.matchParentSize && !box) throw std::invalid_argument("matchParentSize 只能用于 Box 的直接子项");
            if (data.weight > 0 && !row && !column && !flow) throw std::invalid_argument("weight 只能用于 Row、Column 或 Flow 的直接子项");
            if (!data.align.empty()) {
                const auto valid = box ? isBoxAlignment(data.align) : row ? isVerticalAlignment(data.align) || data.align == "Baseline" : column ? isHorizontalAlignment(data.align) : flow ? flow->horizontal ? isVerticalAlignment(data.align) : isHorizontalAlignment(data.align) : false;
                if (!valid) throw std::invalid_argument("align 与父布局的交叉轴方向不匹配");
            }
        }
    }

    LayoutEngine::LayoutEngine() : textLayoutService_(&defaultTextLayoutService()) {}

    LayoutEngine::LayoutEngine(const TextLayoutService& textLayoutService) : textLayoutService_(&textLayoutService) {}

    void LayoutEngine::layout(LayoutTree& tree, NodeId root, Constraints constraints) {
        scrollUpdates_.clear();
        measure(tree, root, constraints);
        place(tree, root, 0.0f, 0.0f);
    }

    Size LayoutEngine::measure(LayoutTree& tree, NodeId id, Constraints constraints) {
        constraints.validate();
        auto& node = tree.node(id);
        validateParentData(tree, node);
        if (node.measurementValid && node.measuredConstraints == constraints && !((node.dirty | node.subtreeDirty) & (dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Structure)))) {
            ++counters_.measureCacheHits;
            return {node.bounds.width, node.bounds.height};
        }
        ++counters_.measuredNodes;
        // 放置依赖完整测量结果，约束改变或子项重测都可能改变内部几何
        node.placementValid = false;
        const auto measured = measureWithModifier(tree, id, 0, constraints);
        node.measuredConstraints = constraints;
        node.measurementValid = true;
        node.bounds.width = measured.width;
        node.bounds.height = measured.height;
        return measured;
    }

    Size LayoutEngine::measureWithModifier(LayoutTree& tree, NodeId id, std::size_t index, Constraints constraints) {
        auto& node = tree.node(id);
        if (index == node.modifier.elements().size()) {
            const auto size = measureContent(tree, id, constraints);
            node.contentBounds.width = size.width;
            node.contentBounds.height = size.height;
            return size;
        }
        auto& instance = node.modifier.elements()[index];
        auto inner = constraints;
        instance.childOffset = {};
        const auto* input = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value);
        bool required = false;
        bool padding = false;
        bool scrolling = false;
        if (input) {
            const auto& item = *input;
            switch (item.kind) {
                case LayoutModifierKind::Padding:
                    padding = true;
                    inner = shrink(constraints, item.padding.start + item.padding.end, item.padding.top + item.padding.bottom);
                    instance.childOffset = {item.padding.start, item.padding.top};
                    break;
                case LayoutModifierKind::IntrinsicWidth:
                    inner = exact(inner, intrinsic(tree, id, index + 1, true, item.intrinsicMaximum, constraints.maxHeight), 0, true, false);
                    break;
                case LayoutModifierKind::IntrinsicHeight:
                    inner = exact(inner, 0, intrinsic(tree, id, index + 1, false, item.intrinsicMaximum, constraints.maxWidth), false, true);
                    break;
                case LayoutModifierKind::Width:
                    inner = exact(inner, item.value, 0, true, false);
                    break;
                case LayoutModifierKind::Height:
                    inner = exact(inner, 0, item.value, false, true);
                    break;
                case LayoutModifierKind::Size:
                    inner = exact(inner, item.width, item.height, true, true);
                    break;
                case LayoutModifierKind::RequiredWidth:
                    required = true;
                    inner = exact(inner, item.value, 0, true, false, true);
                    break;
                case LayoutModifierKind::RequiredHeight:
                    required = true;
                    inner = exact(inner, 0, item.value, false, true, true);
                    break;
                case LayoutModifierKind::RequiredSize:
                    required = true;
                    inner = exact(inner, item.width, item.height, true, true, true);
                    break;
                case LayoutModifierKind::FillMaxWidth:
                case LayoutModifierKind::FillMaxHeight:
                case LayoutModifierKind::FillMaxSize: {
                    const auto fraction = std::clamp(item.fraction, 0.0f, 1.0f);
                    const auto width = item.kind != LayoutModifierKind::FillMaxHeight && inner.hasBoundedWidth();
                    const auto height = item.kind != LayoutModifierKind::FillMaxWidth && inner.hasBoundedHeight();
                    inner = exact(inner, inner.maxWidth * fraction, inner.maxHeight * fraction, width, height);
                    break;
                }
                case LayoutModifierKind::WidthIn:
                case LayoutModifierKind::HeightIn:
                case LayoutModifierKind::SizeIn:
                    if (item.kind != LayoutModifierKind::HeightIn) {
                        if (item.minWidth >= 0) inner.minWidth = clamp(item.minWidth, constraints.minWidth, constraints.maxWidth);
                        if (item.maxWidth >= 0) inner.maxWidth = clamp(item.maxWidth, inner.minWidth, constraints.maxWidth);
                    }
                    if (item.kind != LayoutModifierKind::WidthIn) {
                        if (item.minHeight >= 0) inner.minHeight = clamp(item.minHeight, constraints.minHeight, constraints.maxHeight);
                        if (item.maxHeight >= 0) inner.maxHeight = clamp(item.maxHeight, inner.minHeight, constraints.maxHeight);
                    }
                    break;
                case LayoutModifierKind::DefaultMinSize:
                    if (inner.minWidth == 0 && item.minWidth >= 0) inner.minWidth = std::min(item.minWidth, inner.maxWidth);
                    if (inner.minHeight == 0 && item.minHeight >= 0) inner.minHeight = std::min(item.minHeight, inner.maxHeight);
                    break;
                case LayoutModifierKind::VerticalScroll:
                    scrolling = true;
                    if (!std::holds_alternative<LazyMeasurePolicy>(node.measurePolicy)) inner.maxHeight = InfiniteConstraint;
                    break;
                case LayoutModifierKind::HorizontalScroll:
                    scrolling = true;
                    if (!std::holds_alternative<LazyMeasurePolicy>(node.measurePolicy)) inner.maxWidth = InfiniteConstraint;
                    break;
            }
        }
        if (const auto* paint = std::get_if<PaintModifier>(&instance.descriptor.value); paint && paint->sizeToIntrinsics && paint->painter.content && paint->painter.content->intrinsicSize) {
            const auto size = *paint->painter.content->intrinsicSize;
            inner.minWidth = std::max(inner.minWidth, std::min(size.width, inner.maxWidth));
            inner.minHeight = std::max(inner.minHeight, std::min(size.height, inner.maxHeight));
        }
        const auto* text = textPresentation(instance.descriptor.value);
        if (text) {
            const auto editable = std::holds_alternative<TextFieldModifier>(instance.descriptor.value);
            const auto width = editable && text->singleLine || !constraints.hasBoundedWidth() ? 0.0f : std::max(constraints.maxWidth, std::numeric_limits<float>::min());
            instance.textLayout = textLayoutService_->layout(modifierText(instance.descriptor.value), text->style, {text->singleLine ? 1 : editable ? 0 : text->maxLines, width, text->singleLine, text->overflow == "ellipsis"}, instance.textLayout);
            inner.minWidth = std::max(inner.minWidth, std::min(instance.textLayout->width, inner.maxWidth));
            auto textHeight = instance.textLayout->height;
            if (editable && text->maxLines > 0) textHeight = std::min(textHeight, instance.textLayout->lineHeight * text->maxLines);
            inner.minHeight = std::max(inner.minHeight, std::min(std::max(textHeight, instance.textLayout->lineHeight * text->minLines), inner.maxHeight));
        }
        instance.childMeasured = measureWithModifier(tree, id, index + 1, inner);
        auto measured = instance.childMeasured;
        if (padding) {
            measured.width += input->padding.start + input->padding.end;
            measured.height += input->padding.top + input->padding.bottom;
        }
        if (required || scrolling || padding) {
            measured.width = clamp(measured.width, constraints.minWidth, constraints.maxWidth);
            measured.height = clamp(measured.height, constraints.minHeight, constraints.maxHeight);
        }
        if (required) instance.childOffset = {(measured.width - instance.childMeasured.width) * 0.5f, (measured.height - instance.childMeasured.height) * 0.5f};
        if (text) node.baseline = instance.textLayout->baseline;
        if (node.baseline >= 0) node.baseline += instance.childOffset.y;
        if (const auto* animation = std::get_if<AnimateContentSizeModifier>(&instance.descriptor.value)) {
            if (instance.sizeAnimation.initialized && (instance.sizeAnimation.running || instance.sizeAnimation.target != measured || instance.sizeAnimation.spec != animation->animationSpec)) ++counters_.animationSamples;
            measured = instance.sizeAnimation.update(measured, animation->animationSpec, tree.frameTimeMillis());
            measured.width = clamp(measured.width, constraints.minWidth, constraints.maxWidth);
            measured.height = clamp(measured.height, constraints.minHeight, constraints.maxHeight);
        }
        if (scrolling && node.lazy && std::holds_alternative<LazyMeasurePolicy>(node.measurePolicy)) {
            auto& scroll = std::get<LayoutModifierSemantics>(instance.descriptor.value);
            scroll.scrollValue = node.lazy->scrollOffset;
            if (scroll.kind == LayoutModifierKind::VerticalScroll)
                instance.childMeasured.height = node.lazy->contentSize;
            else
                instance.childMeasured.width = node.lazy->contentSize;
        }
        instance.measured = measured;
        return measured;
    }

    Size LayoutEngine::measureContent(LayoutTree& tree, NodeId id, Constraints constraints) {
        auto& node = tree.node(id);
        node.baseline = -1.0f;
        Size content;

        std::visit(
            [&](const auto& policy) {
                using Policy = std::decay_t<decltype(policy)>;
                if constexpr (std::is_same_v<Policy, MinSizeMeasurePolicy>) {
                    content = {constraints.minWidth, constraints.minHeight};
                    for (auto child : node.children) measure(tree, child, {0.0f, constraints.maxWidth, 0.0f, constraints.maxHeight});
                } else if constexpr (std::is_same_v<Policy, RowMeasurePolicy>) {
                    const auto spacing = policy.arrangement.spacing;
                    const auto gaps = node.children.empty() ? 0.0f : spacing * static_cast<float>(node.children.size() - 1);
                    float width = 0.0f;
                    float height = 0.0f;
                    float totalWeight = 0.0f;
                    struct WeightedChild {
                        NodeId id = 0;
                        float weight = 0.0f;
                        bool fill = true;
                    };
                    std::vector<WeightedChild> weighted;
                    for (auto childId : node.children) {
                        const auto childModifier = tree.node(childId).modifier.parentData();
                        if (childModifier.weight > 0.0f) {
                            totalWeight += childModifier.weight;
                            weighted.push_back({childId, childModifier.weight, childModifier.weightFill});
                            continue;
                        }
                        const auto remaining = constraints.hasBoundedWidth() ? std::max(0.0f, constraints.maxWidth - width - gaps) : InfiniteConstraint;
                        const auto child = measure(tree, childId, {0.0f, remaining, 0.0f, constraints.maxHeight});
                        width += child.width;
                        height = std::max(height, child.height);
                    }
                    const auto availableForWeight = std::max(0.0f, safeMax(constraints.maxWidth, 0.0f) - width - gaps);
                    for (const auto& child : weighted) {
                        const auto childId = child.id;
                        const auto share = constraints.hasBoundedWidth() ? totalWeight > 0.0f ? availableForWeight * (child.weight / totalWeight) : 0.0f : InfiniteConstraint;
                        const auto measuredChild = measure(tree, childId, {child.fill && constraints.hasBoundedWidth() ? share : 0.0f, share, 0.0f, constraints.maxHeight});
                        width += measuredChild.width;
                        height = std::max(height, measuredChild.height);
                    }
                    width += gaps;
                    const auto defaultAlign = policy.verticalAlignment;
                    float maxBaseline = -1.0f, maxDescent = 0.0f;
                    for (auto childId : node.children) {
                        const auto& child = tree.node(childId);
                        const auto alignment = alignModifier(child);
                        if (child.baseline >= 0 && (alignment == "Baseline" || (alignment.empty() && defaultAlign == "Baseline"))) {
                            maxBaseline = std::max(maxBaseline, child.baseline);
                            maxDescent = std::max(maxDescent, child.bounds.height - child.baseline);
                        }
                    }
                    if (maxBaseline >= 0) {
                        height = std::max(height, maxBaseline + maxDescent);
                        node.baseline = maxBaseline;
                    }
                    content = {width, height};
                } else if constexpr (std::is_same_v<Policy, ColumnMeasurePolicy>) {
                    const auto spacing = policy.arrangement.spacing;
                    const auto gaps = node.children.empty() ? 0.0f : spacing * static_cast<float>(node.children.size() - 1);
                    float width = 0.0f;
                    float height = 0.0f;
                    float totalWeight = 0.0f;
                    struct WeightedChild {
                        NodeId id = 0;
                        float weight = 0.0f;
                        bool fill = true;
                    };
                    std::vector<WeightedChild> weighted;
                    for (auto childId : node.children) {
                        const auto childModifier = tree.node(childId).modifier.parentData();
                        if (childModifier.weight > 0.0f) {
                            totalWeight += childModifier.weight;
                            weighted.push_back({childId, childModifier.weight, childModifier.weightFill});
                            continue;
                        }
                        const auto remaining = constraints.hasBoundedHeight() ? std::max(0.0f, constraints.maxHeight - height - gaps) : InfiniteConstraint;
                        const auto child = measure(tree, childId, {0.0f, constraints.maxWidth, 0.0f, remaining});
                        width = std::max(width, child.width);
                        height += child.height;
                    }
                    const auto availableForWeight = std::max(0.0f, safeMax(constraints.maxHeight, 0.0f) - height - gaps);
                    for (const auto& child : weighted) {
                        const auto childId = child.id;
                        const auto share = constraints.hasBoundedHeight() ? totalWeight > 0.0f ? availableForWeight * (child.weight / totalWeight) : 0.0f : InfiniteConstraint;
                        const auto measuredChild = measure(tree, childId, {0.0f, constraints.maxWidth, child.fill && constraints.hasBoundedHeight() ? share : 0.0f, share});
                        width = std::max(width, measuredChild.width);
                        height += measuredChild.height;
                    }
                    height += gaps;
                    if (!node.children.empty()) node.baseline = tree.node(node.children.front()).baseline;
                    content = {width, height};
                } else if constexpr (std::is_same_v<Policy, LazyMeasurePolicy>) {
                    content = measureLazy(tree, node, constraints, policy);
                } else if constexpr (std::is_same_v<Policy, FlowMeasurePolicy>) {
                    content = measureFlow(tree, node, constraints, policy);
                } else if constexpr (std::is_same_v<Policy, BoxMeasurePolicy>) {
                    float width = 0.0f;
                    float height = 0.0f;
                    for (auto childId : node.children) {
                        if (tree.node(childId).modifier.parentData().matchParentSize) continue;
                        const auto child = measure(tree, childId, policy.propagateMinConstraints ? constraints : Constraints{0.0f, constraints.maxWidth, 0.0f, constraints.maxHeight});
                        width = std::max(width, child.width);
                        height = std::max(height, child.height);
                    }
                    content = {width, height};
                    const auto parentWidth = clamp(width, constraints.minWidth, constraints.maxWidth), parentHeight = clamp(height, constraints.minHeight, constraints.maxHeight);
                    for (auto childId : node.children)
                        if (tree.node(childId).modifier.parentData().matchParentSize) measure(tree, childId, {parentWidth, parentWidth, parentHeight, parentHeight});
                }
            },
            node.measurePolicy);

        node.bounds.width = clamp(content.width, constraints.minWidth, safeMax(constraints.maxWidth, content.width));
        node.bounds.height = clamp(content.height, constraints.minHeight, safeMax(constraints.maxHeight, content.height));
        if (const auto* policy = std::get_if<BoxMeasurePolicy>(&node.measurePolicy); policy && !node.children.empty()) {
            const auto& child = tree.node(node.children.front());
            if (child.baseline >= 0) {
                const auto alignment = alignModifier(child);
                const auto defaultAlign = policy->contentAlignment;
                node.baseline = child.baseline + crossAxisOffset(node.bounds.height, child.bounds.height, alignment.empty() ? defaultAlign : alignment, false);
            }
        }
        return {node.bounds.width, node.bounds.height};
    }

    void LayoutEngine::place(LayoutTree& tree, NodeId id, float x, float y) {
        auto& node = tree.node(id);
        if (node.placementValid && node.bounds.x == x && node.bounds.y == y && !(node.dirty & (dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Structure) | dirtyMask(DirtyFlag::Placement)))) {
            ++counters_.placeCacheHits;
            return;
        }
        ++counters_.placedNodes;
        node.bounds.x = x;
        node.bounds.y = y;
        node.placementValid = true;
        // 几何是绘制片段与命中区域的共同输入
        markDirty(node, DirtyFlag::Paint);
        markDirty(node, DirtyFlag::HitTest);
        placeWithModifier(tree, id, 0, x, y);
    }

    void LayoutEngine::placeWithModifier(LayoutTree& tree, NodeId id, std::size_t index, float x, float y) {
        auto& node = tree.node(id);
        if (index == node.modifier.elements().size()) {
            node.contentBounds.x = x;
            node.contentBounds.y = y;
            placeContent(tree, id, x, y, node.contentBounds.width, node.contentBounds.height);
            return;
        }
        auto& instance = node.modifier.elements()[index];
        instance.bounds = {x, y, instance.measured.width, instance.measured.height};
        auto offset = instance.childOffset;
        if (const auto* input = std::get_if<OffsetModifier>(&instance.descriptor.value)) {
            offset.x += input->x;
            offset.y += input->y;
        }
        if (const auto* input = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value); input && (input->kind == LayoutModifierKind::VerticalScroll || input->kind == LayoutModifierKind::HorizontalScroll)) {
            const auto snapshot = ScrollDispatcher::snapshot(instance);
            const auto lazyChanged = node.lazy && node.lazy->snapshot != node.lazy->publishedSnapshot;
            if (instance.scrollSnapshot != snapshot || input->scrollValue != snapshot.value || lazyChanged) {
                ScrollResult update{snapshot, false, id, input->eventSlot, instance.handle};
                if (node.lazy) {
                    update.lazy = node.lazy->snapshot;
                    node.lazy->publishedSnapshot = node.lazy->snapshot;
                }
                scrollUpdates_.push_back(std::move(update));
            }
            instance.scrollSnapshot = snapshot;
            if (input->kind == LayoutModifierKind::VerticalScroll)
                offset.y -= snapshot.value;
            else
                offset.x -= snapshot.value;
        }
        placeWithModifier(tree, id, index + 1, x + offset.x, y + offset.y);
    }

    std::vector<ScrollResult> LayoutEngine::takeScrollUpdates() {
        return std::exchange(scrollUpdates_, {});
    }

    void LayoutEngine::placeContent(LayoutTree& tree, NodeId id, float x, float y, float width, float height) {
        auto& node = tree.node(id);
        if (const auto* policy = std::get_if<LazyMeasurePolicy>(&node.measurePolicy)) {
            placeLazy(tree, node, x, y, width, height, *policy);
            return;
        }
        if (const auto* policy = std::get_if<FlowMeasurePolicy>(&node.measurePolicy)) {
            placeFlow(tree, node, x, y, width, height, *policy);
            return;
        }
        if (const auto* policy = std::get_if<RowMeasurePolicy>(&node.measurePolicy)) {
            const auto arrangement = mainAxisPlacement(tree, node, width, true, policy->arrangement);
            const auto defaultAlign = policy->verticalAlignment;
            float baseline = -1.0f;
            for (auto childId : node.children) {
                const auto& child = tree.node(childId);
                const auto alignment = alignModifier(child);
                if (alignment == "Baseline" || (alignment.empty() && defaultAlign == "Baseline")) baseline = std::max(baseline, child.baseline);
            }
            float cursor = x + arrangement.offset;
            for (auto childId : node.children) {
                auto& child = tree.node(childId);
                const auto childAlign = alignModifier(child);
                const auto alignment = childAlign.empty() ? defaultAlign : childAlign;
                const auto offset = alignment == "Baseline" && child.baseline >= 0 ? baseline - child.baseline : crossAxisOffset(height, child.bounds.height, alignment, false);
                place(tree, childId, cursor, y + offset);
                cursor += child.bounds.width + arrangement.spacing;
            }
            return;
        }

        if (const auto* policy = std::get_if<ColumnMeasurePolicy>(&node.measurePolicy)) {
            const auto arrangement = mainAxisPlacement(tree, node, height, false, policy->arrangement);
            const auto defaultAlign = policy->horizontalAlignment;
            float cursor = y + arrangement.offset;
            for (auto childId : node.children) {
                auto& child = tree.node(childId);
                const auto childAlign = alignModifier(child);
                const auto offset = crossAxisOffset(width, child.bounds.width, childAlign.empty() ? defaultAlign : childAlign, true);
                place(tree, childId, x + offset, cursor);
                cursor += child.bounds.height + arrangement.spacing;
            }
            return;
        }

        if (const auto* policy = std::get_if<BoxMeasurePolicy>(&node.measurePolicy)) {
            const auto defaultAlign = policy->contentAlignment;
            for (auto childId : node.children) {
                auto& child = tree.node(childId);
                const auto childAlign = alignModifier(child);
                const auto alignment = childAlign.empty() ? defaultAlign : childAlign;
                place(tree, childId, x + crossAxisOffset(width, child.bounds.width, alignment, true), y + crossAxisOffset(height, child.bounds.height, alignment, false));
            }
            return;
        }

        for (auto childId : node.children) place(tree, childId, x, y);
    }

}
