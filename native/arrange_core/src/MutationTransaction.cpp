#include <arrange/core/MutationTransaction.h>

#include <cstdint>
#include <utility>

namespace arrange::core {
    bool MutationTransaction::hasTreeMutations() const noexcept {
        return !treeMutations.ops.empty();
    }

    bool MutationTransaction::hasEventSlotChanges() const noexcept {
        return !eventSlotUpdates.empty() || !retiredEventSlots.empty();
    }

    bool MutationTransaction::empty() const noexcept {
        return treeMutations.ops.empty() && eventSlotUpdates.empty() && retiredEventSlots.empty();
    }

    MutationTransaction MutationTransaction::fromBridgeBatch(BridgeBatch batch) {
        batch.header.opCount = static_cast<std::uint32_t>(batch.ops.size());
        MutationTransaction transaction;
        transaction.treeMutations = std::move(batch);
        return transaction;
    }

    void MutationTransaction::append(MutationTransaction transaction) {
        treeMutations.ops.insert(
            treeMutations.ops.end(),
            std::make_move_iterator(transaction.treeMutations.ops.begin()),
            std::make_move_iterator(transaction.treeMutations.ops.end()));
        treeMutations.header.magic = BridgeMagic;
        treeMutations.header.version = BridgeVersion;
        treeMutations.header.opCount = static_cast<std::uint32_t>(treeMutations.ops.size());

        eventSlotUpdates.insert(
            eventSlotUpdates.end(),
            std::make_move_iterator(transaction.eventSlotUpdates.begin()),
            std::make_move_iterator(transaction.eventSlotUpdates.end()));
        retiredEventSlots.insert(
            retiredEventSlots.end(),
            std::make_move_iterator(transaction.retiredEventSlots.begin()),
            std::make_move_iterator(transaction.retiredEventSlots.end()));
    }

    void MutationTransactionQueue::push(BridgeBatch batch) {
        push(MutationTransaction::fromBridgeBatch(std::move(batch)));
    }

    void MutationTransactionQueue::push(MutationTransaction transaction) {
        if (transaction.empty()) return;
        if (pending_) {
            pending_->append(std::move(transaction));
            return;
        }

        if (transaction.treeMutations.header.magic == 0) transaction.treeMutations.header.magic = BridgeMagic;
        if (transaction.treeMutations.header.version == 0) transaction.treeMutations.header.version = BridgeVersion;
        transaction.treeMutations.header.opCount = static_cast<std::uint32_t>(transaction.treeMutations.ops.size());
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
