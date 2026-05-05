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
            if (const auto it = node.props.find("__arrangeClickableEnabled"); it != node.props.end()) { return EncodedProp(it->second).boolValue(false); }
            for (const auto& element : parseModifierElements(node)) { if (element.type == "clickable") return true; }
            return false;
        }

        bool hasModifierType(const ArrangeNode& node, const char* type) {
            const auto elements = parseModifierElements(node);
            return std::any_of(elements.begin(), elements.end(), [type](const auto& element) { return element.type == type; });
        }

        float zIndexOf(const ArrangeNode& node) {
            if (node.props.find("__arrangeZIndex") != node.props.end()) return encodedNumberProp(node, "__arrangeZIndex", 0.0f);
            for (const auto& element : parseModifierElements(node)) { if (element.type == "zIndex") return element.number("value"); }
            return 0.0f;
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
            if (!hasModifierType(node, "graphicsLayer")) {
                point = inverseLayerPoint(
                    point,
                    node.bounds,
                    encodedNumberProp(node, "__arrangeLayerScaleX", 1.0f),
                    encodedNumberProp(node, "__arrangeLayerScaleY", 1.0f),
                    encodedNumberProp(node, "__arrangeLayerRotationZ", 0.0f),
                    std::clamp(encodedNumberProp(node, "__arrangeLayerTransformOriginX", 0.5f), 0.0f, 1.0f),
                    std::clamp(encodedNumberProp(node, "__arrangeLayerTransformOriginY", 0.5f), 0.0f, 1.0f));
                return point;
            }

            const auto elements = parseModifierElements(node);
            for (auto it = elements.rbegin(); it != elements.rend(); ++it) {
                if (it->type != "graphicsLayer") continue;

                const auto scaleX = it->number("scaleX", 1.0f);
                const auto scaleY = it->number("scaleY", 1.0f);

                auto originX = 0.5f;
                auto originY = 0.5f;
                const auto transformOrigin = it->string("transformOrigin");
                if (transformOrigin == "TopStart") {
                    originX = 0.0f;
                    originY = 0.0f;
                }
                else if (transformOrigin == "TopCenter") {
                    originX = 0.5f;
                    originY = 0.0f;
                }
                else if (transformOrigin == "TopEnd") {
                    originX = 1.0f;
                    originY = 0.0f;
                }
                else if (transformOrigin == "CenterStart") {
                    originX = 0.0f;
                    originY = 0.5f;
                }
                else if (transformOrigin == "CenterEnd") {
                    originX = 1.0f;
                    originY = 0.5f;
                }
                else if (transformOrigin == "BottomStart") {
                    originX = 0.0f;
                    originY = 1.0f;
                }
                else if (transformOrigin == "BottomCenter") {
                    originX = 0.5f;
                    originY = 1.0f;
                }
                else if (transformOrigin == "BottomEnd") {
                    originX = 1.0f;
                    originY = 1.0f;
                }
                else {
                    if (it->has("transformOrigin.x")) originX = it->number("transformOrigin.x", originX);
                    if (it->has("transformOrigin.y")) originY = it->number("transformOrigin.y", originY);
                }

                point = inverseLayerPoint(point, node.bounds, scaleX, scaleY, it->number("rotationZ"), originX, originY);
            }
            return point;
        }

        std::vector<NodeId> childrenInPaintOrder(const RenderTree& tree, const ArrangeNode& node) {
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId left, NodeId right) { return zIndexOf(tree.node(left)) < zIndexOf(tree.node(right)); });
            return children;
        }

        HitTestResult hitTestNode(const RenderTree& tree, NodeId root, Point point, bool clickableOnly, std::unordered_set<NodeId>& visiting) {
            if (!tree.contains(root) || !visiting.insert(root).second) return {};
            const auto& node = tree.node(root);
            const auto nodePoint = inverseGraphicsLayerPoint(node, point);
            if (!containsRect(node.bounds, nodePoint)) return {};

            const auto children = childrenInPaintOrder(tree, node);
            for (auto it = children.rbegin(); it != children.rend(); ++it) {
                const auto child = hitTestNode(tree, *it, nodePoint, clickableOnly, visiting);
                if (child.hit) return child;
            }

            if (clickableOnly) {
                if (nodeWantsClick(node)) return {true, root, true};
                return {};
            }
            return {true, root, nodeWantsClick(node)};
        }
    } // namespace

    bool HitTester::contains(Rect rect, Point point) noexcept { return containsRect(rect, point); }

    bool HitTester::wantsClick(const ArrangeNode& node) { return nodeWantsClick(node); }

    HitTestResult HitTester::hitTest(const RenderTree& tree, NodeId root, Point point) const {
        std::unordered_set<NodeId> visiting;
        return hitTestNode(tree, root, point, false, visiting);
    }

    HitTestResult HitTester::hitTestClickable(const RenderTree& tree, NodeId root, Point point) const {
        std::unordered_set<NodeId> visiting;
        return hitTestNode(tree, root, point, true, visiting);
    }
} // namespace arrange::core
