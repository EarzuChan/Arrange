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

        arrange::core::EventSlotId setNodeCallback(
            arrange::core::NodeId node,
            arrange::core::EventSlotKind kind,
            JSValueConst callback,
            arrange::core::MutationTransaction* transaction);
        void release(
            const arrange::core::EventSlotId& slot,
            arrange::core::MutationTransaction* transaction);
        void releaseNodeCallbacksRecursive(
            arrange::core::NodeId id,
            arrange::core::MutationTransaction* transaction,
            const std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>>& childrenByNode);
        arrange::core::EventSlotId retainModifierCallback(arrange::core::NodeId node, arrange::core::EventSlotKind kind, JSValueConst callback, const std::vector<arrange::core::EventSlotId>& retained, arrange::core::MutationTransaction* transaction);
        arrange::core::EventSlotId updateModifierCallback(arrange::core::NodeId node, arrange::core::EventSlotKind kind, JSValueConst callback, const arrange::core::EventSlotId& previous, arrange::core::MutationTransaction* transaction);
        void releaseModifierCallbacksExcept(arrange::core::NodeId node, const std::vector<arrange::core::EventSlotId>& retained, arrange::core::MutationTransaction* transaction);
        void releaseAll(arrange::core::MutationTransaction* transaction);
        void publish(const arrange::core::EventSlotSet& active);

    private:
        arrange::core::EventSlotId retain(arrange::core::NodeId node, arrange::core::EventSlotKind kind, arrange::core::EventSlotOwner owner, JSValueConst callback, arrange::core::MutationTransaction* transaction);
        void releaseWithoutTreeWalk(const arrange::core::EventSlotId& slot, arrange::core::MutationTransaction* transaction);

        JSContext* context_ = nullptr;
        std::unordered_map<arrange::core::EventSlotId, JSValue, arrange::core::EventSlotIdHash> eventSlots_;
        arrange::core::EventSlotSet retiredEventSlots_;
        arrange::core::EventSlotSet publishedEventSlots_;
        std::unordered_map<arrange::core::EventSlotId, arrange::core::EventSlotId, arrange::core::EventSlotIdHash> nodeEventSlots_;
    };
}

#endif
