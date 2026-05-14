#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include "Geometry.h"
#include "LayoutTree.h"
#include "TextLayoutService.h"

namespace arrange::core {
    enum class DrawOpType {
        FillRect,
        StrokeRect,
        DrawText,
        DrawImage,
        DrawIcon,
        PushClip,
        PopClip,
        PushTransform,
        PopTransform,
        DrawLine,
    };

    enum class DrawShapeType {
        Rectangle,
        Rounded,
        Circle,
    };

    struct DrawOp {
        DrawOpType type = DrawOpType::FillRect;
        NodeId nodeId = 0;
        Rect rect;
        std::uint32_t color = 0;
        float strokeWidth = 0.0f;
        float fontSize = 14.0f;
        float lineHeight = 0.0f;
        DrawShapeType shape = DrawShapeType::Rectangle;
        float cornerRadius = 0.0f;
        int maxLines = 0;
        std::string text;
        std::string textAlign;
        std::string overflow;
        std::string resource;
        bool resourceIsIcon = false;
        std::string contentScale;
        std::string alignment;
        bool hasTint = false;
        bool inputText = false;
        Point lineEnd;
        float scaleX = 1.0f;
        float scaleY = 1.0f;
        float rotationZ = 0.0f;
        float transformOriginX = 0.5f;
        float transformOriginY = 0.5f;
    };

    class DrawOpsBuilder {
    public:
        std::vector<DrawOp> collect(const LayoutTree& tree, NodeId root) const;
        static std::string textStyleProp(const ArrangeNode& node);

    private:
        void collectNode(const LayoutTree& tree, NodeId id, std::vector<DrawOp>& ops, float inheritedAlpha = 1.0f) const;
    };

    struct TextInputOverlayRange {
        std::size_t start = 0;
        std::size_t end = 0;
    };

    struct TextInputOverlayState {
        std::string text;
        std::size_t cursorIndex = 0;
        std::size_t selectionStart = 0;
        std::size_t selectionEnd = 0;
        float viewportX = 0.0f;
        std::vector<TextInputOverlayRange> temporaryUnderlines;

        [[nodiscard]] bool hasSelection() const noexcept { return selectionStart != selectionEnd; }
    };

    class TextInputOverlayBuilder final {
    public:
        static bool allowsLineBreak(const ArrangeNode& node);
        static Rect textRect(const ArrangeNode& node, float viewportX);

        std::vector<DrawOp> build(
            const ArrangeNode& node,
            const TextInputOverlayState& state,
            const TextLayoutService& textLayoutService) const;

    private:
        struct Metrics {
            Rect rect;
            float textLeft = 0.0f;
            float textTop = 0.0f;
            float textWidth = 0.0f;
            float textHeight = 0.0f;
            float viewportX = 0.0f;
            float lineHeight = 12.0f;
            float fontSize = 14.0f;
            bool singleLine = true;
        };

        struct Layout {
            Metrics metrics;
            TextLayout text;
        };

        static Metrics metrics(const ArrangeNode& node, float viewportX);
        static Layout layout(const ArrangeNode& node, const std::string& text, float viewportX, const TextLayoutService& textLayoutService);
        static float xForByteIndex(const Layout& layout, const std::string& text, std::size_t index, const TextLayoutService& textLayoutService);
        static std::vector<Rect> textBoundsForByteRange(const Layout& layout, const std::string& text, std::size_t start, std::size_t end, const TextLayoutService& textLayoutService);
        static const TextLineLayout& lineForByteIndex(const Layout& layout, std::size_t index);
    };
} // namespace arrange::core
