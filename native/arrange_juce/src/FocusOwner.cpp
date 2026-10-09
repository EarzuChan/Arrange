#include <arrange/juce/FocusOwner.h>
#include <arrange/core/ModifierGeometry.h>
#include <algorithm>
#include <utility>

namespace arrange::juce {
    void FocusOwner::reset() {
        snapshot_.clear();
        focused_.reset();
        focusedNode_.reset();
        pendingRequester_.reset();
        changes_.clear();
        moves_.clear();
        scrollRequested_ = false;
        identityChanged_ = false;
    }

    bool FocusOwner::set(std::optional<arrange::core::FocusTarget> target) {
        const auto same = focused_ && target && *focused_ == *target;
        if (!focused_ && !target) return false;
        if (focused_)
            for (const auto& previous : focused_->observers) {
                const auto next = target ? std::find_if(target->observers.begin(), target->observers.end(), [&](const auto& value) { return value.slot == previous.slot; }) : std::vector<arrange::core::FocusObservation>::const_iterator{};
                if (!target || next == target->observers.end())
                    changes_.push_back({previous.slot, false, false});
                else if (*next != previous)
                    changes_.push_back(*next);
            }
        if (target)
            for (const auto& next : target->observers) {
                if (!focused_ || std::none_of(focused_->observers.begin(), focused_->observers.end(), [&](const auto& value) { return value.slot == next.slot; })) changes_.push_back(next);
            }
        if (!same) identityChanged_ = true;
        focused_ = std::move(target);
        focusedNode_ = focused_ ? std::optional<arrange::core::NodeId>{focused_->node.id} : std::nullopt;
        if (!same) scrollRequested_ = focused_.has_value();
        return !same;
    }

    void FocusOwner::synchronize(const arrange::core::LayoutTree& tree, bool interactive, const std::vector<arrange::core::FocusCommand>& commands) {
        snapshot_ = interactive ? arrange::core::buildFocusSnapshot(tree) : arrange::core::FocusSnapshot{};
        if (focused_) {
            const auto found = std::find(snapshot_.begin(), snapshot_.end(), *focused_);
            (void)set(found == snapshot_.end() ? std::optional<arrange::core::FocusTarget>{} : std::optional<arrange::core::FocusTarget>{*found});
        }
        for (const auto& command : commands) {
            switch (command.kind) {
                case arrange::core::FocusCommandKind::Request:
                    moves_.clear();
                    pendingRequester_ = command.requester;
                    if (const auto target = arrange::core::findFocusRequester(snapshot_, command.requester)) {
                        (void)set(target);
                        pendingRequester_.reset();
                    }
                    break;
                case arrange::core::FocusCommandKind::Cancel:
                    if (pendingRequester_ == command.requester) pendingRequester_.reset();
                    break;
                case arrange::core::FocusCommandKind::Clear:
                    pendingRequester_.reset();
                    moves_.clear();
                    (void)set({});
                    break;
                case arrange::core::FocusCommandKind::Move: {
                    pendingRequester_.reset();
                    bool lazy = false;
                    if (focused_)
                        for (const auto id : arrange::core::nodePath(tree, focused_->node.id))
                            if (std::holds_alternative<arrange::core::LazyMeasurePolicy>(tree.node(id).measurePolicy)) lazy = true;
                    if (lazy)
                        moves_.push_back(command.direction);
                    else if (const auto target = arrange::core::searchFocus(snapshot_, focused_, command.direction))
                        (void)set(target);
                    break;
                }
            }
        }
        if (pendingRequester_)
            if (const auto target = arrange::core::findFocusRequester(snapshot_, *pendingRequester_)) {
                (void)set(target);
                pendingRequester_.reset();
            }
    }

    std::vector<arrange::core::FocusObservation> FocusOwner::takeChanges() {
        return std::exchange(changes_, {});
    }

    std::vector<arrange::core::FocusDirection> FocusOwner::takeMoves() {
        return std::exchange(moves_, {});
    }
}
