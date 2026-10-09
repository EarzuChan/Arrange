#pragma once

#include "FocusTypes.h"
#include "LayoutTree.h"
#include "Scroll.h"
#include "SlotUpdate.h"
#include <optional>

namespace arrange::core {
    struct FocusObservation {
        EventSlotId slot;
        bool isFocused = false;
        bool hasFocus = false;
        bool operator==(const FocusObservation&) const = default;
    };

    struct FocusTarget {
        NodeHandle node;
        ModifierHandle modifier;
        Rect bounds;
        std::uint32_t requester = 0;
        std::array<std::uint32_t, 6> directions{};
        std::vector<std::uint64_t> groups;
        std::vector<FocusObservation> observers;
        EventSlotId click;
        bool editable = false;

        bool operator==(const FocusTarget& other) const {
            return node == other.node && modifier == other.modifier;
        }
    };

    using FocusSnapshot = std::vector<FocusTarget>;
    FocusSnapshot buildFocusSnapshot(const LayoutTree& tree);
    std::optional<FocusTarget> findFocusRequester(const FocusSnapshot& snapshot, std::uint32_t requester);
    std::optional<FocusTarget> searchFocus(const FocusSnapshot& snapshot, const std::optional<FocusTarget>& current, FocusDirection direction);
    std::optional<FocusTarget> pointerFocusTarget(const LayoutTree& tree, const FocusSnapshot& snapshot, NodeId hit, Point point);
    std::vector<std::pair<EventSlotId, ScrollResult>> focusScrollIntoView(const LayoutTree& tree, const FocusTarget& target);
    std::optional<std::pair<EventSlotId, ScrollResult>> focusKeyboardScroll(const LayoutTree& tree, NodeId node, int operation);
}
