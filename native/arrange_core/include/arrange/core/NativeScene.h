#pragma once

#include "MutationTransaction.h"
#include "LayoutTree.h"

#include <optional>
#include <unordered_set>
#include <unordered_map>

namespace arrange::core {
    class NativeScene {
       public:
        void reset();
        void apply(const MutationTransaction& transaction);

        [[nodiscard]] bool contains(NodeId id) const noexcept {
            return tree_.contains(id);
        }

        [[nodiscard]] const LayoutNode& node(NodeId id) const {
            return tree_.node(id);
        }

        [[nodiscard]] DirtySnapshot dirtySnapshot(std::uint32_t mask = 0xffffffffu) const noexcept {
            return tree_.dirtySnapshot(mask);
        }

        [[nodiscard]] const InvalidationSnapshot& invalidationSnapshot() const noexcept {
            return tree_.invalidationSnapshot();
        }

        [[nodiscard]] InvalidationSnapshot takeInvalidation() noexcept {
            return tree_.takeInvalidation();
        }

        void clearDirty() {
            tree_.clearDirty();
        }

        [[nodiscard]] LayoutTree& tree() noexcept {
            return tree_;
        }

        [[nodiscard]] const LayoutTree& tree() const noexcept {
            return tree_;
        }

        [[nodiscard]] bool hasEventSlot(const EventSlotId& slot) const;

        [[nodiscard]] std::size_t eventSlotCount() const noexcept {
            return activeEventSlots_.size();
        }

        const EventSlotSet& activeEventSlots() const noexcept {
            return activeEventSlots_;
        }

        std::size_t bindingCount() const noexcept {
            return bindings_.size();
        }

        const SlotRuntimeCounters& slotCounters() const noexcept {
            return slotCounters_;
        }

       private:
        friend class SceneFramePipeline;

        struct Journal {
            // 空值表示该绑定在日志开启前不存在；事件槽记录原先是否存在
            std::unordered_map<std::uint64_t, std::optional<RegisterBinding>> bindings;
            std::unordered_map<EventSlotId, bool, EventSlotIdHash> eventSlots;
            SlotRuntimeCounters slotCounters;
        };

        void beginJournal();
        void commitJournal() noexcept;
        void rollbackJournal();
        void journalBinding(std::uint64_t identity);
        void journalEventSlot(const EventSlotId& slot);
        template <class Predicate>
        void retireEventSlotsIf(Predicate predicate);
        void applyUncommitted(const MutationTransaction& transaction);
        void validateLayoutMaterialization(NodeId layout, const MutationTransaction& transaction) const;
        bool targetIsLive(const BindingTarget& target) const;
        void retireInvalidBindings();
        std::uint32_t applySlot(const BindingTarget& target, const SlotValue& value);
        std::unordered_map<std::uint64_t, RegisterBinding> bindings_;
        SlotRuntimeCounters slotCounters_;
        LayoutTree tree_;
        std::unordered_set<EventSlotId, EventSlotIdHash> activeEventSlots_;
        std::optional<Journal> journal_;
    };
}
