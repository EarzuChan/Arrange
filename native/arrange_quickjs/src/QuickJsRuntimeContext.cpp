#include "QuickJsRuntimeContext.h"

#if ARRANGE_WITH_QUICKJS_NG

namespace arrange::quickjs {
    arrange::core::MutationTransaction* QuickJsRuntimeContext::currentTransaction() noexcept {
        return pendingTransactions == nullptr ? nullptr : &pendingTransactions->ensurePending();
    }

    void QuickJsRuntimeContext::push(arrange::core::TreeMutation mutation) {
        if (auto* transaction = currentTransaction()) transaction->operations.emplace_back(std::move(mutation));
    }

    arrange::core::BindingHandle QuickJsRuntimeContext::registerBinding(arrange::core::BindingTarget target) {
        const arrange::core::BindingHandle handle{arrange::core::allocateRuntimeIdentity(), 1};
        bindings.emplace(handle.identity, arrange::core::RegisterBinding{handle, target});
        if (auto* transaction = currentTransaction()) transaction->operations.emplace_back(arrange::core::RegisterBinding{handle, std::move(target)});
        return handle;
    }

    void QuickJsRuntimeContext::updateBinding(arrange::core::BindingHandle handle, arrange::core::SlotValue value) {
        if (auto* transaction = currentTransaction()) transaction->operations.emplace_back(arrange::core::SlotUpdate{handle, std::move(value)});
    }

    void QuickJsRuntimeContext::retireBinding(arrange::core::BindingHandle handle) {
        const auto found = bindings.find(handle.identity);
        if (found == bindings.end() || found->second.handle != handle) return;
        std::visit([&](const auto& target) {
            using T = std::decay_t<decltype(target)>;
            if constexpr (std::is_same_v<T, arrange::core::HostInputTarget>) {
                if (auto node = hostBindings.find(target.node.id); node != hostBindings.end()) {
                    auto input = node->second.find(target.input);
                    if (input != node->second.end() && input->second == handle) node->second.erase(input);
                }
            }
            else if constexpr (std::is_same_v<T, arrange::core::EventInputTarget>) {
                if (auto node = eventBindings.find(target.node.id); node != eventBindings.end()) {
                    auto input = node->second.find(target.kind);
                    if (input != node->second.end() && input->second == handle) node->second.erase(input);
                }
            }
            else if constexpr (std::is_same_v<T, arrange::core::ModifierChainTarget>) {
                if (auto input = modifierBindings.find(target.node.id); input != modifierBindings.end() && input->second == handle) modifierBindings.erase(input);
            }
        }, found->second.target);
        bindings.erase(found);
        if (auto* transaction = currentTransaction()) transaction->operations.emplace_back(arrange::core::RetireBinding{handle});
    }

    void QuickJsRuntimeContext::setHostInput(arrange::core::NodeId id, arrange::core::HostInput input, arrange::core::PropValue value) {
        auto& handle = hostBindings[id][input];
        if (!handle.valid()) handle = registerBinding(arrange::core::HostInputTarget{{id, nodeGenerations.at(id)}, input});
        updateBinding(handle, std::move(value));
    }

    void QuickJsRuntimeContext::setEventInput(arrange::core::NodeId id, arrange::core::EventSlotKind kind, arrange::core::EventSlotId slot) {
        auto& handle = eventBindings[id][kind];
        if (!handle.valid()) handle = registerBinding(arrange::core::EventInputTarget{{id, nodeGenerations.at(id)}, kind});
        updateBinding(handle, std::move(slot));
    }

    void QuickJsRuntimeContext::setModifierChain(arrange::core::NodeId id, arrange::core::ModifierDescriptors value) {
        auto& handle = modifierBindings[id];
        if (!handle.valid()) handle = registerBinding(arrange::core::ModifierChainTarget{{id, nodeGenerations.at(id)}});
        updateBinding(handle, std::move(value));
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

    void QuickJsRuntimeContext::releaseNodeTypesRecursive(arrange::core::NodeId id) {
        const auto children = childrenByNode.find(id) == childrenByNode.end()
                                  ? std::vector<arrange::core::NodeId>{}
                                  : childrenByNode.at(id);
        for (auto child : children) releaseNodeTypesRecursive(child);
        std::vector<arrange::core::BindingHandle> retired;
        for (const auto& [_, binding] : bindings) {
            if (std::visit([&](const auto& target) { return target.node.id == id; }, binding.target)) retired.push_back(binding.handle);
        }
        for (const auto handle : retired) retireBinding(handle);
        hostBindings.erase(id);
        modifierBindings.erase(id);
        eventBindings.erase(id);
        nodeGenerations.erase(id);
        nodeTypes.erase(id);
    }

    void QuickJsRuntimeContext::recordDiagnostic(QuickJsDiagnosticEventInput event) {
        diagnosticEvents.push_back(std::move(event));
        while (diagnosticEvents.size() > 64) diagnosticEvents.erase(diagnosticEvents.begin());
    }

    void QuickJsRuntimeContext::recordDiagnosticAction(QuickJsDiagnosticAction action) {
        diagnosticActions.push_back(std::move(action));
        while (diagnosticActions.size() > 64) diagnosticActions.erase(diagnosticActions.begin());
    }
}

#endif
