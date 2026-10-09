#include <arrange/core/Focus.h>
#include <arrange/core/ModifierGeometry.h>
#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <stdexcept>
#include <unordered_set>

namespace arrange::core {
    FocusSnapshot buildFocusSnapshot(const LayoutTree& tree) {
        FocusSnapshot result;
        std::unordered_set<std::uint32_t> requesters;
        const std::function<void(NodeId, std::vector<std::uint64_t>, std::vector<FocusObservation>)> visit = [&](NodeId id, std::vector<std::uint64_t> groups, std::vector<FocusObservation> ancestors) {
            if (!nodeInteractionEnabled(tree, id)) return;
            const auto& node = tree.node(id);
            std::uint32_t requester = 0;
            std::array<std::uint32_t, 6> directions{};
            bool canFocus = true;
            std::vector<FocusObservation> observers;
            bool hasReceiver = false;
            for (const auto& instance : node.modifier.elements()) {
                if (const auto* focus = std::get_if<FocusModifier>(&instance.descriptor.value)) {
                    if (focus->kind == FocusModifierKind::Group) groups.push_back(instance.handle.identity);
                    if (focus->kind == FocusModifierKind::Requester) requester = focus->requester;
                    if (focus->kind == FocusModifierKind::Properties) {
                        directions = focus->directions;
                        canFocus = focus->canFocus;
                    }
                    if (focus->kind == FocusModifierKind::Observer && focus->eventSlot.valid()) observers.push_back({focus->eventSlot, true, true});
                    continue;
                }
                const auto* field = std::get_if<TextFieldModifier>(&instance.descriptor.value);
                const auto* input = std::get_if<InputModifierSemantics>(&instance.descriptor.value);
                const auto eligible = field && field->enabled || input && input->enabled && (input->kind == InputModifierKind::Focusable || input->kind == InputModifierKind::Clickable && input->focusable);
                // 同一 Layout 的显式 focusable 与内建编辑/点击语义组成一个焦点受体。
                if (!eligible || hasReceiver) continue;
                hasReceiver = true;
                if (!canFocus) continue;
                if (requester && !requesters.insert(requester).second) throw std::invalid_argument("FocusRequester 不能绑定多个存活焦点受体");
                FocusTarget target{{id, node.generation}, instance.handle, nodeContentRectToRoot(tree, id, instance.bounds, instance.handle), requester, directions, groups, observers};
                target.observers.insert(target.observers.begin(), ancestors.begin(), ancestors.end());
                for (const auto& member : node.modifier.elements()) {
                    if (const auto* editor = std::get_if<TextFieldModifier>(&member.descriptor.value); editor && editor->enabled) {
                        target.modifier = member.handle;
                        target.editable = true;
                        target.bounds = nodeContentRectToRoot(tree, id, member.bounds, member.handle);
                    }
                    if (const auto* click = std::get_if<InputModifierSemantics>(&member.descriptor.value); click && click->kind == InputModifierKind::Clickable && click->enabled) target.click = click->eventSlot;
                }
                result.push_back(std::move(target));
            }
            for (auto observer : observers) {
                observer.isFocused = false;
                ancestors.push_back(observer);
            }
            for (const auto child : node.children) visit(child, groups, ancestors);
        };
        for (const auto id : tree.nodeIds())
            if (!tree.parentOf(id)) visit(id, {}, {});
        return result;
    }

    std::optional<FocusTarget> findFocusRequester(const FocusSnapshot& snapshot, std::uint32_t requester) {
        if (!requester) return {};
        for (const auto& target : snapshot)
            if (target.requester == requester) return target;
        return {};
    }

    std::optional<FocusTarget> searchFocus(const FocusSnapshot& snapshot, const std::optional<FocusTarget>& current, FocusDirection direction) {
        if (snapshot.empty()) return {};
        if (!current) return direction == FocusDirection::Previous ? snapshot.back() : snapshot.front();
        if (const auto explicitTarget = current->directions[static_cast<std::size_t>(direction)]) return findFocusRequester(snapshot, explicitTarget);
        auto found = std::find(snapshot.begin(), snapshot.end(), *current);
        if (direction == FocusDirection::Next || direction == FocusDirection::Previous) {
            if (found == snapshot.end()) return direction == FocusDirection::Previous ? snapshot.back() : snapshot.front();
            const auto index = static_cast<std::size_t>(found - snapshot.begin());
            return snapshot[(index + (direction == FocusDirection::Next ? 1 : snapshot.size() - 1)) % snapshot.size()];
        }
        const auto horizontal = direction == FocusDirection::Left || direction == FocusDirection::Right;
        const auto positive = direction == FocusDirection::Right || direction == FocusDirection::Down;
        const auto center = [](Rect r, bool x) {
            return x ? r.x + r.width * 0.5f : r.y + r.height * 0.5f;
        };
        for (std::size_t depth = current->groups.size() + 1; depth > 0; --depth) {
            const auto groupDepth = depth - 1;
            const FocusTarget* best = nullptr;
            double bestScore = std::numeric_limits<double>::infinity();
            for (const auto& candidate : snapshot) {
                if (candidate == *current) continue;
                if (groupDepth && (candidate.groups.size() < groupDepth || !std::equal(current->groups.begin(), current->groups.begin() + groupDepth, candidate.groups.begin()))) continue;
                const auto major = (center(candidate.bounds, horizontal) - center(current->bounds, horizontal)) * (positive ? 1 : -1);
                if (major <= 0) continue;
                const auto minor = std::abs(center(candidate.bounds, !horizontal) - center(current->bounds, !horizontal));
                const auto start = horizontal ? candidate.bounds.y : candidate.bounds.x;
                const auto end = start + (horizontal ? candidate.bounds.height : candidate.bounds.width);
                const auto ownStart = horizontal ? current->bounds.y : current->bounds.x;
                const auto ownEnd = ownStart + (horizontal ? current->bounds.height : current->bounds.width);
                const auto beam = start < ownEnd && end > ownStart;
                const auto score = (beam ? 0.0 : 1e18) + 13.0 * major * major + minor * minor;
                if (score < bestScore) {
                    best = &candidate;
                    bestScore = score;
                }
            }
            if (best) return *best;
        }
        return {};
    }

