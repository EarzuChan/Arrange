#include <arrange/core/ModifierGeometry.h>
#include <arrange/core/Paint.h>
#include <arrange/core/Modifier.h>
#include <arrange/core/PropValue.h>

#include <algorithm>
#include <cstdlib>
#include <cmath>
#include <string>
#include <string_view>
#include <utility>

namespace arrange::core {
    namespace {
        std::string inputValue(const ArrangeNode& node) {
            if (const auto* value = propValue(node, "modelValue", "model-value")) return value->stringOr();
            if (const auto* value = propValue(node, "value")) return value->stringOr();
            return {};
        }

        std::string inputPlaceholder(const ArrangeNode& node) {
            if (const auto* value = propValue(node, "placeholder")) return value->stringOr();
            return {};
        }

        std::string resourceProp(const ArrangeNode& node) {
            const auto resourceFrom = [](const PropValue* value) -> std::string {
                if (value == nullptr) return {};
                if (value->isString()) return value->string;
                if (value->isObject()) {
                    if (const auto* path = value->field("path"); path != nullptr && path->isString()) return path->string;
                    if (const auto* url = value->field("url"); url != nullptr && url->isString()) return url->string;
                }
                return {};
            };
            if (auto resource = resourceFrom(propValue(node, "source")); !resource.empty()) return resource;
            if (auto resource = resourceFrom(propValue(node, "src")); !resource.empty()) return resource;
            return {};
        }

        float numericProp(const ArrangeNode& node, const char* key, float fallback) { return numberProp(node, key, fallback); }

        std::string textProp(const ArrangeNode& node, const char* key, const char* fallback = "") { return stringProp(node, key, fallback); }

        std::string textProp(const ArrangeNode& node, const char* camelCase, const char* kebabCase, const char* fallback) { return stringProp(node, camelCase, kebabCase, fallback); }

        bool hasProp(const ArrangeNode& node, const char* key) { return node.props.find(key) != node.props.end(); }

        bool hasColorUnspecified(const ArrangeNode& node, const char* key) {
            const auto* value = propValue(node, key);
            return value != nullptr && value->isString() && value->string == "Color.Unspecified";
        }

        int lineCount(std::string_view text) {
            if (text.empty()) return 1;
            int lines = 1;
            for (char ch : text) { if (ch == '\n') ++lines; }
            return lines;
        }

        float zIndexOf(const ArrangeNode& node) {
            return node.modifier.zIndex();
        }

