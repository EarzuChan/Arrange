#include <arrange/core/HitTest.h>
#include <arrange/core/Modifier.h>
#include <arrange/core/PropValue.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <unordered_set>
#include <vector>

namespace arrange::core {
    namespace {
        bool containsRect(Rect rect, Point point) noexcept { return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height; }

        bool nodeWantsClick(const ArrangeNode& node) {
            return node.modifier.input.clickable;
        }

        bool clipsChildren(const ArrangeNode& node) {
            return !node.modifier.paint.clips.empty() || node.modifier.scroll.vertical || node.modifier.scroll.horizontal;
        }

        float zIndexOf(const ArrangeNode& node) {
            return node.modifier.zIndex;
        }


        Point inverseLayerPoint(Point point, Rect bounds, float scaleX, float scaleY, float rotationZ, float originX, float originY) {
            constexpr float kPi = 3.14159265358979323846f;
            constexpr float kMinScale = 0.0001f;
            if (std::fabs(scaleX) < kMinScale || std::fabs(scaleY) < kMinScale) { return {std::numeric_limits<float>::infinity(), std::numeric_limits<float>::infinity()}; }

            const auto pivotX = bounds.x + bounds.width * originX;
            const auto pivotY = bounds.y + bounds.height * originY;
            const auto rotation = -rotationZ * kPi / 180.0f;
            const auto cosTheta = std::cos(rotation);
            const auto sinTheta = std::sin(rotation);
            const auto dx = point.x - pivotX;
            const auto dy = point.y - pivotY;
            const auto unrotatedX = dx * cosTheta - dy * sinTheta;
            const auto unrotatedY = dx * sinTheta + dy * cosTheta;
            return {pivotX + unrotatedX / scaleX, pivotY + unrotatedY / scaleY};
        }

        Point inverseGraphicsLayerPoint(const ArrangeNode& node, Point point) {
            const auto& transform = node.modifier.transform;
            if (!transform.hasPaintTransform) return point;
            return inverseLayerPoint(
                point,
                node.bounds,
                transform.scaleX,
                transform.scaleY,
                transform.rotationZ,
                transform.transformOriginX,
                transform.transformOriginY);
        }


        std::vector<NodeId> childrenInPaintOrder(const LayoutTree& tree, const ArrangeNode& node) {
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId left, NodeId right) { return zIndexOf(tree.node(left)) < zIndexOf(tree.node(right)); });
            return children;
        }

        HitTestResult hitTestNode(const LayoutTree& tree, NodeId root, Point point, bool clickableOnly, std::unordered_set<NodeId>& visiting) {
            if (!tree.contains(root) || !visiting.insert(root).second) return {};
            const auto& node = tree.node(root);
            const auto nodePoint = inverseGraphicsLayerPoint(node, point);
            const auto insideNode = containsRect(node.bounds, nodePoint);
            if (!insideNode && clipsChildren(node)) return {};

            const auto children = childrenInPaintOrder(tree, node);
            for (auto it = children.rbegin(); it != children.rend(); ++it) {
                const auto child = hitTestNode(tree, *it, nodePoint, clickableOnly, visiting);
                if (child.hit) return child;
            }

            if (clickableOnly) {
                if (insideNode && nodeWantsClick(node)) return {true, root, true};
                return {};
            }
            return insideNode ? HitTestResult{true, root, nodeWantsClick(node)} : HitTestResult{};
        }
    } // namespace

    bool HitTester::contains(Rect rect, Point point) noexcept { return containsRect(rect, point); }

    bool HitTester::wantsClick(const ArrangeNode& node) { return nodeWantsClick(node); }

    HitTestResult HitTester::hitTest(const LayoutTree& tree, NodeId root, Point point) const {
        std::unordered_set<NodeId> visiting;
        return hitTestNode(tree, root, point, false, visiting);
    }

    HitTestResult HitTester::hitTestClickable(const LayoutTree& tree, NodeId root, Point point) const {
        std::unordered_set<NodeId> visiting;
        return hitTestNode(tree, root, point, true, visiting);
    }
} // namespace arrange::core
