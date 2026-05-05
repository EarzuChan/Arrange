#include <arrange/core/Scroll.h>
#include <arrange/core/Modifier.h>
#include <arrange/core/PropValue.h>

#include <algorithm>
#include <charconv>
#include <string>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace arrange::core {
    namespace {
        bool contains(const Rect& rect, Point point) noexcept { return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height; }

        bool modifierHasType(const ArrangeNode& node, const char* type) {
            const auto elements = parseModifierElements(node);
            return std::any_of(elements.begin(), elements.end(), [type](const auto& element) { return element.type == type; });
        }

        float scrollValueFromModifier(const ArrangeNode& node, const char* type) {
            for (const auto& element : parseModifierElements(node)) { if (element.type == type) return std::max(0.0f, element.number("state.value", element.number("value"))); }
            return 0.0f;
        }

        std::uint32_t scrollCallbackFromModifier(const ArrangeNode& node) {
            for (const auto& element : parseModifierElements(node)) {
                if (element.type == "verticalScroll" || element.type == "horizontalScroll") {
                    if (const auto handle = element.handle("state.__arrangeNativeScroll.callbackHandle"); handle != 0) return handle;
                    if (const auto handle = element.handle("__arrangeNativeScroll.callbackHandle"); handle != 0) return handle;
                    if (const auto handle = element.handle("callbackHandle"); handle != 0) return handle;
                }
            }
            return 0;
        }

        void collectScrollTargets(const RenderTree& tree, NodeId id, Point point, const char* type, std::vector<NodeId>& targets, std::unordered_set<NodeId>& visited) {
            if (!tree.contains(id) || !visited.insert(id).second) return;
            const auto& node = tree.node(id);
            if (!contains(node.bounds, point)) return;
            if (std::string_view(type) == "verticalScroll") {
                const auto it = node.props.find("__arrangeVerticalScrollEnabled");
                if (it != node.props.end() ? EncodedProp(it->second).boolValue(false) : modifierHasType(node, type)) targets.push_back(id);
            }
            else {
                const auto it = node.props.find("__arrangeHorizontalScrollEnabled");
                if (it != node.props.end() ? EncodedProp(it->second).boolValue(false) : modifierHasType(node, type)) targets.push_back(id);
            }
            for (auto childId : node.children) collectScrollTargets(tree, childId, point, type, targets, visited);
        }
    } // namespace

    ScrollResult ScrollDispatcher::verticalWheel(RenderTree& tree, NodeId root, Point point, float wheelDeltaY, float pixelsPerWheelUnit) const {
        if (!tree.contains(root) || wheelDeltaY == 0.0f) return {};
        std::vector<NodeId> targets;
        std::unordered_set<NodeId> visited;
        collectScrollTargets(tree, root, point, "verticalScroll", targets, visited);
        if (targets.empty()) return {};

        ScrollResult blocked;
        for (auto it = targets.rbegin(); it != targets.rend(); ++it) {
            auto& node = tree.node(*it);
            const auto contentHeight = verticalContentHeight(tree, node);
            const auto maxValue = std::max(0.0f, contentHeight - node.bounds.height);
            const auto current = verticalScrollValue(node);
            const auto next = std::clamp(current - wheelDeltaY * pixelsPerWheelUnit, 0.0f, maxValue);
            const auto callbackHandle = nativeScrollCallbackHandle(node, "__arrangeVerticalScrollCallback");
            if (!blocked.target) blocked = {false, *it, current, maxValue, node.bounds.height, contentHeight, callbackHandle};
            if (next == current) continue;

            setVerticalScrollValue(node, next);
            return {true, *it, next, maxValue, node.bounds.height, contentHeight, callbackHandle};
        }
        return blocked;
    }

    ScrollResult ScrollDispatcher::horizontalWheel(RenderTree& tree, NodeId root, Point point, float wheelDeltaX, float pixelsPerWheelUnit) const {
        if (!tree.contains(root) || wheelDeltaX == 0.0f) return {};
        std::vector<NodeId> targets;
        std::unordered_set<NodeId> visited;
        collectScrollTargets(tree, root, point, "horizontalScroll", targets, visited);
        if (targets.empty()) return {};

        ScrollResult blocked;
        for (auto it = targets.rbegin(); it != targets.rend(); ++it) {
            auto& node = tree.node(*it);
            const auto contentWidth = horizontalContentWidth(tree, node);
            const auto maxValue = std::max(0.0f, contentWidth - node.bounds.width);
            const auto current = horizontalScrollValue(node);
            const auto next = std::clamp(current - wheelDeltaX * pixelsPerWheelUnit, 0.0f, maxValue);
            const auto callbackHandle = nativeScrollCallbackHandle(node, "__arrangeHorizontalScrollCallback");
            if (!blocked.target) blocked = {false, *it, current, maxValue, node.bounds.width, contentWidth, callbackHandle};
            if (next == current) continue;

            setHorizontalScrollValue(node, next);
            return {true, *it, next, maxValue, node.bounds.width, contentWidth, callbackHandle};
        }
        return blocked;
    }

    bool ScrollDispatcher::hasVerticalScroll(const ArrangeNode& node) {
        if (node.props.contains("__arrangeVerticalScrollEnabled")) return encodedBoolProp(node, "__arrangeVerticalScrollEnabled", false);
        return modifierHasType(node, "verticalScroll");
    }

    bool ScrollDispatcher::hasHorizontalScroll(const ArrangeNode& node) {
        if (node.props.contains("__arrangeHorizontalScrollEnabled")) return encodedBoolProp(node, "__arrangeHorizontalScrollEnabled", false);
        return modifierHasType(node, "horizontalScroll");
    }

    float ScrollDispatcher::verticalScrollValue(const ArrangeNode& node) {
        if (node.props.contains("__arrangeVerticalScrollValue")) return std::max(0.0f, encodedNumberProp(node, "__arrangeVerticalScrollValue", 0.0f));
        if (!hasVerticalScroll(node)) return 0.0f;
        return scrollValueFromModifier(node, "verticalScroll");
    }

    float ScrollDispatcher::horizontalScrollValue(const ArrangeNode& node) {
        if (node.props.contains("__arrangeHorizontalScrollValue")) return std::max(0.0f, encodedNumberProp(node, "__arrangeHorizontalScrollValue", 0.0f));
        if (!hasHorizontalScroll(node)) return 0.0f;
        return scrollValueFromModifier(node, "horizontalScroll");
    }

    void ScrollDispatcher::setVerticalScrollValue(ArrangeNode& node, float value) {
        node.props["__arrangeVerticalScrollValue"] = "f:" + std::to_string(std::max(0.0f, value));
        markDirty(node, DirtyFlag::Layout);
        markDirty(node, DirtyFlag::Paint);
        markDirty(node, DirtyFlag::HitTest);
    }

    void ScrollDispatcher::setHorizontalScrollValue(ArrangeNode& node, float value) {
        node.props["__arrangeHorizontalScrollValue"] = "f:" + std::to_string(std::max(0.0f, value));
        markDirty(node, DirtyFlag::Layout);
        markDirty(node, DirtyFlag::Paint);
        markDirty(node, DirtyFlag::HitTest);
    }

    float ScrollDispatcher::verticalContentHeight(const RenderTree& tree, const ArrangeNode& node) {
        if (node.children.empty()) return node.bounds.height;
        float top = 0.0f;
        float bottom = 0.0f;
        bool first = true;
        for (auto childId : node.children) {
            if (!tree.contains(childId)) continue;
            const auto& child = tree.node(childId);
            if (first) {
                top = child.bounds.y;
                bottom = child.bounds.y + child.bounds.height;
                first = false;
                continue;
            }
            top = std::min(top, child.bounds.y);
            bottom = std::max(bottom, child.bounds.y + child.bounds.height);
        }
        if (first) return node.bounds.height;
        return std::max(0.0f, bottom - top);
    }

    float ScrollDispatcher::horizontalContentWidth(const RenderTree& tree, const ArrangeNode& node) {
        if (node.children.empty()) return node.bounds.width;
        float left = 0.0f;
        float right = 0.0f;
        bool first = true;
        for (auto childId : node.children) {
            if (!tree.contains(childId)) continue;
            const auto& child = tree.node(childId);
            if (first) {
                left = child.bounds.x;
                right = child.bounds.x + child.bounds.width;
                first = false;
                continue;
            }
            left = std::min(left, child.bounds.x);
            right = std::max(right, child.bounds.x + child.bounds.width);
        }
        if (first) return node.bounds.width;
        return std::max(0.0f, right - left);
    }

    std::uint32_t ScrollDispatcher::nativeScrollCallbackHandle(const ArrangeNode& node, const char* nativeProp) {
        if (const auto handle = encodedHandleProp(node, nativeProp); handle != 0) return handle;
        return scrollCallbackFromModifier(node);
    }

    NodeId ScrollDispatcher::findVerticalScrollTarget(const RenderTree& tree, NodeId id, Point point, NodeId fallback) {
        std::unordered_set<NodeId> visited;
        auto currentFallback = fallback;
        std::vector<NodeId> stack{id};
        while (!stack.empty()) {
            const auto current = stack.back();
            stack.pop_back();
            if (!tree.contains(current) || !visited.insert(current).second) continue;
            const auto& node = tree.node(current);
            if (!contains(node.bounds, point)) continue;
            if (hasVerticalScroll(node)) currentFallback = current;
            for (auto childId : node.children) stack.push_back(childId);
        }
        return currentFallback;
    }

    NodeId ScrollDispatcher::findHorizontalScrollTarget(const RenderTree& tree, NodeId id, Point point, NodeId fallback) {
        std::unordered_set<NodeId> visited;
        auto currentFallback = fallback;
        std::vector<NodeId> stack{id};
        while (!stack.empty()) {
            const auto current = stack.back();
            stack.pop_back();
            if (!tree.contains(current) || !visited.insert(current).second) continue;
            const auto& node = tree.node(current);
            if (!contains(node.bounds, point)) continue;
            if (hasHorizontalScroll(node)) currentFallback = current;
            for (auto childId : node.children) stack.push_back(childId);
        }
        return currentFallback;
    }
} // namespace arrange::core
