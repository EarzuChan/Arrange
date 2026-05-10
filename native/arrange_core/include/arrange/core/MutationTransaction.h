#pragma once

#include "Bridge.h"
#include "EventSlot.h"

#include <optional>
#include <vector>

namespace arrange::core {
    struct MutationTransaction {
        BridgeBatch treeMutations;
        std::vector<EventSlotId> eventSlotUpdates;
        std::vector<EventSlotId> retiredEventSlots;

        [[nodiscard]] bool hasTreeMutations() const noexcept;
        [[nodiscard]] bool hasEventSlotChanges() const noexcept;
        [[nodiscard]] bool empty() const noexcept;

        static MutationTransaction fromBridgeBatch(BridgeBatch batch);
        void append(MutationTransaction transaction);
    };

    class MutationTransactionQueue {
    public:
        [[nodiscard]] bool empty() const noexcept { return !pending_.has_value(); }
        [[nodiscard]] bool hasPending() const noexcept { return pending_.has_value(); }
        [[nodiscard]] const std::optional<MutationTransaction>& pending() const noexcept { return pending_; }

        void push(BridgeBatch batch);
        void push(MutationTransaction transaction);
        MutationTransaction& ensurePending();
        std::optional<MutationTransaction> take() noexcept;
        void clear() noexcept;

    private:
        std::optional<MutationTransaction> pending_;
    };
} // namespace arrange::core
