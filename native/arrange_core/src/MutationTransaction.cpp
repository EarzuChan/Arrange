#include <arrange/core/MutationTransaction.h>

#include <utility>
#include <algorithm>

namespace arrange::core {
    bool MutationTransaction::hasTreeMutations() const noexcept {
        return std::any_of(operations.begin(), operations.end(), [](const auto& op) {
            return std::holds_alternative<TreeMutation>(op);
        });
    }

    bool MutationTransaction::hasEventSlotChanges() const noexcept {
        return std::any_of(operations.begin(), operations.end(), [](const auto& op) {
            return std::holds_alternative<RegisterEventSlot>(op) ||
                   std::holds_alternative<RetireEventSlot>(op);
        });
    }

    void MutationTransaction::append(MutationTransaction transaction) {
        operations.insert(operations.end(),
            std::make_move_iterator(transaction.operations.begin()),
            std::make_move_iterator(transaction.operations.end()));
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
