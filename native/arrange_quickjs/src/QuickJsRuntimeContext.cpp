#include "QuickJsRuntimeContext.h"
#include <stdexcept>
#include <unordered_set>

#if ARRANGE_WITH_QUICKJS_NG

namespace arrange::quickjs {
    void QuickJsRuntimeContext::beginRearrange() {
        if (rearrangeCheckpoint) throw std::logic_error("重排候选不能重入");
        if (!pendingTransactions) throw std::logic_error("重排缺少原生提交队列");
        rearrangeCheckpoint = RearrangeCheckpoint{rootNodeId, pendingTransactions->pending(), bindings, publishedModifiers, modifierInputs, nodeTypes, nodeGenerations, hostBindings, modifierBindings, childrenByNode, parentByNode};
        rearrangeSubmission = std::make_shared<arrange::core::RearrangeSubmission>(arrange::core::RearrangeSubmission{arrange::core::allocateRuntimeIdentity(), false});
        events.beginCandidate();
    }

    void QuickJsRuntimeContext::abortRearrange() {
        if (!rearrangeCheckpoint) return;
        if (rearrangeSubmission) rearrangeSubmission->cancelled = true;
        rearrangeSubmission.reset();
        auto saved = std::move(*rearrangeCheckpoint);
        rearrangeCheckpoint.reset();
        rootNodeId = saved.root;
        pendingTransactions->clear();
        if (saved.pending) pendingTransactions->push(std::move(*saved.pending));
        bindings = std::move(saved.savedBindings);
        publishedModifiers = std::move(saved.savedPublishedModifiers);
        modifierInputs = std::move(saved.savedModifierInputs);
        nodeTypes = std::move(saved.savedNodeTypes);
        nodeGenerations = std::move(saved.savedNodeGenerations);
        hostBindings = std::move(saved.savedHostBindings);
        modifierBindings = std::move(saved.savedModifierBindings);
        childrenByNode = std::move(saved.savedChildrenByNode);
        parentByNode = std::move(saved.savedParentByNode);
        events.abortCandidate();
    }

    void QuickJsRuntimeContext::commitRearrange() {
        rearrangeSubmission.reset();
        rearrangeCheckpoint.reset();
        events.commitCandidate();
    }

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

    std::vector<const arrange::core::ModifierDescriptor*> QuickJsRuntimeContext::modifierInputDescriptors(arrange::core::NodeId id) const {
        std::vector<const arrange::core::ModifierDescriptor*> result;
        if (const auto found = modifierInputs.find(id); found != modifierInputs.end()) {
            result.reserve(found->second.size());
            for (const auto& input : found->second) result.push_back(&input.descriptor);
        }
        return result;
    }

    void QuickJsRuntimeContext::updateBinding(arrange::core::BindingHandle handle, arrange::core::SlotValue value) {
        const auto& target = bindings.at(handle.identity).target;
        if (const auto* chain = std::get_if<arrange::core::ModifierChainTarget>(&target)) {
            const auto& descriptors = std::get<arrange::core::ModifierDescriptors>(value);
            const auto previous = modifierInputDescriptors(chain->node.id);
            const auto matches = arrange::core::matchModifierDescriptors(previous, descriptors);
            auto& inputs = modifierInputs[chain->node.id];
            std::vector<PublishedModifier> next;
            next.reserve(descriptors.size());
            for (std::size_t index = 0; index < descriptors.size(); ++index) {
                const auto match = matches[index];
                const auto receiver = match < inputs.size() ? inputs[match].handle : arrange::core::ModifierHandle{};
                next.push_back({chain->node, receiver, descriptors[index], index});
            }
            inputs = std::move(next);
        } else if (const auto* instance = std::get_if<arrange::core::ModifierInputTarget>(&target)) {
            for (auto& input : modifierInputs.at(instance->node.id)) {
                if (input.handle == instance->modifier) {
                    input.descriptor.value = std::get<arrange::core::ModifierValue>(value);
                    break;
                }
            }
        }
        if (auto* transaction = currentTransaction()) transaction->operations.emplace_back(arrange::core::SlotUpdate{handle, std::move(value)});
    }

    void QuickJsRuntimeContext::retireBinding(arrange::core::BindingHandle handle) {
        const auto found = bindings.find(handle.identity);
        if (found == bindings.end() || found->second.handle != handle) return;
        std::visit(
            [&](const auto& target) {
                using T = std::decay_t<decltype(target)>;
                if constexpr (std::is_same_v<T, arrange::core::HostInputTarget>) {
                    if (auto node = hostBindings.find(target.node.id); node != hostBindings.end()) {
                        auto input = node->second.find(target.input);
                        if (input != node->second.end() && input->second == handle) node->second.erase(input);
                    }
                } else if constexpr (std::is_same_v<T, arrange::core::ModifierChainTarget>) {
                    if (auto input = modifierBindings.find(target.node.id); input != modifierBindings.end() && input->second == handle) modifierBindings.erase(input);
                }
            },
            found->second.target);
        bindings.erase(found);
        if (auto* transaction = currentTransaction()) transaction->operations.emplace_back(arrange::core::RetireBinding{handle});
    }

    void QuickJsRuntimeContext::setHostInput(arrange::core::NodeId id, arrange::core::HostInput input, arrange::core::PropValue value) {
        auto& handle = hostBindings[id][input];
        if (!handle.valid()) handle = registerBinding(arrange::core::HostInputTarget{{id, nodeGenerations.at(id)}, input});
        updateBinding(handle, std::move(value));
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

    void QuickJsRuntimeContext::retireSubtree(arrange::core::NodeId id) {
        std::vector<arrange::core::NodeId> pending{id};
        std::unordered_set<arrange::core::NodeId> retiredNodes;
        while (!pending.empty()) {
            const auto current = pending.back();
            pending.pop_back();
            if (!retiredNodes.insert(current).second) continue;
            if (const auto children = childrenByNode.find(current); children != childrenByNode.end()) pending.insert(pending.end(), children->second.begin(), children->second.end());
        }

        std::vector<arrange::core::BindingHandle> retiredBindings;
        for (const auto& [_, binding] : bindings) {
            if (std::visit([&](const auto& target) { return retiredNodes.contains(target.node.id); }, binding.target)) retiredBindings.push_back(binding.handle);
        }
        for (const auto handle : retiredBindings) retireBinding(handle);

        events.releaseNodes(retiredNodes, currentTransaction());
        if (const auto parent = parentByNode.find(id); parent != parentByNode.end()) detachChild(parent->second, id);

        for (const auto current : retiredNodes) {
            hostBindings.erase(current);
            modifierBindings.erase(current);
            modifierInputs.erase(current);
            nodeGenerations.erase(current);
            nodeTypes.erase(current);
            childrenByNode.erase(current);
            parentByNode.erase(current);
        }
    }

    void QuickJsRuntimeContext::recordDiagnostic(QuickJsDiagnosticEventInput event) {
        diagnosticEvents.push_back(std::move(event));
        while (diagnosticEvents.size() > 64) diagnosticEvents.erase(diagnosticEvents.begin());
    }

    void QuickJsRuntimeContext::recordDiagnosticAction(QuickJsDiagnosticAction action) {
        diagnosticActions.push_back(std::move(action));
        while (diagnosticActions.size() > 64) diagnosticActions.erase(diagnosticActions.begin());
    }
}  // namespace arrange::quickjs

#endif
