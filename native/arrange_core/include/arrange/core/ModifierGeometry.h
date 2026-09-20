#pragma once

#include "Modifier.h"
#include "LayoutTree.h"

namespace arrange::core {
    std::vector<NodeId> nodePath(const LayoutTree& tree, NodeId node);
    bool nodeInteractionEnabled(const LayoutTree& tree, NodeId node);
    Point rootToNodeContent(const LayoutTree& tree, NodeId node, Point point, ModifierHandle receiver = {});
    Point nodeContentToRoot(const LayoutTree& tree, NodeId node, Point point, ModifierHandle receiver = {});
    Rect nodeContentRectToRoot(const LayoutTree& tree, NodeId node, Rect rect, ModifierHandle receiver = {});
    bool containsRect(Rect bounds, Point point) noexcept;
    bool containsShape(Rect bounds, const PaintStyleSemantics& shape, Point point) noexcept;
    Point inverseLayerPoint(Point point, Rect bounds, const TransformModifierSemantics& transform) noexcept;
    // 绘制和命中使用同一层 bounds；坐标逆变换只在 graphicsLayer 所在层进行。
    bool enterModifier(const ModifierInstance& instance, Point& point) noexcept;
} // namespace arrange::core
