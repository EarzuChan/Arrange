#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <optional>
#include <vector>
#include <functional>
#include "Geometry.h"
#include "LayoutTree.h"
#include "TextLayoutService.h"

namespace arrange::core {
    enum class DrawOpType {
        FillRect,
        StrokeRect,
        DrawText,
        DrawPainter,
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
        std::shared_ptr<const TextLayout> textLayout;
        std::string textAlign;
        std::string overflow;
        PainterSnapshot painter;
        std::string contentScale;
        std::string alignment;
        bool hasTint = false;
        bool inputText = false;
        ModifierHandle textField;
        Point lineEnd;
        float translationX = 0.0f;
        float translationY = 0.0f;
        float scaleX = 1.0f;
        float scaleY = 1.0f;
        float rotationZ = 0.0f;
        float transformOriginX = 0.5f;
        float transformOriginY = 0.5f;
        bool operator==(const DrawOp&) const = default;
    };

    struct PaintLayerFragment {
        std::shared_ptr<const TextLayout> textLayout;
        ModifierValue value;
        Rect bounds;
        float contentAlpha = 1;
        std::vector<DrawOp> before;
        std::vector<DrawOp> after;
    };

    struct PaintBounds {
        Rect rect;
        bool known = true;
        bool empty = true;
    };

    struct PaintFragment;
    struct PlacedPaintFragment {
        std::shared_ptr<const PaintFragment> fragment;
        Point offset;
        bool operator==(const PlacedPaintFragment&) const = default;
    };

    // 每个片段是完整的绘制状态作用域，位置属于引用边，稳定命令使用局部坐标
    struct PaintFragment {
        std::shared_ptr<const PaintLayerFragment> layer;
        std::shared_ptr<const std::vector<DrawOp>> content;
        std::vector<PlacedPaintFragment> children;
        PaintBounds bounds;
    };

    PaintBounds drawOpBounds(const DrawOp& op);
    std::vector<DrawOp> exportDrawOps(const PlacedPaintFragment& root);

    struct PaintWorkCounters {
        std::uint64_t nodesBuilt = 0;
        std::uint64_t subtreeCacheHits = 0;
        std::uint64_t layersBuilt = 0;
        std::uint64_t layerCacheHits = 0;
        std::uint64_t emittedOps = 0;
        std::uint64_t contentBuilds = 0;
        std::uint64_t contentReuses = 0;
        std::uint64_t fragmentsBuilt = 0;
        std::uint64_t fragmentsReused = 0;
    };

    class DrawOpsBuilder {
    public:
        explicit DrawOpsBuilder(const TextLayoutService& service = defaultTextLayoutService()) : textLayoutService_(service) {}
        static void prepareText(DrawOp& op, const TextLayoutService& service);
        std::vector<DrawOp> exportScene(const LayoutTree& tree, NodeId root) const;
        PlacedPaintFragment build(LayoutTree& tree, NodeId root, PaintWorkCounters& counters) const;
        std::vector<DrawOp> collectOverlay(const LayoutTree& tree, NodeId target, const std::vector<DrawOp>& content, ModifierHandle receiver = {}) const;

    private:
        const TextLayoutService& textLayoutService_;
        void collectModifier(const LayoutTree& tree, NodeId id, std::size_t index, std::vector<DrawOp>& ops, float alpha, const std::function<void(float)>& contentOverride = {}, bool geometryOnly = false, std::size_t stopAt = static_cast<std::size_t>(-1)) const;
        std::shared_ptr<const PaintFragment> buildFragment(LayoutTree& tree, NodeId id, PaintWorkCounters& counters) const;
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
        static bool allowsLineBreak(const ModifierInstance& instance);
        static Rect textRect(const ModifierInstance& instance, float viewportX);

        std::vector<DrawOp> build(
            NodeId node,
            const ModifierInstance& instance,
            const TextInputOverlayState& state,
            const TextLayoutService& textLayoutService) const;

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
            std::shared_ptr<const TextLayout> text;
        };

        static Metrics metrics(const ModifierInstance& instance, float viewportX);
        static Layout layout(const ModifierInstance& instance, const std::string& text, float viewportX, const TextLayoutService& textLayoutService);
        static std::vector<Rect> textBoundsForByteRange(const Layout& layout, const std::string& text, std::size_t start, std::size_t end, const TextLayoutService& textLayoutService);
    };
} // namespace arrange::core
