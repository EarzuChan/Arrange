#include "QuickJsEventRegistry.h"

#if ARRANGE_WITH_QUICKJS_NG

namespace arrange::quickjs {
    void QuickJsEventRegistry::reset(JSContext* context) {
        if (context_ != nullptr) {
            for (auto& [_, callback] : eventSlots_) JS_FreeValue(context_, callback);
        }
        eventSlots_.clear();
        retiredEventSlots_.clear();
        context_ = context;
    }

    JSValueConst QuickJsEventRegistry::callback(const arrange::core::EventSlotId& slot) const noexcept {
        const auto it = eventSlots_.find(slot);
        return it == eventSlots_.end() ? JS_UNDEFINED : it->second;
    }

    void QuickJsEventRegistry::replace(
        const arrange::core::EventSlotId& slot,
        JSValueConst callback,
        arrange::core::MutationTransaction* transaction) {
        if (context_ == nullptr || !slot.valid()) return;
        if (const auto old = eventSlots_.find(slot); old != eventSlots_.end()) {
            JS_FreeValue(context_, old->second);
            eventSlots_.erase(old);
        }
        if (!JS_IsFunction(context_, callback)) {
            release(slot, transaction);
            return;
        }
        retiredEventSlots_.erase(slot);
        eventSlots_.emplace(slot, JS_DupValue(context_, callback));
        if (transaction != nullptr) {
            transaction->eventSlotUpdates.push_back(slot);
            transaction->treeMutations.push_back(arrange::core::SetEventSlotMutation{slot.node, slot.kind, slot});
        }
    }

    void QuickJsEventRegistry::release(
        const arrange::core::EventSlotId& slot,
        arrange::core::MutationTransaction* transaction) {
        releaseWithoutTreeWalk(slot, transaction);
    }

    void QuickJsEventRegistry::releaseWithoutTreeWalk(
        const arrange::core::EventSlotId& slot,
        arrange::core::MutationTransaction* transaction) {
        if (context_ == nullptr || !slot.valid()) return;
        if (transaction != nullptr) {
            transaction->retiredEventSlots.push_back(slot);
            transaction->treeMutations.push_back(arrange::core::ClearEventSlotMutation{slot.node, slot.kind});
        }
        retiredEventSlots_.insert(slot);
    }

    void QuickJsEventRegistry::releaseNodeCallbacksRecursive(
        arrange::core::NodeId id,
        arrange::core::MutationTransaction* transaction,
        const std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>>& childrenByNode) {
        if (const auto it = childrenByNode.find(id); it != childrenByNode.end()) {
            const auto children = it->second;
            for (const auto child : children) releaseNodeCallbacksRecursive(child, transaction, childrenByNode);
        }
        for (const auto& slot : builtinSlotsForNode(id)) releaseWithoutTreeWalk(slot, transaction);
    }

    void QuickJsEventRegistry::releaseAll(arrange::core::MutationTransaction* transaction) {
        if (transaction != nullptr) {
            for (const auto& [slot, _] : eventSlots_) {
                if (!slot.valid()) continue;
                transaction->retiredEventSlots.push_back(slot);
                transaction->treeMutations.push_back(arrange::core::ClearEventSlotMutation{slot.node, slot.kind});
            }
        }
        for (const auto& [slot, _] : eventSlots_) retiredEventSlots_.insert(slot);
    }

    void QuickJsEventRegistry::flushRetired() {
        if (context_ == nullptr) {
            retiredEventSlots_.clear();
            return;
        }
        for (const auto& slot : retiredEventSlots_) {
            const auto it = eventSlots_.find(slot);
            if (it == eventSlots_.end()) continue;
            JS_FreeValue(context_, it->second);
            eventSlots_.erase(it);
        }
        retiredEventSlots_.clear();
    }

    std::vector<arrange::core::EventSlotId> QuickJsEventRegistry::builtinSlotsForNode(arrange::core::NodeId id) {
        return {
            arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click),
            arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::VerticalScroll),
            arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::HorizontalScroll),
            arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputUpdate),
            arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputSubmit),
            arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputChange),
            arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputBlur),
        };
    }
}

#endif
