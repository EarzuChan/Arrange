#include <arrange/core/MutationTransaction.h>

#include <utility>

namespace arrange::core {
    bool MutationTransaction::hasTreeMutations() const noexcept {
        return !treeMutations.empty();
    }

    bool MutationTransaction::hasEventSlotChanges() const noexcept {
        return !eventSlotUpdates.empty() || !retiredEventSlots.empty();
    }

    bool MutationTransaction::empty() const noexcept {
        return treeMutations.empty() && eventSlotUpdates.empty() && retiredEventSlots.empty();
    }

    void MutationTransaction::append(MutationTransaction transaction) {
        treeMutations.insert(
            treeMutations.end(),
            std::make_move_iterator(transaction.treeMutations.begin()),
            std::make_move_iterator(transaction.treeMutations.end()));
        eventSlotUpdates.insert(
            eventSlotUpdates.end(),
            std::make_move_iterator(transaction.eventSlotUpdates.begin()),
            std::make_move_iterator(transaction.eventSlotUpdates.end()));
        retiredEventSlots.insert(
            retiredEventSlots.end(),
            std::make_move_iterator(transaction.retiredEventSlots.begin()),
            std::make_move_iterator(transaction.retiredEventSlots.end()));
    }

    void MutationTransactionQueue::push(MutationTransaction transaction) {
        if (transaction.empty()) return;
        if (pending_) {
            pending_->append(std::move(transaction));
            return;
        }
        pending_ = std::move(transaction);
    }

    MutationTransaction& MutationTransactionQueue::ensurePending() {
        if (!pending_) pending_ = MutationTransaction{};
        return *pending_;
    }

    std::optional<MutationTransaction> MutationTransactionQueue::take() noexcept {
        auto mutations = std::move(pending_);
        pending_.reset();
        return mutations;
    }

    void MutationTransactionQueue::clear() noexcept {
        pending_.reset();
    }
} // namespace arrange::core
