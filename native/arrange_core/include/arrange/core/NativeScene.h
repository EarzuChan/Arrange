#pragma once

#include "MutationTransaction.h"
#include "LayoutTree.h"

#include <unordered_set>

namespace arrange::core {
    class NativeScene {
    public:
        void reset();
        void apply(const MutationTransaction& transaction);
        void applyEventSlotChanges(const MutationTransaction& transaction);

        [[nodiscard]] bool contains(NodeId id) const noexcept { return tree_.contains(id); }
        [[nodiscard]] const ArrangeNode& node(NodeId id) const { return tree_.node(id); }
        [[nodiscard]] ArrangeNode& node(NodeId id) { return tree_.node(id); }
        [[nodiscard]] DirtySnapshot dirtySnapshot(std::uint32_t mask = 0xffffffffu) const noexcept {
            return tree_.dirtySnapshot(mask);
        }
        [[nodiscard]] const InvalidationSnapshot& invalidationSnapshot() const noexcept {
            return tree_.invalidationSnapshot();
        }
        [[nodiscard]] InvalidationSnapshot takeInvalidation() noexcept {
            return tree_.takeInvalidation();
        }

        void clearDirty() noexcept { tree_.clearDirty(); }

        [[nodiscard]] LayoutTree& tree() noexcept { return tree_; }
        [[nodiscard]] const LayoutTree& tree() const noexcept { return tree_; }
        [[nodiscard]] bool hasEventSlot(const EventSlotId& slot) const;
        [[nodiscard]] std::size_t eventSlotCount() const noexcept { return activeEventSlots_.size(); }

    private:
        LayoutTree tree_;
        std::unordered_set<EventSlotId, EventSlotIdHash> activeEventSlots_;
    };
} // namespace arrange::core
