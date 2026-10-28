#include <arrange/core/FocusOwner.h>
#include <arrange/core/ModifierGeometry.h>
#include <algorithm>
#include <utility>

namespace arrange::core {
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

    bool FocusOwner::set(std::optional<FocusTarget> target) {
        const auto same = focused_ && target && *focused_ == *target;
        if (!focused_ && !target) return false;
        if (focused_)
            for (const auto& previous : focused_->observers) {
                const auto next = target ? std::find_if(target->observers.begin(), target->observers.end(), [&](const auto& value) { return value.slot == previous.slot; }) : std::vector<FocusObservation>::const_iterator{};
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
        focusedNode_ = focused_ ? std::optional<NodeId>{focused_->node.id} : std::nullopt;
        if (!same) scrollRequested_ = focused_.has_value();
        return !same;
    }

    void FocusOwner::synchronize(const LayoutTree& tree, bool interactive, const std::vector<FocusCommand>& commands) {
        snapshot_ = interactive ? buildFocusSnapshot(tree) : FocusSnapshot{};
        if (focused_) {
            const auto found = std::find(snapshot_.begin(), snapshot_.end(), *focused_);
            (void)set(found == snapshot_.end() ? std::optional<FocusTarget>{} : std::optional<FocusTarget>{*found});
        }
        for (const auto& command : commands) {
            switch (command.kind) {
                case FocusCommandKind::Request:
                    moves_.clear();
                    pendingRequester_ = command.requester;
                    if (const auto target = findFocusRequester(snapshot_, command.requester)) {
                        (void)set(target);
                        pendingRequester_.reset();
                    }
                    break;
                case FocusCommandKind::Cancel:
                    if (pendingRequester_ == command.requester) pendingRequester_.reset();
                    break;
                case FocusCommandKind::Clear:
                    pendingRequester_.reset();
                    moves_.clear();
                    (void)set({});
                    break;
                case FocusCommandKind::Move: {
                    pendingRequester_.reset();
                    bool lazy = false;
                    if (focused_)
                        for (const auto id : nodePath(tree, focused_->node.id))
                            if (std::holds_alternative<LazyMeasurePolicy>(tree.node(id).measurePolicy)) lazy = true;
                    if (lazy)
                        moves_.push_back(command.direction);
                    else if (const auto target = searchFocus(snapshot_, focused_, command.direction))
                        (void)set(target);
                    break;
                }
            }
        }
        if (pendingRequester_)
            if (const auto target = findFocusRequester(snapshot_, *pendingRequester_)) {
                (void)set(target);
                pendingRequester_.reset();
            }
    }

    std::vector<FocusObservation> FocusOwner::takeChanges() {
        return std::exchange(changes_, {});
    }

    std::vector<FocusDirection> FocusOwner::takeMoves() {
        return std::exchange(moves_, {});
    }
}
