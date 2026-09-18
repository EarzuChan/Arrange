#include <arrange/core/Layout.h>
#include <arrange/core/PropValue.h>
#include <arrange/core/TextLayoutService.h>

#include <algorithm>
#include <cstdlib>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace arrange::core {
    namespace {
        constexpr float InfiniteConstraint = 1000000.0f;

        float clamp(float value, float min, float max) noexcept { return std::max(min, std::min(max, value)); }
        float safeMax(float value, float fallback) noexcept { return value > 0.0f ? value : fallback; }

        std::string inputTextProp(const ArrangeNode& node) {
            if (const auto* value = propValue(node, "modelValue", "model-value")) return value->stringOr();
            if (const auto* value = propValue(node, "value")) return value->stringOr();
            if (const auto* value = propValue(node, "placeholder")) return value->stringOr();
            return {};
        }

        float spacedByValue(const PropValue* value) {
            const auto object = PropObject(value);
            if (object.string("kind") != "spacedBy") return 0.0f;
            return std::max(0.0f, object.number("space"));
        }

        PropObject textStyleProp(const ArrangeNode& node) { return objectProp(node, "textStyle", "text-style"); }

        int textMaxLines(const ArrangeNode& node) {
            const auto value = intProp(node, "maxLines", 0);
            return value > 0 ? value : 0;
        }

        int textMinLines(const ArrangeNode& node) {
            const auto value = intProp(node, "minLines", 1);
            return value > 0 ? value : 1;
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

        MainAxisPlacement mainAxisPlacement(const LayoutTree& tree, const ArrangeNode& node, float size, bool horizontal) {
            const auto* arrangement = horizontal ? propValue(node, "horizontalArrangement", "horizontal-arrangement") : propValue(node, "verticalArrangement", "vertical-arrangement");
            MainAxisPlacement result;
            result.spacing = spacedByValue(arrangement);
            const auto count = node.children.size();
            if (count == 0) return result;

            float used = result.spacing * static_cast<float>(count - 1);
            for (auto childId : node.children) used += horizontal ? tree.node(childId).bounds.width : tree.node(childId).bounds.height;
            const auto remaining = std::max(0.0f, size - used);
            const auto name = arrangement && arrangement->isString() ? arrangement->string : PropObject(arrangement).string("alignment");

            if (name == "Center" || name == "CenterHorizontally" || name == "CenterVertically") result.offset = remaining * 0.5f;
            else if (name == "End" || name == "Bottom") result.offset = remaining;
            else if (name == "SpaceBetween" && count > 1) result.spacing = remaining / static_cast<float>(count - 1);
            else if (name == "SpaceAround") {
                result.spacing = remaining / static_cast<float>(count);
                result.offset = result.spacing * 0.5f;
            } else if (name == "SpaceEvenly") {
                result.spacing = remaining / static_cast<float>(count + 1);
                result.offset = result.spacing;
            }
            return result;
        }

        std::string nodeAlignmentProp(const ArrangeNode& node, const char* camelCase, const char* kebabCase, const char* fallback) {
            return stringProp(node, camelCase, kebabCase, fallback);
        }

        std::string alignModifier(const ArrangeNode& node) { return node.modifier.parentData().align; }
    } // namespace

    LayoutEngine::LayoutEngine() : textLayoutService_(&defaultTextLayoutService()) {}

    LayoutEngine::LayoutEngine(const TextLayoutService& textLayoutService) : textLayoutService_(&textLayoutService) {}

    void LayoutEngine::layout(LayoutTree& tree, NodeId root, Constraints constraints) {
        measure(tree, root, constraints);
        place(tree, root, 0.0f, 0.0f);
    }

    Size LayoutEngine::measure(LayoutTree& tree, NodeId id, Constraints constraints) {
        auto& node = tree.node(id);
        if (node.measurementValid && node.measuredConstraints == constraints &&
            !(node.dirty & (dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Structure)))) {
            ++counters_.measureCacheHits;
            return {node.bounds.width, node.bounds.height};
        }
        ++counters_.measuredNodes;
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
            case LayoutModifierKind::Width: inner = exact(inner, item.value, 0, true, false); break;
            case LayoutModifierKind::Height: inner = exact(inner, 0, item.value, false, true); break;
            case LayoutModifierKind::Size: inner = exact(inner, item.width, item.height, true, true); break;
            case LayoutModifierKind::RequiredWidth: required = true; inner = exact(inner, item.value, 0, true, false, true); break;
            case LayoutModifierKind::RequiredHeight: required = true; inner = exact(inner, 0, item.value, false, true, true); break;
            case LayoutModifierKind::RequiredSize: required = true; inner = exact(inner, item.width, item.height, true, true, true); break;
            case LayoutModifierKind::FillMaxWidth:
            case LayoutModifierKind::FillMaxHeight:
            case LayoutModifierKind::FillMaxSize: {
                const auto fraction = std::clamp(item.fraction, 0.0f, 1.0f);
                const auto width = item.kind != LayoutModifierKind::FillMaxHeight && inner.maxWidth < InfiniteConstraint;
                const auto height = item.kind != LayoutModifierKind::FillMaxWidth && inner.maxHeight < InfiniteConstraint;
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
            case LayoutModifierKind::VerticalScroll: scrolling = true; inner.maxHeight = InfiniteConstraint; break;
            case LayoutModifierKind::HorizontalScroll: scrolling = true; inner.maxWidth = InfiniteConstraint; break;
            }
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
        if (node.baseline >= 0) node.baseline += instance.childOffset.y;
        if (const auto* animation = std::get_if<AnimateContentSizeModifier>(&instance.descriptor.value)) {
            if (instance.sizeAnimation.initialized && (instance.sizeAnimation.running || instance.sizeAnimation.target != measured || instance.sizeAnimation.spec != animation->animationSpec)) ++counters_.animationSamples;
            measured = instance.sizeAnimation.update(measured, animation->animationSpec, tree.frameTimeMillis());
            measured.width = clamp(measured.width, constraints.minWidth, constraints.maxWidth);
            measured.height = clamp(measured.height, constraints.minHeight, constraints.maxHeight);
        }
        instance.measured = measured;
        return measured;
    }

    Size LayoutEngine::measureContent(LayoutTree& tree, NodeId id, Constraints constraints) {
        auto& node = tree.node(id);
        node.baseline = -1.0f;
        Size content;

        switch (node.type) {
        case NodeType::Text: {
            const auto textStyle = textStyleProp(node);
            auto fontSize = textStyle.number("fontSize", 14.0f);
            if (!(fontSize > 0.0f)) fontSize = 14.0f;
            const auto lineHeight = std::max(fontSize, textStyle.number("lineHeight", fontSize * 1.2f));
            const auto maxLines = textMaxLines(node);
            const auto maxWidth = constraints.maxWidth < InfiniteConstraint ? constraints.maxWidth : 0.0f;
            node.textLayout = textLayoutService_->layout(node.text, {fontSize, lineHeight}, {maxLines, maxWidth, maxLines == 1, stringProp(node, "overflow", "clip") == "ellipsis"}, node.textLayout);
            content.width = node.textLayout->width;
            content.height = node.textLayout->height;
            node.baseline = node.textLayout->baseline;
            break;
        }
        case NodeType::Input: {
            const auto textStyle = textStyleProp(node);
            auto fontSize = textStyle.number("fontSize", 14.0f);
            if (!(fontSize > 0.0f)) fontSize = 14.0f;
            const auto lineHeight = std::max(fontSize, textStyle.number("lineHeight", fontSize));
            const auto text = inputTextProp(node);
            const auto singleLine = boolProp(node, "singleLine", true) && textMinLines(node) <= 1 && textMaxLines(node) <= 1;
            const auto minLines = singleLine ? 1 : textMinLines(node);
            const auto maxLines = singleLine ? 1 : textMaxLines(node);
            const auto textMaxWidth = !singleLine && constraints.maxWidth < InfiniteConstraint ? std::max(0.0f, constraints.maxWidth - 16.0f) : 0.0f;
            node.textLayout = textLayoutService_->layout(text, {fontSize, lineHeight}, {singleLine ? 1 : 0, textMaxWidth, singleLine}, node.textLayout);
            const auto& measured = *node.textLayout;
            auto visibleHeight = measured.height;
            if (maxLines > 0 && measured.lines.size() > static_cast<std::size_t>(maxLines)) visibleHeight = measured.lines[static_cast<std::size_t>(maxLines)].y;
            content.width = std::max(120.0f, measured.width + 16.0f);
            content.height = std::max(28.0f, std::max(visibleHeight, lineHeight * static_cast<float>(minLines)) + 8.0f);
            break;
        }
        case NodeType::Spacer:
            content.width = constraints.minWidth;
            content.height = constraints.minHeight;
            break;
        case NodeType::Row: {
            const auto spacing = rowSpacing(node);
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
                const auto child = measure(tree, childId, {0.0f, InfiniteConstraint, constraints.minHeight, constraints.maxHeight});
                width += child.width;
                height = std::max(height, child.height);
            }
            const auto gaps = node.children.empty() ? 0.0f : spacing * static_cast<float>(node.children.size() - 1);
            const auto availableForWeight = std::max(0.0f, safeMax(constraints.maxWidth, 0.0f) - width - gaps);
            for (const auto& child : weighted) {
                const auto childId = child.id;
                const auto share = totalWeight > 0.0f ? availableForWeight * (child.weight / totalWeight) : 0.0f;
                const auto measuredChild = measure(tree, childId, {child.fill ? share : 0.0f, share, constraints.minHeight, constraints.maxHeight});
                width += measuredChild.width;
                height = std::max(height, measuredChild.height);
            }
            width += gaps;
            const auto defaultAlign = nodeAlignmentProp(node, "verticalAlignment", "vertical-alignment", "Top");
            float maxBaseline = -1.0f, maxDescent = 0.0f;
            for (auto childId : node.children) {
                const auto& child = tree.node(childId);
                const auto alignment = alignModifier(child);
                if (child.baseline >= 0 && (alignment == "Baseline" || (alignment.empty() && defaultAlign == "Baseline"))) {
                    maxBaseline = std::max(maxBaseline, child.baseline);
                    maxDescent = std::max(maxDescent, child.bounds.height - child.baseline);
                }
            }
            if (maxBaseline >= 0) { height = std::max(height, maxBaseline + maxDescent); node.baseline = maxBaseline; }
            content = {width, height};
            break;
        }
        case NodeType::Column: {
            const auto spacing = columnSpacing(node);
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
                const auto child = measure(tree, childId, {0.0f, constraints.maxWidth, 0.0f, InfiniteConstraint});
                width = std::max(width, child.width);
                height += child.height;
            }
            const auto gaps = node.children.empty() ? 0.0f : spacing * static_cast<float>(node.children.size() - 1);
            const auto availableForWeight = std::max(0.0f, safeMax(constraints.maxHeight, 0.0f) - height - gaps);
            for (const auto& child : weighted) {
                const auto childId = child.id;
                const auto share = totalWeight > 0.0f ? availableForWeight * (child.weight / totalWeight) : 0.0f;
                const auto measuredChild = measure(tree, childId, {0.0f, constraints.maxWidth, child.fill ? share : 0.0f, share});
                width = std::max(width, measuredChild.width);
                height += measuredChild.height;
            }
            height += gaps;
            if (!node.children.empty()) node.baseline = tree.node(node.children.front()).baseline;
            content = {width, height};
            break;
        }
        case NodeType::Root:
        case NodeType::Box: {
            float width = 0.0f;
            float height = 0.0f;
            for (auto childId : node.children) {
                const auto child = measure(tree, childId, node.type == NodeType::Root ? constraints : Constraints{0.0f, constraints.maxWidth, 0.0f, constraints.maxHeight});
                width = std::max(width, child.width);
                height = std::max(height, child.height);
            }
            content = {width, height};
            break;
        }
        case NodeType::Image:
            content.width = 24.0f;
            content.height = 24.0f;
            break;
        case NodeType::Icon: {
            auto iconSize = numberProp(node, "size", -1.0f);
            if (!(iconSize > 0.0f)) iconSize = 24.0f;
            content.width = iconSize;
            content.height = iconSize;
            break;
        }
        case NodeType::Canvas:
        case NodeType::Unknown: {
            float width = 0.0f;
            float height = 0.0f;
            for (auto childId : node.children) {
                const auto child = measure(tree, childId, {0.0f, constraints.maxWidth, 0.0f, constraints.maxHeight});
                width = std::max(width, child.width);
                height = std::max(height, child.height);
            }
            content = {width, height};
            break;
        }
        }

        node.bounds.width = clamp(content.width, constraints.minWidth, safeMax(constraints.maxWidth, content.width));
        node.bounds.height = clamp(content.height, constraints.minHeight, safeMax(constraints.maxHeight, content.height));
        if ((node.type == NodeType::Box || node.type == NodeType::Root) && !node.children.empty()) {
            const auto& child = tree.node(node.children.front());
            if (child.baseline >= 0) {
                const auto alignment = alignModifier(child);
                const auto defaultAlign = nodeAlignmentProp(node, "contentAlignment", "content-alignment", "TopStart");
                node.baseline = child.baseline + crossAxisOffset(node.bounds.height, child.bounds.height, alignment.empty() ? defaultAlign : alignment, false);
            }
        }
        return {node.bounds.width, node.bounds.height};
    }

    void LayoutEngine::place(LayoutTree& tree, NodeId id, float x, float y) {
        auto& node = tree.node(id);
        if (node.placementValid && node.bounds.x == x && node.bounds.y == y &&
            !(node.dirty & (dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Structure) | dirtyMask(DirtyFlag::Placement)))) {
            ++counters_.placeCacheHits;
            return;
        }
        ++counters_.placedNodes;
        node.bounds.x = x;
        node.bounds.y = y;
        node.placementValid = true;
        // Geometry is an input to both paint fragments and hit regions.
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
        if (const auto* input = std::get_if<OffsetModifier>(&instance.descriptor.value)) { offset.x += input->x; offset.y += input->y; }
        if (const auto* input = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value)) {
            if (input->kind == LayoutModifierKind::VerticalScroll) offset.y -= input->scrollValue;
            if (input->kind == LayoutModifierKind::HorizontalScroll) offset.x -= input->scrollValue;
        }
        placeWithModifier(tree, id, index + 1, x + offset.x, y + offset.y);
    }

    void LayoutEngine::placeContent(LayoutTree& tree, NodeId id, float x, float y, float width, float height) {
        auto& node = tree.node(id);
        if (node.type == NodeType::Row) {
            const auto arrangement = mainAxisPlacement(tree, node, width, true);
            const auto defaultAlign = nodeAlignmentProp(node, "verticalAlignment", "vertical-alignment", "Top");
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
                const auto offset = alignment == "Baseline" && child.baseline >= 0 ? baseline - child.baseline
                    : crossAxisOffset(height, child.bounds.height, alignment, false);
                place(tree, childId, cursor, y + offset);
                cursor += child.bounds.width + arrangement.spacing;
            }
            return;
        }

        if (node.type == NodeType::Column) {
            const auto arrangement = mainAxisPlacement(tree, node, height, false);
            const auto defaultAlign = nodeAlignmentProp(node, "horizontalAlignment", "horizontal-alignment", "Start");
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

        if (node.type == NodeType::Box) {
            const auto defaultAlign = nodeAlignmentProp(node, "contentAlignment", "content-alignment", "TopStart");
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

    float LayoutEngine::rowSpacing(const ArrangeNode& node) { return spacedByValue(propValue(node, "horizontalArrangement", "horizontal-arrangement")); }

    float LayoutEngine::columnSpacing(const ArrangeNode& node) { return spacedByValue(propValue(node, "verticalArrangement", "vertical-arrangement")); }
} // namespace arrange::core
