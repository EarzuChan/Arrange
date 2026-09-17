#include "QuickJsEventRegistry.h"

#if ARRANGE_WITH_QUICKJS_NG

#include <algorithm>

namespace arrange::quickjs {
    void QuickJsEventRegistry::reset(JSContext* context) {
        if (context_ != nullptr) {
            for (auto& [_, callback] : eventSlots_) JS_FreeValue(context_, callback);
        }
        eventSlots_.clear();
        retiredEventSlots_.clear();
        publishedEventSlots_.clear();
        nodeEventSlots_.clear();
        context_ = context;
    }

    JSValueConst QuickJsEventRegistry::callback(const arrange::core::EventSlotId& slot) const noexcept {
        if (!publishedEventSlots_.contains(slot)) return JS_UNDEFINED;
        const auto it = eventSlots_.find(slot);
        return it == eventSlots_.end() ? JS_UNDEFINED : it->second;
    }

    arrange::core::EventSlotId QuickJsEventRegistry::retain(
        arrange::core::NodeId node,
        arrange::core::EventSlotKind kind,
        arrange::core::EventSlotOwner owner,
        JSValueConst callbackValue,
        arrange::core::MutationTransaction* transaction) {
        // 资源不可变。新闭包获得新 token，旧画面不会提前调用替换后的闭包
        const arrange::core::EventSlotId slot{node, kind, {}, owner, arrange::core::allocateRuntimeIdentity(), 1};
        eventSlots_.emplace(slot, JS_DupValue(context_, callbackValue));
        if (transaction) transaction->operations.emplace_back(arrange::core::RegisterEventSlot{slot});
        return slot;
    }

    arrange::core::EventSlotId QuickJsEventRegistry::setNodeCallback(
        arrange::core::NodeId node,
        arrange::core::EventSlotKind kind,
        JSValueConst callbackValue,
        arrange::core::MutationTransaction* transaction) {
        const auto key = arrange::core::makeEventSlotId(node, kind);
        if (const auto previous = nodeEventSlots_.find(key); previous != nodeEventSlots_.end()) {
            const auto callback = eventSlots_.find(previous->second);
            if (callback != eventSlots_.end() && JS_IsFunction(context_, callbackValue) &&
                !retiredEventSlots_.contains(previous->second) && JS_IsStrictEqual(context_, callback->second, callbackValue)) return previous->second;
            release(previous->second, transaction);
            nodeEventSlots_.erase(previous);
        }
        if (!JS_IsFunction(context_, callbackValue)) return {};
        const auto slot = retain(node, kind, arrange::core::EventSlotOwner::Node, callbackValue, transaction);
        nodeEventSlots_.emplace(key, slot);
        return slot;
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
            transaction->operations.emplace_back(arrange::core::RetireEventSlot{slot});
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
        for (const auto& [slot, _] : eventSlots_) if (slot.node == id) releaseWithoutTreeWalk(slot, transaction);
    }

    void QuickJsEventRegistry::releaseAll(arrange::core::MutationTransaction* transaction) {
        if (transaction != nullptr) {
            for (const auto& [slot, _] : eventSlots_) {
                if (!slot.valid()) continue;
                transaction->operations.emplace_back(arrange::core::RetireEventSlot{slot});
            }
        }
        for (const auto& [slot, _] : eventSlots_) retiredEventSlots_.insert(slot);
    }

    void QuickJsEventRegistry::publish(const arrange::core::EventSlotSet& active) {
        // 只有成功发布的场景决定可调用资源及释放边界
        publishedEventSlots_ = active;
        for (auto it = eventSlots_.begin(); it != eventSlots_.end();) {
            if (active.contains(it->first)) { ++it; continue; }
            JS_FreeValue(context_, it->second);
            it = eventSlots_.erase(it);
        }
        std::erase_if(nodeEventSlots_, [&](const auto& entry) { return !active.contains(entry.second); });
        retiredEventSlots_.clear();
    }

    arrange::core::EventSlotId QuickJsEventRegistry::retainModifierCallback(
        arrange::core::NodeId node,
        arrange::core::EventSlotKind kind,
        JSValueConst callbackValue,
        const std::vector<arrange::core::EventSlotId>& retained,
        arrange::core::MutationTransaction* transaction) {
        if (!JS_IsFunction(context_, callbackValue)) return {};
        for (const auto& [slot, callback] : eventSlots_) {
            if (slot.node == node && slot.kind == kind && slot.owner == arrange::core::EventSlotOwner::Modifier && !retiredEventSlots_.contains(slot) && std::find(retained.begin(), retained.end(), slot) == retained.end() && JS_IsStrictEqual(context_, callback, callbackValue)) return slot;
        }
        return retain(node, kind, arrange::core::EventSlotOwner::Modifier, callbackValue, transaction);
    }

    arrange::core::EventSlotId QuickJsEventRegistry::updateModifierCallback(
        arrange::core::NodeId node, arrange::core::EventSlotKind kind, JSValueConst callbackValue,
        const arrange::core::EventSlotId& previous, arrange::core::MutationTransaction* transaction) {
        if (const auto found = eventSlots_.find(previous); found != eventSlots_.end() &&
            !retiredEventSlots_.contains(previous) && JS_IsStrictEqual(context_, found->second, callbackValue)) return previous;
        const auto next = JS_IsFunction(context_, callbackValue)
            ? retain(node, kind, arrange::core::EventSlotOwner::Modifier, callbackValue, transaction)
            : arrange::core::EventSlotId{};
        if (previous.valid()) release(previous, transaction);
        return next;
    }

    void QuickJsEventRegistry::releaseModifierCallbacksExcept(
        arrange::core::NodeId node,
        const std::vector<arrange::core::EventSlotId>& retained,
        arrange::core::MutationTransaction* transaction) {
        for (const auto& [slot, _] : eventSlots_) {
            if (slot.node == node && slot.owner == arrange::core::EventSlotOwner::Modifier && !retiredEventSlots_.contains(slot) && std::find(retained.begin(), retained.end(), slot) == retained.end()) release(slot, transaction);
        }
    }
}

#endif
