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
            auto value = propValue(node, "modelValue", "model-value");
            if (value.empty()) { if (const auto it = node.props.find("value"); it != node.props.end()) value = it->second; }
            return decodeStringProp(value);
        }

        std::string inputPlaceholder(const ArrangeNode& node) {
            if (const auto it = node.props.find("placeholder"); it != node.props.end()) return decodeStringProp(it->second);
            return {};
        }

        std::string resourceProp(const ArrangeNode& node) {
            if (const auto it = node.props.find("source"); it != node.props.end()) return decodeStringProp(it->second);
            return {};
        }

        float encodedFloatProp(const ArrangeNode& node, const char* key, float fallback) { return encodedNumberProp(node, key, fallback); }

        std::string encodedStringProp(const ArrangeNode& node, const char* key, const char* fallback = "") { return encodedProp(node, key).stringValue(fallback); }

        std::string encodedStringProp(const ArrangeNode& node, const char* camelCase, const char* kebabCase, const char* fallback) {
            const auto value = propValue(node, camelCase, kebabCase);
            return value.empty() ? std::string(fallback) : EncodedProp(value).stringValue(fallback);
        }

        bool hasProp(const ArrangeNode& node, const char* key) { return node.props.find(key) != node.props.end(); }

        int lineCount(std::string_view text) {
            if (text.empty()) return 1;
            int lines = 1;
            for (char ch : text) { if (ch == '\n') ++lines; }
            return lines;
        }

        Rect inputTextRect(Rect contentRect, float fontSize, float lineHeight, bool singleLine) {
            auto rect = contentRect;
            rect.x += 8.0f;
            rect.width = rect.width > 16.0f ? rect.width - 16.0f : rect.width;
            const auto effectiveLineHeight = std::max(fontSize, lineHeight);
            if (singleLine) {
                rect.y += std::max(0.0f, (rect.height - effectiveLineHeight) * 0.5f);
                rect.height = std::min(rect.height, effectiveLineHeight);
                return rect;
            }
            rect.y += 4.0f;
            rect.height = rect.height > 8.0f ? rect.height - 8.0f : rect.height;
            return rect;
        }

        Rect shrink(Rect rect, const ModifierElement& element) {
            const auto start = std::max(0.0f, element.number("start"));
            const auto top = std::max(0.0f, element.number("top"));
            const auto end = std::max(0.0f, element.number("end"));
            const auto bottom = std::max(0.0f, element.number("bottom"));
            rect.x += start;
            rect.y += top;
            rect.width = std::max(0.0f, rect.width - start - end);
            rect.height = std::max(0.0f, rect.height - top - bottom);
            return rect;
        }

        float zIndexOf(const ArrangeNode& node) {
            if (hasProp(node, "__arrangeZIndex")) return encodedFloatProp(node, "__arrangeZIndex", 0.0f);
            for (const auto& element : parseModifierElements(node)) { if (element.type == "zIndex") return element.number("value"); }
            return 0.0f;
        }

        std::vector<NodeId> childrenInPaintOrder(const RenderTree& tree, const ArrangeNode& node) {
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId left, NodeId right) { return zIndexOf(tree.node(left)) < zIndexOf(tree.node(right)); });
            return children;
        }

        std::uint32_t modifierColor(const ModifierElement& element, std::string_view key, std::uint32_t fallback = 0) {
            if (element.has(key)) return element.color(key, fallback);
            const auto colorKey = std::string(key) + ".color";
            if (element.has(colorKey)) return element.color(colorKey, fallback);
            return fallback;
        }

        DrawShapeType parseShapeType(const ModifierElement& element) {
            const auto type = element.string("shape.type");
            if (type == "circle") return DrawShapeType::Circle;
            if (type == "rounded") return DrawShapeType::Rounded;
            return DrawShapeType::Rectangle;
        }

        float parseCornerRadius(const ModifierElement& element) {
            if (parseShapeType(element) != DrawShapeType::Rounded) return 0.0f;
            return std::max(0.0f, element.number("shape.radius"));
        }

        std::pair<float, float> parseTransformOrigin(const ModifierElement& element) {
            const auto value = element.string("transformOrigin");
            if (value == "TopStart") return {0.0f, 0.0f};
            if (value == "TopCenter") return {0.5f, 0.0f};
            if (value == "TopEnd") return {1.0f, 0.0f};
            if (value == "CenterStart") return {0.0f, 0.5f};
            if (value == "CenterEnd") return {1.0f, 0.5f};
            if (value == "BottomStart") return {0.0f, 1.0f};
            if (value == "BottomCenter") return {0.5f, 1.0f};
            if (value == "BottomEnd") return {1.0f, 1.0f};
            if (element.has("transformOrigin.x") || element.has("transformOrigin.y")) {
                return {
                    std::clamp(element.number("transformOrigin.x", 0.5f), 0.0f, 1.0f),
                    std::clamp(element.number("transformOrigin.y", 0.5f), 0.0f, 1.0f),
                };
            }
            return {0.5f, 0.5f};
        }

        bool needsPaintTransform(const ModifierElement& element) {
            if (element.type != "graphicsLayer") return false;
            const auto scaleX = element.number("scaleX", 1.0f);
            const auto scaleY = element.number("scaleY", 1.0f);
            const auto rotationZ = element.number("rotationZ");
            return std::fabs(scaleX - 1.0f) > 0.0001f || std::fabs(scaleY - 1.0f) > 0.0001f || std::fabs(rotationZ) > 0.0001f;
        }

        bool hasModifierType(const ArrangeNode& node, const char* type) {
            const auto elements = parseModifierElements(node);
            return std::any_of(elements.begin(), elements.end(), [type](const auto& element) { return element.type == type; });
        }

        bool needsTypedPaintTransform(const ArrangeNode& node) {
            const auto scaleX = encodedFloatProp(node, "__arrangeLayerScaleX", 1.0f);
            const auto scaleY = encodedFloatProp(node, "__arrangeLayerScaleY", 1.0f);
            const auto rotationZ = encodedFloatProp(node, "__arrangeLayerRotationZ", 0.0f);
            return std::fabs(scaleX - 1.0f) > 0.0001f || std::fabs(scaleY - 1.0f) > 0.0001f || std::fabs(rotationZ) > 0.0001f;
        }

        std::pair<float, float> typedTransformOrigin(const ArrangeNode& node) {
            return {
                std::clamp(encodedFloatProp(node, "__arrangeLayerTransformOriginX", 0.5f), 0.0f, 1.0f),
                std::clamp(encodedFloatProp(node, "__arrangeLayerTransformOriginY", 0.5f), 0.0f, 1.0f),
            };
        }

        std::uint32_t withAlpha(std::uint32_t color, float alpha) {
            const auto clamped = std::clamp(alpha, 0.0f, 1.0f);
            const auto sourceAlpha = static_cast<float>((color >> 24u) & 0xffu);
            const auto nextAlpha = static_cast<std::uint32_t>(std::clamp(sourceAlpha * clamped, 0.0f, 255.0f) + 0.5f);
            return (color & 0x00ffffffu) | (nextAlpha << 24u);
        }
    } // namespace

    std::vector<DrawOp> PaintModel::collect(const RenderTree& tree, NodeId root) const {
        std::vector<DrawOp> ops;
        collectNode(tree, root, ops);
        return ops;
    }

    void PaintModel::collectNode(const RenderTree& tree, NodeId id, std::vector<DrawOp>& ops, float inheritedAlpha) const {
        const auto& node = tree.node(id);
        auto contentRect = node.bounds;
        std::vector<DrawOpType> popStack;
        float alpha = inheritedAlpha;

        if (!hasModifierType(node, "graphicsLayer") && needsTypedPaintTransform(node)) {
            const auto origin = typedTransformOrigin(node);
            DrawOp transform;
            transform.type = DrawOpType::PushTransform;
            transform.rect = node.bounds;
            transform.scaleX = encodedFloatProp(node, "__arrangeLayerScaleX", 1.0f);
            transform.scaleY = encodedFloatProp(node, "__arrangeLayerScaleY", 1.0f);
            transform.rotationZ = encodedFloatProp(node, "__arrangeLayerRotationZ", 0.0f);
            transform.transformOriginX = origin.first;
            transform.transformOriginY = origin.second;
            ops.push_back(transform);
            popStack.push_back(DrawOpType::PopTransform);
        }

        for (const auto& element : parseModifierElements(node)) {
            const auto color = modifierColor(element, "color");
            const auto brush = modifierColor(element, "brush");
            if (element.type == "dropShadow" && color != 0) {
                auto rect = contentRect;
                rect.x += element.number("offsetX", element.number("offset.x"));
                rect.y += element.number("offsetY", element.number("offset.y"));
                DrawOp op;
                op.type = DrawOpType::FillRect;
                op.rect = rect;
                op.color = withAlpha(color, alpha);
                op.shape = parseShapeType(element);
                op.cornerRadius = parseCornerRadius(element);
                ops.push_back(std::move(op));
            }
            else if (element.type == "innerShadow" && color != 0) {
                DrawOp op;
                op.type = DrawOpType::StrokeRect;
                op.rect = contentRect;
                op.color = withAlpha(color, alpha);
                op.strokeWidth = std::max(1.0f, element.number("width", 1.0f));
                op.shape = parseShapeType(element);
                op.cornerRadius = parseCornerRadius(element);
                ops.push_back(std::move(op));
            }
            else if (element.type == "alpha") { alpha *= std::clamp(element.number("value", 1.0f), 0.0f, 1.0f); }
            else if (element.type == "background" && brush != 0) {
                DrawOp op;
                op.type = DrawOpType::FillRect;
                op.rect = contentRect;
                op.color = withAlpha(brush, alpha);
                op.shape = parseShapeType(element);
                op.cornerRadius = parseCornerRadius(element);
                ops.push_back(std::move(op));
            }
            else if (element.type == "border" && brush != 0) {
                DrawOp op;
                op.type = DrawOpType::StrokeRect;
                op.rect = contentRect;
                op.color = withAlpha(brush, alpha);
                op.strokeWidth = element.number("width", 1.0f);
                op.shape = parseShapeType(element);
                op.cornerRadius = parseCornerRadius(element);
                ops.push_back(std::move(op));
            }
            else if (element.type == "padding") { contentRect = shrink(contentRect, element); }
            else if (element.type == "clip" || element.type == "verticalScroll" || element.type == "horizontalScroll") {
                DrawOp clip;
                clip.type = DrawOpType::PushClip;
                clip.rect = contentRect;
                clip.shape = parseShapeType(element);
                clip.cornerRadius = parseCornerRadius(element);
                ops.push_back(clip);
                popStack.push_back(DrawOpType::PopClip);
            }
            else if (needsPaintTransform(element)) {
                const auto origin = parseTransformOrigin(element);
                DrawOp transform;
                transform.type = DrawOpType::PushTransform;
                transform.rect = node.bounds;
                transform.scaleX = element.number("scaleX", 1.0f);
                transform.scaleY = element.number("scaleY", 1.0f);
                transform.rotationZ = element.number("rotationZ");
                transform.transformOriginX = origin.first;
                transform.transformOriginY = origin.second;
                ops.push_back(transform);
                popStack.push_back(DrawOpType::PopTransform);
            }
        }

        if (node.type == NodeType::Text && !node.text.empty()) {
            std::uint32_t textColor = 0xff000000u;
            float fontSize = 14.0f;
            const auto style = objectFromEncodedProp(EncodedProp(textStyleProp(node)));
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
            op.maxLines = std::max(0, encodedIntProp(node, "maxLines", 0));
            op.text = node.text;
            op.textAlign = encodedStringProp(node, "textAlign", "start");
            op.overflow = encodedStringProp(node, "overflow", "clip");
            ops.push_back(std::move(op));
        }

        if (node.type == NodeType::Input) {
            std::uint32_t textColor = 0xffe8eaedu;
            float fontSize = 14.0f;
            const auto style = objectFromEncodedProp(EncodedProp(textStyleProp(node)));
            textColor = style.color("color", textColor);
            fontSize = style.number("fontSize", fontSize);
            const auto lineHeight = style.number("lineHeight", fontSize);
            const auto singleLine = encodedBoolProp(node, "singleLine", true);
            auto text = inputValue(node);
            if (text.empty()) {
                text = inputPlaceholder(node);
                textColor = 0xff8a9099u;
            }
            if (!text.empty()) {
                auto rect = inputTextRect(contentRect, fontSize, lineHeight, singleLine);
                DrawOp op;
                op.type = DrawOpType::DrawText;
                op.nodeId = id;
                op.inputText = true;
                op.rect = rect;
                op.color = withAlpha(textColor, alpha);
                op.fontSize = fontSize;
                op.lineHeight = std::max(fontSize, lineHeight);
                op.text = text;
                op.maxLines = singleLine ? 1 : std::max(1, encodedIntProp(node, "maxLines", lineCount(text)));
                ops.push_back(std::move(op));
            }
        }

        if (node.type == NodeType::Image) {
            DrawOp op;
            op.type = DrawOpType::DrawImage;
            op.rect = contentRect;
            op.hasTint = hasProp(node, "tint");
            op.color = withAlpha(encodedColorProp(node, "tint", 0xffffffffu), alpha * encodedFloatProp(node, "alpha", 1.0f));
            op.resource = resourceProp(node);
            op.contentScale = encodedStringProp(node, "contentScale", "content-scale", "Fit");
            op.alignment = encodedStringProp(node, "alignment", "Center");
            ops.push_back(std::move(op));
        }

        if (node.type == NodeType::Icon) {
            DrawOp op;
            op.type = DrawOpType::DrawIcon;
            op.rect = contentRect;
            op.color = withAlpha(encodedColorProp(node, "tint", 0xff000000u), alpha);
            op.resource = resourceProp(node);
            ops.push_back(std::move(op));
        }

        for (auto childId : childrenInPaintOrder(tree, node)) collectNode(tree, childId, ops, alpha);

        for (auto it = popStack.rbegin(); it != popStack.rend(); ++it) {
            DrawOp pop;
            pop.type = *it;
            ops.push_back(pop);
        }
    }

    std::string PaintModel::textStyleProp(const ArrangeNode& node) {
        if (const auto it = node.props.find("textStyle"); it != node.props.end()) return it->second;
        if (const auto it = node.props.find("text-style"); it != node.props.end()) return it->second;
        return {};
    }
} // namespace arrange::core
