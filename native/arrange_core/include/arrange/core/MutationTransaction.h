#pragma once

#include "EventSlot.h"
#include "Mutation.h"
#include "SlotUpdate.h"

#include <optional>
#include <vector>

namespace arrange::core {
    struct RegisterEventSlot { EventSlotId slot; };
    struct RetireEventSlot { EventSlotId slot; };
    using SubmissionOperation = std::variant<
        TreeMutation, RegisterBinding, RetireBinding, SlotUpdate,
        RegisterEventSlot, RetireEventSlot>;

    struct MutationTransaction {
        // 结构、绑定和值共享因果顺序；合批只能串接，不能按操作类别重排。
        std::vector<SubmissionOperation> operations;

        [[nodiscard]] bool hasTreeMutations() const noexcept;
        [[nodiscard]] bool hasEventSlotChanges() const noexcept;
        [[nodiscard]] bool empty() const noexcept { return operations.empty(); }
        void append(MutationTransaction transaction);
    };

    class MutationTransactionQueue {
    public:
        [[nodiscard]] bool empty() const noexcept { return !pending_.has_value(); }
        [[nodiscard]] bool hasPending() const noexcept { return pending_.has_value(); }
        [[nodiscard]] const std::optional<MutationTransaction>& pending() const noexcept { return pending_; }

        void push(MutationTransaction transaction);
        MutationTransaction& ensurePending();
        std::optional<MutationTransaction> take() noexcept;
        void clear() noexcept;

    private:
        std::optional<MutationTransaction> pending_;
    };
} // namespace arrange::core
