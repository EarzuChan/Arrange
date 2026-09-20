#include <arrange/core/MutationTransaction.h>

#include <utility>
#include <algorithm>
#include <stdexcept>

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
        if (transaction.rearrange && transaction.rearrange->cancelled) return;
        if (rearrange && rearrange->cancelled) {
            operations.clear();
            rearrange.reset();
        }
        if (rearrange && transaction.rearrange && rearrange != transaction.rearrange) throw std::logic_error("不同重排提交不能共用一次应用回执");
        if (transaction.rearrange) rearrange = std::move(transaction.rearrange);
        operations.insert(operations.end(),
            std::make_move_iterator(transaction.operations.begin()),
            std::make_move_iterator(transaction.operations.end()));
    }

    void MutationTransactionQueue::push(MutationTransaction transaction) {
        // 空事务仍代表一次明确提交，不能丢失逻辑生命的应用回执
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
