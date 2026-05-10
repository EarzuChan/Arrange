#include <arrange/core/NativeScene.h>

namespace arrange::core {
    void NativeScene::reset() {
        tree_ = {};
        activeEventSlots_.clear();
    }

    void NativeScene::apply(const MutationTransaction& transaction) {
        if (transaction.hasTreeMutations()) {
            tree_.apply(transaction.treeMutations);
        }
        applyEventSlotChanges(transaction);
    }

    void NativeScene::applyEventSlotChanges(const MutationTransaction& transaction) {
        for (const auto& slot : transaction.retiredEventSlots) {
            if (slot.valid()) activeEventSlots_.erase(slot.toString());
        }
        for (const auto& slot : transaction.eventSlotUpdates) {
            if (slot.valid()) activeEventSlots_.insert(slot.toString());
        }
    }

    bool NativeScene::hasEventSlot(const EventSlotId& slot) const {
        return slot.valid() && activeEventSlots_.contains(slot.toString());
    }
} // namespace arrange::core
