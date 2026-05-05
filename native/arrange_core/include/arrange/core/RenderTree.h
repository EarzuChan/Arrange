#pragma once

#include <unordered_map>
#include <unordered_set>
#include "Bridge.h"
#include "Node.h"

namespace arrange::core {
    struct DirtySnapshot {
        std::size_t nodeCount = 0;
        std::uint32_t combinedDirty = 0;
        bool hasRepaintBounds = false;
        Rect repaintBounds;
    };

    class RenderTree {
    public:
        void apply(const BridgeBatch& batch);
        bool contains(NodeId id) const noexcept { return nodes_.find(id) != nodes_.end(); }
        const ArrangeNode& node(NodeId id) const;
        ArrangeNode& node(NodeId id);
        std::size_t size() const noexcept { return nodes_.size(); }
        DirtySnapshot dirtySnapshot(std::uint32_t mask = 0xffffffffu) const noexcept;
        void clearDirty() noexcept;

    private:
        void markDirtyWithPropagation(NodeId id, DirtyFlag flag);
        void markAncestorsDirty(NodeId id, DirtyFlag flag);
        void detachFromParents(NodeId id);
        void eraseSubtree(NodeId id);
        ArrangeNode& require(NodeId id);
        const ArrangeNode& require(NodeId id) const;
        bool isDescendant(NodeId ancestor, NodeId candidate, std::unordered_set<NodeId>& visited) const;
        std::unordered_map<NodeId, ArrangeNode> nodes_;
    };
} // namespace arrange::core
