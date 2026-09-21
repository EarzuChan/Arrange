#include "QuickJsEventRegistry.h"

#if ARRANGE_WITH_QUICKJS_NG

#include <algorithm>
#include <stdexcept>

namespace arrange::quickjs {
    void QuickJsEventRegistry::reset(JSContext* context) {
        commitCandidate();
        if (context_ != nullptr) {
            for (auto& [_, callback] : eventSlots_) JS_FreeValue(context_, callback);
        }
        eventSlots_.clear();
        retiredEventSlots_.clear();
        publishedEventSlots_.clear();
        context_ = context;
    }

    void QuickJsEventRegistry::beginCandidate() {
        if (checkpoint_) throw std::logic_error("事件注册已有未完成候选");
        checkpoint_ = CandidateCheckpoint{eventSlots_, retiredEventSlots_, publishedEventSlots_};
        for (auto& [_, callback] : checkpoint_->callbacks) callback = JS_DupValue(context_, callback);
    }

    void QuickJsEventRegistry::commitCandidate() {
        if (!checkpoint_) return;
        for (auto& [_, callback] : checkpoint_->callbacks) JS_FreeValue(context_, callback);
        checkpoint_.reset();
    }

    void QuickJsEventRegistry::abortCandidate() {
        if (!checkpoint_) return;
        for (auto& [_, callback] : eventSlots_) JS_FreeValue(context_, callback);
        eventSlots_ = std::move(checkpoint_->callbacks);
        retiredEventSlots_ = std::move(checkpoint_->retired);
        publishedEventSlots_ = std::move(checkpoint_->published);
        checkpoint_.reset();
    }

    JSValueConst QuickJsEventRegistry::callback(const arrange::core::EventSlotId& slot) const noexcept {
        if (!publishedEventSlots_.contains(slot)) return JS_UNDEFINED;
        const auto it = eventSlots_.find(slot);
        return it == eventSlots_.end() ? JS_UNDEFINED : it->second;
    }

    arrange::core::EventSlotId QuickJsEventRegistry::retain(arrange::core::NodeId node, arrange::core::EventSlotKind kind, JSValueConst callbackValue, arrange::core::MutationTransaction* transaction) {
        // 资源不可变。新闭包获得新 token，旧画面不会提前调用替换后的闭包
        const arrange::core::EventSlotId slot{node, kind, {}, arrange::core::allocateRuntimeIdentity(), 1};
        eventSlots_.emplace(slot, JS_DupValue(context_, callbackValue));
        if (transaction) transaction->operations.emplace_back(arrange::core::RegisterEventSlot{slot});
        return slot;
    }

    void QuickJsEventRegistry::release(const arrange::core::EventSlotId& slot, arrange::core::MutationTransaction* transaction) {
        releaseWithoutTreeWalk(slot, transaction);
    }

    void QuickJsEventRegistry::releaseWithoutTreeWalk(const arrange::core::EventSlotId& slot, arrange::core::MutationTransaction* transaction) {
        if (context_ == nullptr || !slot.valid()) return;
        if (transaction != nullptr) {
            transaction->operations.emplace_back(arrange::core::RetireEventSlot{slot});
        }
        retiredEventSlots_.insert(slot);
    }

    void QuickJsEventRegistry::releaseNodes(const std::unordered_set<arrange::core::NodeId>& nodes, arrange::core::MutationTransaction* transaction) {
        for (const auto& [slot, _] : eventSlots_)
            if (nodes.contains(slot.node)) releaseWithoutTreeWalk(slot, transaction);
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
            if (active.contains(it->first)) {
                ++it;
                continue;
            }
            JS_FreeValue(context_, it->second);
            it = eventSlots_.erase(it);
        }
        retiredEventSlots_.clear();
    }

    arrange::core::EventSlotId QuickJsEventRegistry::updateModifierCallback(arrange::core::NodeId node, arrange::core::EventSlotKind kind, JSValueConst callbackValue, const arrange::core::EventSlotId& previous, arrange::core::MutationTransaction* transaction) {
        if (const auto found = eventSlots_.find(previous); found != eventSlots_.end() && !retiredEventSlots_.contains(previous) && JS_IsStrictEqual(context_, found->second, callbackValue)) return previous;
        const auto next = JS_IsFunction(context_, callbackValue) ? retain(node, kind, callbackValue, transaction) : arrange::core::EventSlotId{};
        if (previous.valid()) release(previous, transaction);
        return next;
    }

    void QuickJsEventRegistry::releaseModifierCallbacksExcept(arrange::core::NodeId node, const std::vector<arrange::core::EventSlotId>& retained, arrange::core::MutationTransaction* transaction) {
        for (const auto& [slot, _] : eventSlots_) {
            if (slot.node == node && !retiredEventSlots_.contains(slot) && std::find(retained.begin(), retained.end(), slot) == retained.end()) release(slot, transaction);
        }
    }
}  // namespace arrange::quickjs

#endif
