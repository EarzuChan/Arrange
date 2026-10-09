#pragma once
#include <arrange/core/Focus.h>
#include <functional>
#include <utility>

namespace arrange::juce {
    class FocusOwner {
       public:
        void reset();
        void synchronize(const arrange::core::LayoutTree& tree, bool interactive, const std::vector<arrange::core::FocusCommand>& commands = {});
        bool set(std::optional<arrange::core::FocusTarget> target);

        const std::optional<arrange::core::FocusTarget>& target() const noexcept {
            return focused_;
        }

        const std::optional<arrange::core::NodeId>& focusedNode() const noexcept {
            return focusedNode_;
        }

        const arrange::core::FocusSnapshot& snapshot() const noexcept {
            return snapshot_;
        }

        std::vector<arrange::core::FocusObservation> takeChanges();
        std::vector<arrange::core::FocusDirection> takeMoves();

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
        arrange::core::FocusSnapshot snapshot_;
        std::optional<arrange::core::FocusTarget> focused_;
        std::optional<arrange::core::NodeId> focusedNode_;
        std::optional<std::uint32_t> pendingRequester_;
        std::vector<arrange::core::FocusObservation> changes_;
        std::vector<arrange::core::FocusDirection> moves_;
        bool scrollRequested_ = false;
        bool identityChanged_ = false;
    };
}
