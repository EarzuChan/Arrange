#pragma once

#include "EventSlot.h"
#include "Geometry.h"

#include <cstdint>
#include <string>
#include <vector>
#include <optional>

namespace arrange::core {
    enum class DirtyFlag : std::uint32_t {
        Structure = 1,
        Layout = 2,
        Paint = 4,
        Transform = 8,
        HitTest = 16,
        Focus = 32,
        Accessibility = 64,
        Resource = 128,
        EventSlot = 256,
    };

    inline constexpr std::uint32_t dirtyMask(DirtyFlag flag) noexcept { return static_cast<std::uint32_t>(flag); }

    struct ArrangeNode;


    struct ModifierPadding {
        float start = 0.0f;
        float top = 0.0f;
        float end = 0.0f;
        float bottom = 0.0f;
    };

    enum class LayoutModifierKind {
        Padding,
        Width,
        Height,
        Size,
        RequiredWidth,
        RequiredHeight,
        RequiredSize,
        FillMaxWidth,
        FillMaxHeight,
        FillMaxSize,
        WidthIn,
        HeightIn,
        SizeIn,
        DefaultMinSize,
        VerticalScroll,
        HorizontalScroll,
    };

    struct LayoutModifierSemantics {
        LayoutModifierKind kind = LayoutModifierKind::Padding;
        ModifierPadding padding;
        float value = 0.0f;
        float width = 0.0f;
        float height = 0.0f;
        float fraction = 1.0f;
        float minWidth = -1.0f;
        float maxWidth = -1.0f;
        float minHeight = -1.0f;
        float maxHeight = -1.0f;
        float scrollValue = 0.0f;
    };

    struct ParentDataModifierSemantics {
        float weight = 0.0f;
        bool weightFill = true;
        std::string align;
    };

    enum class PaintStyleKind {
        Background,
        Border,
        Alpha,
        DropShadow,
        InnerShadow,
    };

    struct PaintStyleSemantics {
        PaintStyleKind kind = PaintStyleKind::Background;
        Rect inset;
        std::uint32_t color = 0;
        std::uint32_t brush = 0;
        float strokeWidth = 1.0f;
        std::string shapeType;
        float cornerRadius = 0.0f;
        float alpha = 1.0f;
        Point shadowOffset;
    };

    enum class PaintChainOpKind {
        Style,
        ContentPadding,
        Clip,
    };

    struct PaintChainOp {
        PaintChainOpKind kind = PaintChainOpKind::Style;
        PaintStyleSemantics style;
        ModifierPadding padding;
    };

    struct PaintModifierSemantics {
        std::vector<PaintChainOp> chain;
        std::vector<PaintStyleSemantics> styles;
        std::vector<PaintStyleSemantics> clips;
    };

    struct InputModifierSemantics {
        bool clickable = false;
        bool hoverable = false;
        bool focusable = false;
        bool pointerInput = false;
        EventSlotId clickEventSlot;
    };

    struct TransformModifierSemantics {
        float layoutOffsetX = 0.0f;
        float layoutOffsetY = 0.0f;
        float translationX = 0.0f;
        float translationY = 0.0f;
        float scaleX = 1.0f;
        float scaleY = 1.0f;
        float rotationZ = 0.0f;
        float transformOriginX = 0.5f;
        float transformOriginY = 0.5f;
        bool hasPaintTransform = false;
    };

    struct ScrollModifierSemantics {
        bool vertical = false;
        bool horizontal = false;
        float verticalValue = 0.0f;
        float horizontalValue = 0.0f;
        EventSlotId verticalEventSlot;
        EventSlotId horizontalEventSlot;
    };

    struct CompiledModifier {
        std::vector<LayoutModifierSemantics> layout;
        std::vector<ModifierPadding> paintContentPadding;
        ParentDataModifierSemantics parentData;
        PaintModifierSemantics paint;
        InputModifierSemantics input;
        TransformModifierSemantics transform;
        ScrollModifierSemantics scroll;
        float zIndex = 0.0f;
    };

    struct CompiledModifierDiff {
        std::uint32_t dirtyMask = 0;
    };


    [[nodiscard]] CompiledModifierDiff diffCompiledModifier(const CompiledModifier& before, const CompiledModifier& after);

} // namespace arrange::core


