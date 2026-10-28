#pragma once

#include <deque>
#include <optional>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
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

        bool contains(NodeId id) const noexcept {
            return nodes_.find(id) != nodes_.end();
        }

        const LayoutNode& node(NodeId id) const;
        // 唯一的节点写入口；写入日志开启时首次写入前保存原值
        LayoutNode& mutableNode(NodeId id);
        [[nodiscard]] std::optional<NodeId> parentOf(NodeId id) const noexcept;

        std::size_t size() const noexcept {
            return nodes_.size();
        }

        std::vector<NodeId> nodeIds() const;

        std::uint64_t nodeAccesses() const noexcept {
            return nodeAccesses_;
        }

        void resetNodeAccesses() const noexcept {
            nodeAccesses_ = 0;
        }

        DirtySnapshot dirtySnapshot(std::uint32_t mask = 0xffffffffu) const noexcept;

        [[nodiscard]] const InvalidationSnapshot& invalidationSnapshot() const noexcept {
            return invalidation_.snapshot();
        }

        [[nodiscard]] InvalidationSnapshot takeInvalidation() noexcept {
            return invalidation_.take();
        }

        void requestFullFallback() noexcept {
            invalidation_.requireFullFallback();
        }

        // 全场景失效：每个节点都标记该阶段
        void invalidateScene(DirtyFlag flag);
        // 视口约束变化只改变根约束，后代自行检查实际传入的约束
        void invalidateViewport() noexcept;
        void clearDirty();
        void advanceAnimations(double timeMillis);
        std::size_t activeAnimationCount() const noexcept;

        double frameTimeMillis() const noexcept {
            return frameTimeMillis_;
        }

        std::uint32_t setHostInput(NodeId id, HostInput input, const PropValue& value);
        std::uint32_t setModifierInput(NodeId id, ModifierHandle handle, const ModifierValue& value);
        std::uint32_t setModifierChain(NodeId id, const ModifierDescriptors& descriptors);
        void markInputDirty(NodeId id, std::uint32_t mask);

        void applyMutation(const TreeMutation& mutation);

        // 写入日志代替整树复制：提交丢弃原值，回滚按原值恢复；不可嵌套
        void beginJournal();
        void commitJournal() noexcept;
        void rollbackJournal();

        [[nodiscard]] std::size_t journaledNodes() const noexcept {
            return journal_ ? journal_->nodes.size() : 0;
        }

       private:
        struct Journal {
            // 按写入顺序记录原值，回滚逆序恢复；空值表示原先不存在；deque 追加不搬移已存节点
            std::deque<std::pair<NodeId, std::optional<LayoutNode>>> nodes;
            std::vector<std::pair<NodeId, std::optional<NodeId>>> parents;
            InvalidationGraph invalidation;
            double frameTimeMillis = 0;
        };

        void journalNode(NodeId id);
        void journalParent(NodeId child);
        void markDirtyWithPropagation(NodeId id, DirtyFlag flag);
        void markAncestorsDirty(NodeId id, DirtyFlag flag);
        void invalidateNode(NodeId id, DirtyFlag flag);
        void detachFromParents(NodeId id);
        void eraseSubtree(NodeId id);
        void setParent(NodeId child, NodeId parent);
        void clearParent(NodeId child);
        const LayoutNode& require(NodeId id) const;
        bool isDescendant(NodeId ancestor, NodeId candidate, std::unordered_set<NodeId>& visited) const;
        std::unordered_map<NodeId, LayoutNode> nodes_;
        std::unordered_map<NodeId, NodeId> parentByNode_;
        InvalidationGraph invalidation_;
        double frameTimeMillis_ = 0;
        mutable std::uint64_t nodeAccesses_ = 0;
        std::optional<Journal> journal_;
        std::uint64_t journalEpoch_ = 0;
    };
}
