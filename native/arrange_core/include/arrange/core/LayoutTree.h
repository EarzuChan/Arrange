#pragma once

#include <unordered_map>
#include <unordered_set>
#include <utility>
#include "Invalidation.h"
#include "Mutation.h"
#include "HostInput.h"
#include "LayoutNode.h"

namespace arrange::core {
    struct DirtySnapshot {
        std::size_t nodeCount = 0;
        std::uint32_t combinedDirty = 0;
        bool hasRepaintBounds = false;
        Rect repaintBounds;
    };

    class LayoutTree {
    public:
        void apply(const std::vector<TreeMutation>& mutations);
        bool contains(NodeId id) const noexcept { return nodes_.find(id) != nodes_.end(); }
        const LayoutNode& node(NodeId id) const;
        LayoutNode& node(NodeId id);
        [[nodiscard]] std::optional<NodeId> parentOf(NodeId id) const noexcept;
        std::size_t size() const noexcept { return nodes_.size(); }
        DirtySnapshot dirtySnapshot(std::uint32_t mask = 0xffffffffu) const noexcept;
        [[nodiscard]] const InvalidationSnapshot& invalidationSnapshot() const noexcept { return invalidation_.snapshot(); }
        [[nodiscard]] InvalidationSnapshot takeInvalidation() noexcept { return invalidation_.take(); }
        void requestFullFallback(std::string reason) { invalidation_.requireFullFallback(std::move(reason)); }
        void recordSceneInvalidation(
            DirtyFlag flag,
            InvalidationSource source,
            std::string field,
            std::string reason);
        void clearDirty() noexcept;
        void advanceAnimations(double timeMillis);
        std::size_t activeAnimationCount() const noexcept;
        double frameTimeMillis() const noexcept { return frameTimeMillis_; }
        std::uint32_t setHostInput(NodeId id, HostInput input, const PropValue& value);
        std::uint32_t setModifierInput(NodeId id, ModifierHandle handle, const ModifierValue& value);
        std::uint32_t setModifierChain(NodeId id, const ModifierDescriptors& descriptors);
        void markInputDirty(NodeId id, std::uint32_t mask);

        void applyMutation(const TreeMutation& mutation);

    private:
        void markDirtyWithPropagation(NodeId id, DirtyFlag flag);
        void markAncestorsDirty(NodeId id, DirtyFlag flag);
        void markDirtyAttributed(
            NodeId id,
            DirtyFlag flag,
            InvalidationSource source,
            std::string field,
            std::string reason);
        void recordDirtyAttribution(
            NodeId id,
            DirtyFlag flag,
            InvalidationSource source,
            std::string field,
            std::string reason);
        void detachFromParents(NodeId id);
        void eraseSubtree(NodeId id);
        void setParent(NodeId child, NodeId parent);
        void clearParent(NodeId child);
        LayoutNode& require(NodeId id);
        const LayoutNode& require(NodeId id) const;
        bool isDescendant(NodeId ancestor, NodeId candidate, std::unordered_set<NodeId>& visited) const;
        std::unordered_map<NodeId, LayoutNode> nodes_;
        std::unordered_map<NodeId, NodeId> parentByNode_;
        InvalidationGraph invalidation_;
        double frameTimeMillis_ = 0;
    };
} // namespace arrange::core