    std::optional<FocusTarget> pointerFocusTarget(const LayoutTree& tree, const FocusSnapshot& snapshot, NodeId hit, Point point) {
        auto path = nodePath(tree, hit);
        for (auto id = path.rbegin(); id != path.rend(); ++id)
            for (const auto& target : snapshot)
                if (target.node.id == *id && containsRect(target.bounds, point)) return target;
        return {};
    }

    std::vector<std::pair<EventSlotId, ScrollResult>> focusScrollIntoView(const LayoutTree& tree, const FocusTarget& target) {
        std::vector<std::pair<EventSlotId, ScrollResult>> results;
        auto bounds = target.bounds;
        auto path = nodePath(tree, target.node.id);
        for (auto id = path.rbegin(); id != path.rend(); ++id) {
            const auto& elements = tree.node(*id).modifier.elements();
            bool beforeReceiver = *id != target.node.id;
            for (auto instance = elements.rbegin(); instance != elements.rend(); ++instance) {
                if (*id == target.node.id && instance->handle == target.modifier) beforeReceiver = true;
                if (!beforeReceiver) continue;
                const auto* input = std::get_if<LayoutModifierSemantics>(&instance->descriptor.value);
                if (!input || !input->enabled || (input->kind != LayoutModifierKind::VerticalScroll && input->kind != LayoutModifierKind::HorizontalScroll)) continue;
                const auto horizontal = input->kind == LayoutModifierKind::HorizontalScroll;
                const std::array<Point, 4> corners{{{bounds.x, bounds.y}, {bounds.x + bounds.width, bounds.y}, {bounds.x, bounds.y + bounds.height}, {bounds.x + bounds.width, bounds.y + bounds.height}}};
                auto start = std::numeric_limits<float>::infinity();
                auto end = -std::numeric_limits<float>::infinity();
                for (const auto corner : corners) {
                    const auto point = rootToNodeContent(tree, *id, corner, instance->handle);
                    const auto value = horizontal ? point.x : point.y;
                    start = std::min(start, value);
                    end = std::max(end, value);
                }
                const auto viewportStart = horizontal ? instance->bounds.x : instance->bounds.y;
                const auto viewportEnd = viewportStart + (horizontal ? instance->bounds.width : instance->bounds.height);
                const auto delta = start < viewportStart ? start - viewportStart : end > viewportEnd ? (end - start > viewportEnd - viewportStart ? start - viewportStart : end - viewportEnd) : 0;
                if (!delta) continue;
                const auto previous = ScrollDispatcher::snapshot(*instance).value;
                const auto scroll = ScrollDispatcher::targetWheel(tree, {*id, instance->handle, horizontal}, -delta, 1);
                if (scroll.consumed) {
                    results.emplace_back(scroll.eventSlot, scroll);
                    const auto consumed = scroll.value - previous;
                    const auto a = nodeContentToRoot(tree, *id, {0, 0}, instance->handle);
                    const auto b = nodeContentToRoot(tree, *id, {horizontal ? consumed : 0, horizontal ? 0 : consumed}, instance->handle);
                    bounds.x -= b.x - a.x;
                    bounds.y -= b.y - a.y;
                }
            }
        }
        return results;
    }

    std::optional<std::pair<EventSlotId, ScrollResult>> focusKeyboardScroll(const LayoutTree& tree, NodeId node, int operation) {
        auto path = nodePath(tree, node);
        for (auto id = path.rbegin(); id != path.rend(); ++id) {
            const auto& elements = tree.node(*id).modifier.elements();
            for (auto instance = elements.rbegin(); instance != elements.rend(); ++instance) {
                const auto* input = std::get_if<LayoutModifierSemantics>(&instance->descriptor.value);
                if (!input || !input->enabled || (input->kind != LayoutModifierKind::VerticalScroll && input->kind != LayoutModifierKind::HorizontalScroll)) continue;
                const auto metrics = ScrollDispatcher::snapshot(*instance);
                const auto value = operation == -2 ? 0 : operation == 2 ? metrics.maxValue : metrics.value + metrics.viewportSize * operation;
                auto result = ScrollDispatcher::targetWheel(tree, {*id, instance->handle, input->kind == LayoutModifierKind::HorizontalScroll}, metrics.value - value, 1);
                return std::pair{result.eventSlot, result};
            }
        }
        return {};
    }
}
