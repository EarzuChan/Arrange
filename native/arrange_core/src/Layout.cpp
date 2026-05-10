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
            auto value = propValue(node, "modelValue", "model-value");
            if (value.empty()) { if (const auto it = node.props.find("value"); it != node.props.end()) value = it->second; }
            if (value.empty()) { if (const auto it = node.props.find("placeholder"); it != node.props.end()) value = it->second; }
            return decodeStringProp(value);
        }

        float spacedByValue(const std::string& value) {
            const auto object = objectFromEncodedProp(EncodedProp(value));
            if (object.string("kind") != "spacedBy") return 0.0f;
            return std::max(0.0f, object.number("space"));
        }

        PropObject textStyleProp(const ArrangeNode& node) { return objectProp(node, "textStyle", "text-style"); }

        int textMaxLines(const ArrangeNode& node) {
            const auto value = static_cast<int>(encodedNumberProp(node, "maxLines", 0.0f));
            return value > 0 ? value : 0;
        }

        int textMinLines(const ArrangeNode& node) {
            const auto value = static_cast<int>(encodedNumberProp(node, "minLines", 1.0f));
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
            if (alignment.empty()) return 0.0f;
            if (alignment == "Center" || alignment == "CenterVertically" || alignment == "CenterHorizontally" ||
                alignment == "TopCenter" || alignment == "BottomCenter" || alignment == "CenterStart" || alignment == "CenterEnd") {
                if (horizontal && (alignment == "CenterVertically" || alignment == "Top" || alignment == "Bottom")) return 0.0f;
                if (!horizontal && (alignment == "CenterHorizontally" || alignment == "Start" || alignment == "End")) return 0.0f;
                return (parent - child) * 0.5f;
            }
            if (horizontal) { if (alignment == "End" || alignment == "TopEnd" || alignment == "CenterEnd" || alignment == "BottomEnd") return parent - child; }
            else { if (alignment == "Bottom" || alignment == "BottomStart" || alignment == "BottomCenter" || alignment == "BottomEnd") return parent - child; }
            return 0.0f;
        }

        std::string nodeAlignmentProp(const ArrangeNode& node, const char* camelCase, const char* kebabCase, const char* fallback) {
            auto value = propValue(node, camelCase, kebabCase);
            if (value.empty()) return fallback;
            return decodeStringProp(value);
        }

        std::string alignModifier(const ArrangeNode& node) { return node.modifier.parentData.align; }
    } // namespace

    LayoutEngine::LayoutEngine() : textLayoutService_(&defaultTextLayoutService()) {}

    LayoutEngine::LayoutEngine(const TextLayoutService& textLayoutService) : textLayoutService_(&textLayoutService) {}

    void LayoutEngine::layout(LayoutTree& tree, NodeId root, Constraints constraints) {
        measure(tree, root, constraints);
        place(tree, root, 0.0f, 0.0f);
    }

    Size LayoutEngine::measure(LayoutTree& tree, NodeId id, Constraints constraints) {
        const auto& modifier = tree.node(id).modifier;
        return measureWithModifier(tree, id, modifier, 0, constraints);
    }

    Size LayoutEngine::measureWithModifier(LayoutTree& tree, NodeId id, const CompiledModifier& modifier, std::size_t index, Constraints constraints) {
        if (index >= modifier.layout.size()) return measureContent(tree, id, constraints);

        const auto& element = modifier.layout[index];
        if (element.kind == LayoutModifierKind::Padding) {
            const auto start = element.padding.start;
            const auto top = element.padding.top;
            const auto end = element.padding.end;
            const auto bottom = element.padding.bottom;
            const auto child = measureWithModifier(tree, id, modifier, index + 1, shrink(constraints, start + end, top + bottom));
            auto& node = tree.node(id);
            node.bounds.width = clamp(child.width + start + end, constraints.minWidth, constraints.maxWidth);
            node.bounds.height = clamp(child.height + top + bottom, constraints.minHeight, constraints.maxHeight);
            return {node.bounds.width, node.bounds.height};
        }

        if (element.kind == LayoutModifierKind::Width) { return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, element.value, 0.0f, true, false)); }
        if (element.kind == LayoutModifierKind::Height) { return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, 0.0f, element.value, false, true)); }
        if (element.kind == LayoutModifierKind::Size) { return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, element.width, element.height, true, true)); }
        if (element.kind == LayoutModifierKind::RequiredWidth) { return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, element.value, 0.0f, true, false, true)); }
        if (element.kind == LayoutModifierKind::RequiredHeight) { return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, 0.0f, element.value, false, true, true)); }
        if (element.kind == LayoutModifierKind::RequiredSize) { return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, element.width, element.height, true, true, true)); }
        if (element.kind == LayoutModifierKind::FillMaxWidth) {
            const auto fraction = clamp(element.fraction, 0.0f, 1.0f);
            return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, constraints.maxWidth * fraction, 0.0f, true, false));
        }
        if (element.kind == LayoutModifierKind::FillMaxHeight) {
            const auto fraction = clamp(element.fraction, 0.0f, 1.0f);
            return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, 0.0f, constraints.maxHeight * fraction, false, true));
        }
        if (element.kind == LayoutModifierKind::FillMaxSize) {
            const auto fraction = clamp(element.fraction, 0.0f, 1.0f);
            return measureWithModifier(tree, id, modifier, index + 1, exact(constraints, constraints.maxWidth * fraction, constraints.maxHeight * fraction, true, true));
        }
        if (element.kind == LayoutModifierKind::WidthIn) {
            if (const auto minWidth = element.minWidth; minWidth >= 0.0f) constraints.minWidth = std::max(constraints.minWidth, minWidth);
            if (const auto maxWidth = element.maxWidth; maxWidth >= 0.0f) constraints.maxWidth = std::min(constraints.maxWidth, maxWidth);
            return measureWithModifier(tree, id, modifier, index + 1, constraints);
        }
        if (element.kind == LayoutModifierKind::HeightIn) {
            if (const auto minHeight = element.minHeight; minHeight >= 0.0f) constraints.minHeight = std::max(constraints.minHeight, minHeight);
            if (const auto maxHeight = element.maxHeight; maxHeight >= 0.0f) constraints.maxHeight = std::min(constraints.maxHeight, maxHeight);
            return measureWithModifier(tree, id, modifier, index + 1, constraints);
        }
        if (element.kind == LayoutModifierKind::SizeIn) {
            if (const auto minWidth = element.minWidth; minWidth >= 0.0f) constraints.minWidth = std::max(constraints.minWidth, minWidth);
            if (const auto maxWidth = element.maxWidth; maxWidth >= 0.0f) constraints.maxWidth = std::min(constraints.maxWidth, maxWidth);
            if (const auto minHeight = element.minHeight; minHeight >= 0.0f) constraints.minHeight = std::max(constraints.minHeight, minHeight);
            if (const auto maxHeight = element.maxHeight; maxHeight >= 0.0f) constraints.maxHeight = std::min(constraints.maxHeight, maxHeight);
            return measureWithModifier(tree, id, modifier, index + 1, constraints);
        }
        if (element.kind == LayoutModifierKind::DefaultMinSize) {
            constraints.minWidth = std::max(constraints.minWidth, element.minWidth);
            constraints.minHeight = std::max(constraints.minHeight, element.minHeight);
            return measureWithModifier(tree, id, modifier, index + 1, constraints);
        }
        if (element.kind == LayoutModifierKind::VerticalScroll) {
            auto unbounded = constraints;
            unbounded.maxHeight = InfiniteConstraint;
            const auto child = measureWithModifier(tree, id, modifier, index + 1, unbounded);
            auto& node = tree.node(id);
            node.bounds.width = clamp(child.width, constraints.minWidth, constraints.maxWidth);
            node.bounds.height = clamp(child.height, constraints.minHeight, constraints.maxHeight);
            return {node.bounds.width, node.bounds.height};
        }
        if (element.kind == LayoutModifierKind::HorizontalScroll) {
            auto unbounded = constraints;
            unbounded.maxWidth = InfiniteConstraint;
            const auto child = measureWithModifier(tree, id, modifier, index + 1, unbounded);
            auto& node = tree.node(id);
            node.bounds.width = clamp(child.width, constraints.minWidth, constraints.maxWidth);
            node.bounds.height = clamp(child.height, constraints.minHeight, constraints.maxHeight);
            return {node.bounds.width, node.bounds.height};
        }

        return measureWithModifier(tree, id, modifier, index + 1, constraints);
    }

    Size LayoutEngine::measureContent(LayoutTree& tree, NodeId id, Constraints constraints) {
        auto& node = tree.node(id);
        Size content;

        switch (node.type) {
        case NodeType::Text: {
            const auto textStyle = textStyleProp(node);
            auto fontSize = textStyle.number("fontSize", 14.0f);
            if (!(fontSize > 0.0f)) fontSize = 14.0f;
            const auto lineHeight = std::max(fontSize, textStyle.number("lineHeight", fontSize * 1.2f));
            const auto maxLines = textMaxLines(node);
            const auto maxWidth = constraints.maxWidth < InfiniteConstraint ? constraints.maxWidth : 0.0f;
            const auto measured = textLayoutService_->measure(node.text, {fontSize, lineHeight}, {maxLines, maxWidth, false});
            content.width = measured.width;
            content.height = measured.height;
            node.baseline = lineHeight * 0.8f;
            break;
        }
        case NodeType::Input: {
            const auto textStyle = textStyleProp(node);
            auto fontSize = textStyle.number("fontSize", 14.0f);
            if (!(fontSize > 0.0f)) fontSize = 14.0f;
            const auto lineHeight = std::max(fontSize, textStyle.number("lineHeight", fontSize * 1.2f));
            const auto text = inputTextProp(node);
            const auto singleLine = encodedBoolProp(node, "singleLine", true);
            const auto minLines = singleLine ? 1 : textMinLines(node);
            const auto maxLines = singleLine ? 1 : textMaxLines(node);
            const auto textMaxWidth = !singleLine && constraints.maxWidth < InfiniteConstraint ? std::max(0.0f, constraints.maxWidth - 16.0f) : 0.0f;
            const auto measured = textLayoutService_->layout(text, {fontSize, lineHeight}, {maxLines, textMaxWidth, singleLine});
            const auto lineCount = std::max(minLines, static_cast<int>(std::max<std::size_t>(1, measured.lines.size())));
            content.width = std::max(120.0f, measured.width + 16.0f);
            content.height = std::max(28.0f, lineHeight * static_cast<float>(lineCount) + 8.0f);
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
                const auto childModifier = modifierMetrics(tree.node(childId));
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
                const auto childModifier = modifierMetrics(tree.node(childId));
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
            content = {width, height};
            break;
        }
        case NodeType::Box: {
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
        case NodeType::Image:
            content.width = 24.0f;
            content.height = 24.0f;
            break;
        case NodeType::Icon: {
            auto iconSize = encodedProp(node, "size").floatValue(-1.0f);
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
        return {node.bounds.width, node.bounds.height};
    }

    void LayoutEngine::place(LayoutTree& tree, NodeId id, float x, float y) {
        auto& node = tree.node(id);
        const auto& modifier = node.modifier;
        const auto offsetX = modifier.transform.layoutOffsetX;
        const auto offsetY = modifier.transform.layoutOffsetY;
        node.bounds.x = x + offsetX;
        node.bounds.y = y + offsetY;
        placeWithModifier(tree, id, modifier, 0, node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height);
    }

    void LayoutEngine::placeWithModifier(LayoutTree& tree, NodeId id, const CompiledModifier& modifier, std::size_t index, float x, float y, float width, float height) {
        if (index >= modifier.layout.size()) {
            placeContent(tree, id, x, y, width, height);
            return;
        }

        const auto& element = modifier.layout[index];
        if (element.kind == LayoutModifierKind::Padding) {
            const auto start = element.padding.start;
            const auto top = element.padding.top;
            const auto end = element.padding.end;
            const auto bottom = element.padding.bottom;
            placeWithModifier(tree, id, modifier, index + 1, x + start, y + top, std::max(0.0f, width - start - end), std::max(0.0f, height - top - bottom));
            return;
        }
        if (element.kind == LayoutModifierKind::VerticalScroll) {
            placeWithModifier(tree, id, modifier, index + 1, x, y - element.scrollValue, width, height);
            return;
        }
        if (element.kind == LayoutModifierKind::HorizontalScroll) {
            placeWithModifier(tree, id, modifier, index + 1, x - element.scrollValue, y, width, height);
            return;
        }

        placeWithModifier(tree, id, modifier, index + 1, x, y, width, height);
    }

    void LayoutEngine::placeContent(LayoutTree& tree, NodeId id, float x, float y, float width, float height) {
        auto& node = tree.node(id);
        if (node.type == NodeType::Row) {
            const auto spacing = rowSpacing(node);
            const auto defaultAlign = nodeAlignmentProp(node, "verticalAlignment", "vertical-alignment", "Top");
            float cursor = x;
            for (auto childId : node.children) {
                auto& child = tree.node(childId);
                const auto childAlign = alignModifier(child);
                const auto offset = crossAxisOffset(height, child.bounds.height, childAlign.empty() ? defaultAlign : childAlign, false);
                place(tree, childId, cursor, y + offset);
                cursor += child.bounds.width + spacing;
            }
            return;
        }

        if (node.type == NodeType::Column) {
            const auto spacing = columnSpacing(node);
            const auto defaultAlign = nodeAlignmentProp(node, "horizontalAlignment", "horizontal-alignment", "Start");
            float cursor = y;
            for (auto childId : node.children) {
                auto& child = tree.node(childId);
                const auto childAlign = alignModifier(child);
                const auto offset = crossAxisOffset(width, child.bounds.width, childAlign.empty() ? defaultAlign : childAlign, true);
                place(tree, childId, x + offset, cursor);
                cursor += child.bounds.height + spacing;
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

    LayoutEngine::ModifierMetrics LayoutEngine::modifierMetrics(const ArrangeNode& node) {
        ModifierMetrics metrics;
        const auto& modifier = node.modifier;
        metrics.weight = modifier.parentData.weight;
        metrics.weightFill = modifier.parentData.weightFill;
        metrics.verticalScroll = modifier.scroll.verticalValue;
        metrics.horizontalScroll = modifier.scroll.horizontalValue;
        metrics.hasVerticalScroll = modifier.scroll.vertical;
        metrics.hasHorizontalScroll = modifier.scroll.horizontal;
        for (const auto& element : modifier.layout) {
            if (element.kind == LayoutModifierKind::Padding) {
                metrics.paddingStart += element.padding.start;
                metrics.paddingTop += element.padding.top;
                metrics.paddingEnd += element.padding.end;
                metrics.paddingBottom += element.padding.bottom;
            }
            else if (element.kind == LayoutModifierKind::Size) {
                metrics.width = element.width;
                metrics.height = element.height;
            }
            else if (element.kind == LayoutModifierKind::Width) metrics.width = element.value;
            else if (element.kind == LayoutModifierKind::Height) metrics.height = element.value;
            else if (element.kind == LayoutModifierKind::FillMaxWidth || element.kind == LayoutModifierKind::FillMaxSize) metrics.fillMaxWidth = true;
            else if (element.kind == LayoutModifierKind::FillMaxHeight || element.kind == LayoutModifierKind::FillMaxSize) metrics.fillMaxHeight = true;
        }
        return metrics;
    }


    float LayoutEngine::rowSpacing(const ArrangeNode& node) { return spacedByValue(propValue(node, "horizontalArrangement", "horizontal-arrangement")); }

    float LayoutEngine::columnSpacing(const ArrangeNode& node) { return spacedByValue(propValue(node, "verticalArrangement", "vertical-arrangement")); }
} // namespace arrange::core
