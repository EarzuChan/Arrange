#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "Geometry.h"
#include "RenderTree.h"

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
        std::string contentScale;
        std::string alignment;
        bool hasTint = false;
        bool inputText = false;
        float scaleX = 1.0f;
        float scaleY = 1.0f;
        float rotationZ = 0.0f;
        float transformOriginX = 0.5f;
        float transformOriginY = 0.5f;
    };

    class PaintModel {
    public:
        std::vector<DrawOp> collect(const RenderTree& tree, NodeId root) const;

    private:
        void collectNode(const RenderTree& tree, NodeId id, std::vector<DrawOp>& ops, float inheritedAlpha = 1.0f) const;
        static std::string textStyleProp(const ArrangeNode& node);
    };
} // namespace arrange::core
