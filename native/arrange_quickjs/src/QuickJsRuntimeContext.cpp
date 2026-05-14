#include "QuickJsRuntimeContext.h"

#if ARRANGE_WITH_QUICKJS_NG

namespace arrange::quickjs {
    arrange::core::MutationTransaction* QuickJsRuntimeContext::currentTransaction() noexcept {
        return pendingTransactions == nullptr ? nullptr : &pendingTransactions->ensurePending();
    }

    void QuickJsRuntimeContext::push(arrange::core::TreeMutation mutation) {
        if (auto* transaction = currentTransaction()) transaction->treeMutations.push_back(std::move(mutation));
    }

    void QuickJsRuntimeContext::attachChild(arrange::core::NodeId parent, arrange::core::NodeId child, std::uint32_t index) {
        if (parent == 0 || child == 0) return;
        if (const auto oldParent = parentByNode.find(child); oldParent != parentByNode.end()) detachChild(oldParent->second, child);
        auto& children = childrenByNode[parent];
        children.erase(std::remove(children.begin(), children.end(), child), children.end());
        const auto insertIndex = std::min<std::size_t>(index, children.size());
        children.insert(children.begin() + static_cast<std::ptrdiff_t>(insertIndex), child);
        parentByNode[child] = parent;
    }

    void QuickJsRuntimeContext::detachChild(arrange::core::NodeId parent, arrange::core::NodeId child) {
        if (const auto childrenIt = childrenByNode.find(parent); childrenIt != childrenByNode.end()) {
            auto& children = childrenIt->second;
            children.erase(std::remove(children.begin(), children.end(), child), children.end());
            if (children.empty()) childrenByNode.erase(childrenIt);
        }
        if (const auto parentIt = parentByNode.find(child); parentIt != parentByNode.end() && parentIt->second == parent) parentByNode.erase(parentIt);
    }

    void QuickJsRuntimeContext::releaseNodeCallbacksRecursive(arrange::core::NodeId id) {
        events.releaseNodeCallbacksRecursive(id, currentTransaction(), childrenByNode);
        if (const auto it = parentByNode.find(id); it != parentByNode.end()) detachChild(it->second, id);
        childrenByNode.erase(id);
        parentByNode.erase(id);
    }
}

#endif
