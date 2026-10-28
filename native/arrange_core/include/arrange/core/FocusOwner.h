#pragma once
#include "Focus.h"
#include <functional>
#include <utility>

namespace arrange::core {
    class FocusOwner {
       public:
        void reset();
        void synchronize(const LayoutTree& tree, bool interactive, const std::vector<FocusCommand>& commands = {});
        bool set(std::optional<FocusTarget> target);

        const std::optional<FocusTarget>& target() const noexcept {
            return focused_;
        }

        const std::optional<NodeId>& focusedNode() const noexcept {
            return focusedNode_;
        }

        const FocusSnapshot& snapshot() const noexcept {
            return snapshot_;
        }

        std::vector<FocusObservation> takeChanges();
        std::vector<FocusDirection> takeMoves();

        bool takeScrollRequest() noexcept {
            return std::exchange(scrollRequested_, false);
        }

        bool takeIdentityChange() noexcept {
            return std::exchange(identityChanged_, false);
        }

        bool hasPendingRequest() const noexcept {
            return pendingRequester_.has_value();
        }

       private:
        FocusSnapshot snapshot_;
        std::optional<FocusTarget> focused_;
        std::optional<NodeId> focusedNode_;
        std::optional<std::uint32_t> pendingRequester_;
        std::vector<FocusObservation> changes_;
        std::vector<FocusDirection> moves_;
        bool scrollRequested_ = false;
        bool identityChanged_ = false;
    };
}