        std::vector<NodeId> childrenInPaintOrder(const LayoutTree& tree, const ArrangeNode& node) {
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId left, NodeId right) { return zIndexOf(tree.node(left)) < zIndexOf(tree.node(right)); });
            return children;
        }

        std::uint32_t styleColor(const PaintStyleSemantics& style) {
            return style.color;
        }

        DrawShapeType shapeType(const PaintStyleSemantics& style) {
            if (style.shapeType == "circle") return DrawShapeType::Circle;
            if (style.shapeType == "rounded") return DrawShapeType::Rounded;
            return DrawShapeType::Rectangle;
        }




        std::uint32_t withAlpha(std::uint32_t color, float alpha) {
            const auto clamped = std::clamp(alpha, 0.0f, 1.0f);
            const auto sourceAlpha = static_cast<float>((color >> 24u) & 0xffu);
            const auto nextAlpha = static_cast<std::uint32_t>(std::clamp(sourceAlpha * clamped, 0.0f, 255.0f) + 0.5f);
            return (color & 0x00ffffffu) | (nextAlpha << 24u);
        }
    } // namespace

    std::vector<DrawOp> DrawOpsBuilder::collect(const LayoutTree& tree, NodeId root) const {
        std::vector<DrawOp> ops;
        collectNode(tree, root, ops);
        return ops;
    }

    std::vector<DrawOp> DrawOpsBuilder::collectOverlay(const LayoutTree& tree, NodeId target, const std::vector<DrawOp>& content) const {
        std::vector<DrawOp> ops;
        const auto path = nodePath(tree, target);
        if (path.empty()) return ops;
        std::function<void(std::size_t, float)> wrap = [&](std::size_t index, float alpha) {
            if (index == path.size()) {
                for (auto op : content) { op.color = withAlpha(op.color, alpha); ops.push_back(std::move(op)); }
                return;
            }
            collectModifier(tree, path[index], 0, ops, alpha, [&](float nextAlpha) { wrap(index + 1, nextAlpha); }, true);
        };
        wrap(0, 1.0f);
        return ops;
    }

    void DrawOpsBuilder::collectNode(const LayoutTree& tree, NodeId id, std::vector<DrawOp>& ops, float alpha) const {
        collectModifier(tree, id, 0, ops, alpha);
    }

    void DrawOpsBuilder::collectModifier(const LayoutTree& tree, NodeId id, std::size_t index, std::vector<DrawOp>& ops, float alpha, const std::function<void(float)>& contentOverride, bool geometryOnly) const {
        const auto& chain = tree.node(id).modifier.elements();
        if (index == chain.size()) { if (contentOverride) contentOverride(alpha); else collectContent(tree, id, ops, alpha); return; }
        const auto& instance = chain[index];
        const auto& value = instance.descriptor.value;
        const auto content = [&] { collectModifier(tree, id, index + 1, ops, alpha, contentOverride, geometryOnly); };
        const auto pushClip = [&](const PaintStyleSemantics& shape) {
            DrawOp op;
            op.type = DrawOpType::PushClip;
            op.nodeId = id;
            op.rect = instance.bounds;
            op.shape = shapeType(shape);
            op.cornerRadius = shape.cornerRadius;
            ops.push_back(op);
        };
        const auto pop = [&](DrawOpType type) { DrawOp op; op.type = type; op.nodeId = id; ops.push_back(op); };
        if (const auto* style = std::get_if<PaintStyleSemantics>(&value)) {
            if (style->kind == PaintStyleKind::Alpha) { alpha *= style->alpha; content(); return; }
            if (geometryOnly) { content(); return; }
            const auto overlay = style->kind == PaintStyleKind::Border || style->kind == PaintStyleKind::InnerShadow;
            if (overlay) content();
            if (style->color != 0) {
                DrawOp op;
                op.type = overlay ? DrawOpType::StrokeRect : DrawOpType::FillRect;
                op.nodeId = id;
                op.rect = instance.bounds;
                if (style->kind == PaintStyleKind::DropShadow) { op.rect.x += style->shadowOffset.x; op.rect.y += style->shadowOffset.y; }
                op.color = withAlpha(style->color, alpha);
                op.strokeWidth = style->strokeWidth;
                op.shape = shapeType(*style);
                op.cornerRadius = style->cornerRadius;
                ops.push_back(op);
            }
            if (!overlay) content();
            return;
        }
        if (const auto* clip = std::get_if<ClipModifier>(&value)) {
            pushClip(clip->shape);
            content();
            pop(DrawOpType::PopClip);
            return;
        }
        if (const auto* layer = std::get_if<TransformModifierSemantics>(&value)) {
            DrawOp op;
            op.type = DrawOpType::PushTransform;
            op.nodeId = id;
            op.rect = instance.bounds;
            op.translationX = layer->translationX;
            op.translationY = layer->translationY;
            op.scaleX = layer->scaleX;
            op.scaleY = layer->scaleY;
            op.rotationZ = layer->rotationZ;
            op.transformOriginX = layer->transformOriginX;
            op.transformOriginY = layer->transformOriginY;
            ops.push_back(op);
            alpha *= layer->alpha;
            if (layer->clip) pushClip({});
            content();
            if (layer->clip) pop(DrawOpType::PopClip);
            pop(DrawOpType::PopTransform);
            return;
        }
        if (const auto* layout = std::get_if<LayoutModifierSemantics>(&value); layout && (layout->kind == LayoutModifierKind::VerticalScroll || layout->kind == LayoutModifierKind::HorizontalScroll)) {
            pushClip({});
            content();
            pop(DrawOpType::PopClip);
            return;
        }
        content();
    }

    void DrawOpsBuilder::collectContent(const LayoutTree& tree, NodeId id, std::vector<DrawOp>& ops, float alpha) const {
        const auto& node = tree.node(id);
        const auto contentRect = node.contentBounds;
        if (node.type == NodeType::Text && !node.text.empty()) {
            std::uint32_t textColor = 0xff000000u;
            float fontSize = 14.0f;
            const auto style = objectProp(node, "textStyle", "text-style");
            textColor = style.color("color", textColor);
            fontSize = style.number("fontSize", fontSize);
            const auto lineHeight = std::max(fontSize, style.number("lineHeight", fontSize * 1.2f));
            DrawOp op;
            op.type = DrawOpType::DrawText;
            op.nodeId = id;
            op.rect = contentRect;
            op.color = withAlpha(textColor, alpha);
            op.fontSize = fontSize;
            op.lineHeight = lineHeight;
            op.maxLines = std::max(0, intProp(node, "maxLines", 0));
            op.text = node.text;
            op.textAlign = textProp(node, "textAlign", "start");
            op.overflow = textProp(node, "overflow", "clip");
            if (op.overflow == "clip" || op.overflow == "ellipsis") {
                DrawOp pushClip;
                pushClip.type = DrawOpType::PushClip;
                pushClip.nodeId = id;
                pushClip.rect = contentRect;
                ops.push_back(std::move(pushClip));
                ops.push_back(std::move(op));
                DrawOp popClip;
                popClip.type = DrawOpType::PopClip;
                popClip.nodeId = id;
                ops.push_back(std::move(popClip));
            }
            else {
                ops.push_back(std::move(op));
            }
        }

        if (node.type == NodeType::Input) {
            std::uint32_t textColor = 0xffe8eaedu;
            float fontSize = 14.0f;
            const auto style = objectProp(node, "textStyle", "text-style");
            textColor = style.color("color", textColor);
            fontSize = style.number("fontSize", fontSize);
            const auto lineHeight = style.number("lineHeight", fontSize);
            const auto singleLine = !TextInputOverlayBuilder::allowsLineBreak(node);
            auto text = inputValue(node);
            if (text.empty()) {
                text = inputPlaceholder(node);
                textColor = 0xff8a9099u;
            }
            if (!text.empty()) {
                auto rect = TextInputOverlayBuilder::textRect(node, 0.0f);
                DrawOp op;
                op.type = DrawOpType::DrawText;
                op.nodeId = id;
                op.inputText = true;
                op.rect = rect;
                op.color = withAlpha(textColor, alpha);
                op.fontSize = fontSize;
                op.lineHeight = std::max(fontSize, lineHeight);
                op.text = text;
                op.maxLines = singleLine ? 1 : std::max(1, intProp(node, "maxLines", lineCount(text)));
                ops.push_back(std::move(op));
            }
        }

        if (node.type == NodeType::Image) {
            DrawOp op;
            op.type = DrawOpType::DrawImage;
            op.rect = contentRect;
            op.color = withAlpha(0xffffffffu, alpha * numericProp(node, "alpha", 1.0f));
            op.resource = resourceProp(node);
            op.contentScale = textProp(node, "contentScale", "content-scale", "Fit");
            op.alignment = textProp(node, "alignment", "Center");
            ops.push_back(std::move(op));
        }

        if (node.type == NodeType::Icon) {
            DrawOp op;
            op.type = DrawOpType::DrawIcon;
            op.rect = contentRect;
            op.hasTint = !hasColorUnspecified(node, "tint");
            op.color = withAlpha(colorProp(node, "tint", 0xff000000u), alpha);
            op.resource = resourceProp(node);
            op.resourceIsIcon = true;
            ops.push_back(std::move(op));
        }

        for (auto childId : childrenInPaintOrder(tree, node)) collectNode(tree, childId, ops, alpha);


    }

    std::string DrawOpsBuilder::textStyleProp(const ArrangeNode& node) { return stringProp(node, "textStyle", "text-style", ""); }

    bool TextInputOverlayBuilder::allowsLineBreak(const ArrangeNode& node) {
        if (!boolProp(node, "singleLine", true)) return true;
        if (numberProp(node, "minLines", 1.0f) > 1.0f) return true;
        if (numberProp(node, "maxLines", 1.0f) > 1.0f) return true;
        return false;
    }

    TextInputOverlayBuilder::Metrics TextInputOverlayBuilder::metrics(const ArrangeNode& node, float viewportX) {
        Metrics result;
        result.rect = node.contentBounds;
        const auto style = objectProp(node, "textStyle", "text-style");
        result.fontSize = style.number("fontSize", 14.0f);
        result.singleLine = !allowsLineBreak(node);
        result.textLeft = result.rect.x + 8.0f;
        result.textWidth = std::max(0.0f, result.rect.width - 16.0f);
        result.lineHeight = std::max(result.fontSize, style.number("lineHeight", result.fontSize));
        result.textTop = result.singleLine
                             ? result.rect.y + std::max(0.0f, (result.rect.height - result.lineHeight) * 0.5f)
                             : result.rect.y + 4.0f;
        result.textHeight = result.singleLine ? std::min(result.rect.height, result.lineHeight) : std::max(0.0f, result.rect.height - 8.0f);
        result.viewportX = result.singleLine ? viewportX : 0.0f;
        return result;
    }

    Rect TextInputOverlayBuilder::textRect(const ArrangeNode& node, float viewportX) {
        const auto result = metrics(node, viewportX);
        return {result.textLeft, result.textTop, result.textWidth, result.textHeight};
    }

    TextInputOverlayBuilder::Layout TextInputOverlayBuilder::layout(
        const ArrangeNode& node,
        const std::string& text,
        float viewportX,
        const TextLayoutService& textLayoutService) {
        Layout result;
        result.metrics = metrics(node, viewportX);
        result.text = textLayoutService.layout(
            text,
            {result.metrics.fontSize, result.metrics.lineHeight},
            {result.metrics.singleLine ? 1 : 0, result.metrics.singleLine ? 0.0f : result.metrics.textWidth, result.metrics.singleLine});
        return result;
    }

    const TextLineLayout& TextInputOverlayBuilder::lineForByteIndex(const Layout& layout, std::size_t index) {
        const auto clamped = std::min(index, layout.text.text.size());
        for (const auto& line : layout.text.lines) { if (clamped >= line.start && clamped <= line.end) return line; }
        return layout.text.lines.back();
    }

    float TextInputOverlayBuilder::xForByteIndex(
        const Layout& layout,
        const std::string&,
        std::size_t index,
        const TextLayoutService& textLayoutService) {
        return layout.metrics.textLeft - layout.metrics.viewportX + textLayoutService.xForByteIndex(layout.text, index);
    }

    std::vector<Rect> TextInputOverlayBuilder::textBoundsForByteRange(
        const Layout& layout,
        const std::string& text,
        std::size_t start,
        std::size_t end,
        const TextLayoutService& textLayoutService) {
        std::vector<Rect> bounds;
        start = std::min(start, text.size());
        end = std::min(end, text.size());
        if (end < start) std::swap(start, end);

        if (start == end) {
            const auto rect = textLayoutService.caretRect(
                layout.text,
                start,
                {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop});
            bounds.push_back({rect.x, rect.y, 1.0f, rect.height});
            return bounds;
        }

        for (auto rect : textLayoutService.boundsForRange(
                 layout.text,
                 start,
                 end,
                 {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop})) {
            rect.width = std::max(1.0f, rect.width);
            bounds.push_back(rect);
        }
        return bounds;
    }

    std::vector<DrawOp> TextInputOverlayBuilder::build(
        const ArrangeNode& node,
        const TextInputOverlayState& state,
        const TextLayoutService& textLayoutService) const {
        std::vector<DrawOp> ops;
        const auto inputLayout = layout(node, state.text, state.viewportX, textLayoutService);
        const auto& overlayMetrics = inputLayout.metrics;

        DrawOp focusRing;
        focusRing.type = DrawOpType::StrokeRect;
        focusRing.nodeId = node.id;
        focusRing.rect = overlayMetrics.rect;
        focusRing.color = 0xff7aa2ffu;
        focusRing.strokeWidth = 1.0f;
        ops.push_back(std::move(focusRing));

        DrawOp pushClip;
        pushClip.type = DrawOpType::PushClip;
        pushClip.nodeId = node.id;
        pushClip.rect = {overlayMetrics.textLeft, overlayMetrics.textTop, overlayMetrics.textWidth, overlayMetrics.textHeight};
        ops.push_back(std::move(pushClip));

        if (state.hasSelection()) {
            const auto start = std::min(state.selectionStart, state.selectionEnd);
            const auto end = std::max(state.selectionStart, state.selectionEnd);
            for (const auto& area : textBoundsForByteRange(inputLayout, state.text, start, end, textLayoutService)) {
                DrawOp selection;
                selection.type = DrawOpType::FillRect;
                selection.nodeId = node.id;
                selection.rect = area;
                selection.color = 0x663a7afeu;
                ops.push_back(std::move(selection));
            }
        }

        for (const auto& range : state.temporaryUnderlines) {
            for (const auto& area : textBoundsForByteRange(inputLayout, state.text, range.start, range.end, textLayoutService)) {
                const auto underlineY = area.y + area.height - 2.0f;
                DrawOp underline;
                underline.type = DrawOpType::DrawLine;
                underline.nodeId = node.id;
                underline.rect = {area.x, underlineY, 0.0f, 0.0f};
                underline.lineEnd = {area.x + area.width, underlineY};
                underline.color = 0xff7aa2ffu;
                underline.strokeWidth = 1.0f;
                ops.push_back(std::move(underline));
            }
        }

        const auto cursorX = xForByteIndex(inputLayout, state.text, state.cursorIndex, textLayoutService);
        const auto cursorY = overlayMetrics.singleLine
                                 ? overlayMetrics.textTop
                                 : std::min(
                                     overlayMetrics.textTop + overlayMetrics.textHeight - overlayMetrics.lineHeight,
                                     overlayMetrics.textTop + lineForByteIndex(inputLayout, state.cursorIndex).y);
        DrawOp caret;
        caret.type = DrawOpType::DrawLine;
        caret.nodeId = node.id;
        caret.rect = {cursorX, cursorY, 0.0f, 0.0f};
        caret.lineEnd = {cursorX, cursorY + overlayMetrics.lineHeight};
        caret.color = 0xffe8eaedu;
        caret.strokeWidth = 1.0f;
        ops.push_back(std::move(caret));

        DrawOp popClip;
        popClip.type = DrawOpType::PopClip;
        popClip.nodeId = node.id;
        ops.push_back(std::move(popClip));
        return ops;
    }
} // namespace arrange::core


