#include <arrange/core/Scroll.h>
#include <arrange/core/Modifier.h>

#include <algorithm>
#include <unordered_set>
#include <vector>

namespace arrange::core {
    namespace {
        bool contains(const Rect& rect, Point point) noexcept { return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height; }

        void collectScrollTargets(const LayoutTree& tree, NodeId id, Point point, bool vertical, std::vector<NodeId>& targets, std::unordered_set<NodeId>& visited) {
            if (!tree.contains(id) || !visited.insert(id).second) return;
            const auto& node = tree.node(id);
            if (!contains(node.bounds, point)) return;
            if (vertical ? ScrollDispatcher::hasVerticalScroll(node) : ScrollDispatcher::hasHorizontalScroll(node)) targets.push_back(id);
            for (auto childId : node.children) collectScrollTargets(tree, childId, point, vertical, targets, visited);
        }
    } // namespace

    ScrollResult ScrollDispatcher::verticalWheel(const LayoutTree& tree, NodeId root, Point point, float wheelDeltaY, float pixelsPerWheelUnit) const {
        if (!tree.contains(root) || wheelDeltaY == 0.0f) return {};
        std::vector<NodeId> targets;
        std::unordered_set<NodeId> visited;
        collectScrollTargets(tree, root, point, true, targets, visited);
        if (targets.empty()) return {};

        ScrollResult blocked;
        for (auto it = targets.rbegin(); it != targets.rend(); ++it) {
            const auto& node = tree.node(*it);
            const auto contentHeight = verticalContentHeight(tree, node);
            const auto maxValue = std::max(0.0f, contentHeight - node.bounds.height);
            const auto current = verticalScrollValue(node);
            const auto next = std::clamp(current - wheelDeltaY * pixelsPerWheelUnit, 0.0f, maxValue);
            const auto eventSlot = nativeScrollEventSlot(node, EventSlotKind::VerticalScroll);
            if (!blocked.target) blocked = {false, *it, current, maxValue, node.bounds.height, contentHeight, eventSlot};
            if (next == current) continue;
            return {true, *it, next, maxValue, node.bounds.height, contentHeight, eventSlot};
        }
        return blocked;
    }

    ScrollResult ScrollDispatcher::horizontalWheel(const LayoutTree& tree, NodeId root, Point point, float wheelDeltaX, float pixelsPerWheelUnit) const {
        if (!tree.contains(root) || wheelDeltaX == 0.0f) return {};
        std::vector<NodeId> targets;
        std::unordered_set<NodeId> visited;
        collectScrollTargets(tree, root, point, false, targets, visited);
        if (targets.empty()) return {};

        ScrollResult blocked;
        for (auto it = targets.rbegin(); it != targets.rend(); ++it) {
            const auto& node = tree.node(*it);
            const auto contentWidth = horizontalContentWidth(tree, node);
            const auto maxValue = std::max(0.0f, contentWidth - node.bounds.width);
            const auto current = horizontalScrollValue(node);
            const auto next = std::clamp(current - wheelDeltaX * pixelsPerWheelUnit, 0.0f, maxValue);
            const auto eventSlot = nativeScrollEventSlot(node, EventSlotKind::HorizontalScroll);
            if (!blocked.target) blocked = {false, *it, current, maxValue, node.bounds.width, contentWidth, eventSlot};
            if (next == current) continue;
            return {true, *it, next, maxValue, node.bounds.width, contentWidth, eventSlot};
        }
        return blocked;
    }

    bool ScrollDispatcher::hasVerticalScroll(const ArrangeNode& node) {
        return node.modifier.scroll.vertical;
    }

    bool ScrollDispatcher::hasHorizontalScroll(const ArrangeNode& node) {
        return node.modifier.scroll.horizontal;
    }

    float ScrollDispatcher::verticalScrollValue(const ArrangeNode& node) {
        return hasVerticalScroll(node) ? node.modifier.scroll.verticalValue : 0.0f;
    }

    float ScrollDispatcher::horizontalScrollValue(const ArrangeNode& node) {
        return hasHorizontalScroll(node) ? node.modifier.scroll.horizontalValue : 0.0f;
    }

    float ScrollDispatcher::verticalContentHeight(const LayoutTree& tree, const ArrangeNode& node) {
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

    float ScrollDispatcher::horizontalContentWidth(const LayoutTree& tree, const ArrangeNode& node) {
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

    EventSlotId ScrollDispatcher::nativeScrollEventSlot(const ArrangeNode& node, EventSlotKind kind) {
        if (kind == EventSlotKind::VerticalScroll) return node.modifier.scroll.verticalEventSlot;
        if (kind == EventSlotKind::HorizontalScroll) return node.modifier.scroll.horizontalEventSlot;
        return {};
    }

    NodeId ScrollDispatcher::findVerticalScrollTarget(const LayoutTree& tree, NodeId id, Point point, NodeId fallback) {
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

    NodeId ScrollDispatcher::findHorizontalScrollTarget(const LayoutTree& tree, NodeId id, Point point, NodeId fallback) {
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
