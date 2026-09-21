#include <arrange/core/Scroll.h>
#include <arrange/core/ModifierGeometry.h>

#include <algorithm>
#include <vector>

namespace arrange::core {
    namespace {
        bool isScroll(const ModifierInstance& instance, bool vertical) {
            const auto* value = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value);
            return value && value->enabled && value->kind == (vertical ? LayoutModifierKind::VerticalScroll : LayoutModifierKind::HorizontalScroll);
        }

        const ModifierInstance* innerScroll(const LayoutNode& node, bool vertical) {
            const auto& chain = node.modifier.elements();
            for (auto it = chain.rbegin(); it != chain.rend(); ++it)
                if (isScroll(*it, vertical)) return &*it;
            return nullptr;
        }

        struct ScrollTarget {
            NodeId node;
            const ModifierInstance* instance;
        };

        bool collectTargets(const LayoutTree& tree, NodeId id, Point point, bool vertical, std::vector<ScrollTarget>& targets) {
            if (!nodeInteractionEnabled(tree, id)) return false;
            const auto& node = tree.node(id);
            const auto initialSize = targets.size();
            for (const auto& instance : node.modifier.elements()) {
                if (!enterModifier(instance, point)) return targets.size() != initialSize;
                if (isScroll(instance, vertical) && containsRect(instance.bounds, point)) targets.push_back({id, &instance});
            }
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId a, NodeId b) { return tree.node(a).modifier.zIndex() < tree.node(b).modifier.zIndex(); });
            for (auto it = children.rbegin(); it != children.rend(); ++it)
                if (collectTargets(tree, *it, point, vertical, targets)) break;
            return targets.size() != initialSize || containsRect(node.contentBounds, point);
        }

        ScrollResult wheel(const LayoutTree& tree, NodeId root, Point point, float delta, float pixels, bool vertical, const PendingScrollValues* pending) {
            if (delta == 0) return {};
            std::vector<ScrollTarget> targets;
            collectTargets(tree, root, point, vertical, targets);
            ScrollResult blocked;
            for (auto it = targets.rbegin(); it != targets.rend(); ++it) {
                const auto& instance = *it->instance;
                const auto& input = std::get<LayoutModifierSemantics>(instance.descriptor.value);
                auto metrics = ScrollDispatcher::snapshot(instance);
                const auto current = pending && pending->contains(instance.handle.identity) ? pending->at(instance.handle.identity) : metrics.value;
                const auto next = std::clamp(current - delta * pixels, 0.0f, metrics.maxValue);
                metrics.value = next;
                ScrollResult result{metrics, next != current, it->node, input.eventSlot, instance.handle};
                if (result.consumed) return result;
                if (!blocked.target) blocked = result;
            }
            return blocked;
        }
    }  // namespace

    ScrollSnapshot ScrollDispatcher::snapshot(const ModifierInstance& instance) {
        const auto& input = std::get<LayoutModifierSemantics>(instance.descriptor.value);
        const auto vertical = input.kind == LayoutModifierKind::VerticalScroll;
        const auto viewport = vertical ? instance.measured.height : instance.measured.width;
        const auto content = vertical ? instance.childMeasured.height : instance.childMeasured.width;
        const auto maximum = std::max(0.0f, content - viewport);
        return {std::clamp(input.scrollValue, 0.0f, maximum), maximum, viewport, content};
    }

    ScrollResult ScrollDispatcher::verticalWheel(const LayoutTree& tree, NodeId root, Point point, float delta, float pixels, const PendingScrollValues* pending) const {
        return wheel(tree, root, point, delta, pixels, true, pending);
    }

    ScrollResult ScrollDispatcher::horizontalWheel(const LayoutTree& tree, NodeId root, Point point, float delta, float pixels, const PendingScrollValues* pending) const {
        return wheel(tree, root, point, delta, pixels, false, pending);
    }

    bool ScrollDispatcher::hasVerticalScroll(const LayoutNode& node) {
        return innerScroll(node, true) != nullptr;
    }

    bool ScrollDispatcher::hasHorizontalScroll(const LayoutNode& node) {
        return innerScroll(node, false) != nullptr;
    }

    float ScrollDispatcher::verticalScrollValue(const LayoutNode& node) {
        auto* instance = innerScroll(node, true);
        return instance ? snapshot(*instance).value : 0;
    }

    float ScrollDispatcher::horizontalScrollValue(const LayoutNode& node) {
        auto* instance = innerScroll(node, false);
        return instance ? snapshot(*instance).value : 0;
    }

    float ScrollDispatcher::verticalContentHeight(const LayoutTree&, const LayoutNode& node) {
        auto* instance = innerScroll(node, true);
        return instance ? instance->childMeasured.height : node.contentBounds.height;
    }

    float ScrollDispatcher::horizontalContentWidth(const LayoutTree&, const LayoutNode& node) {
        auto* instance = innerScroll(node, false);
        return instance ? instance->childMeasured.width : node.contentBounds.width;
    }

    EventSlotId ScrollDispatcher::nativeScrollEventSlot(const LayoutNode& node, EventSlotKind kind) {
        auto* instance = innerScroll(node, kind == EventSlotKind::VerticalScroll);
        return instance ? std::get<LayoutModifierSemantics>(instance->descriptor.value).eventSlot : EventSlotId{};
    }

    NodeId ScrollDispatcher::findVerticalScrollTarget(const LayoutTree& tree, NodeId id, Point point, NodeId fallback) {
        std::vector<ScrollTarget> targets;
        collectTargets(tree, id, point, true, targets);
        return targets.empty() ? fallback : targets.back().node;
    }

    NodeId ScrollDispatcher::findHorizontalScrollTarget(const LayoutTree& tree, NodeId id, Point point, NodeId fallback) {
        std::vector<ScrollTarget> targets;
        collectTargets(tree, id, point, false, targets);
        return targets.empty() ? fallback : targets.back().node;
    }
}  // namespace arrange::core
