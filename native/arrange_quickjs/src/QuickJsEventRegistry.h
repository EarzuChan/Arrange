#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <arrange/core/EventSlot.h>
#include <arrange/core/MutationTransaction.h>

#include <cstddef>
#include <unordered_map>
#include <unordered_set>
#include <vector>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    class QuickJsEventRegistry {
    public:
        void reset(JSContext* context);
        void clearContext() noexcept { context_ = nullptr; }

        [[nodiscard]] std::size_t size() const noexcept { return eventSlots_.size(); }
        [[nodiscard]] JSValueConst callback(const arrange::core::EventSlotId& slot) const noexcept;

        void replace(
            const arrange::core::EventSlotId& slot,
            JSValueConst callback,
            arrange::core::MutationTransaction* transaction);
        void release(
            const arrange::core::EventSlotId& slot,
            arrange::core::MutationTransaction* transaction);
        void releaseNodeCallbacksRecursive(
            arrange::core::NodeId id,
            arrange::core::MutationTransaction* transaction,
            const std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>>& childrenByNode);
        void releaseAll(arrange::core::MutationTransaction* transaction);
        void flushRetired();

    private:
        static std::vector<arrange::core::EventSlotId> builtinSlotsForNode(arrange::core::NodeId id);
        void releaseWithoutTreeWalk(const arrange::core::EventSlotId& slot, arrange::core::MutationTransaction* transaction);

        JSContext* context_ = nullptr;
        std::unordered_map<arrange::core::EventSlotId, JSValue, arrange::core::EventSlotIdHash> eventSlots_;
        std::unordered_set<arrange::core::EventSlotId, arrange::core::EventSlotIdHash> retiredEventSlots_;
    };
}

#endif
