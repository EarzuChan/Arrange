#include <arrange/core/LayoutTree.h>

#include <arrange/core/PropSchema.h>
#include <arrange/core/SlotUpdate.h>

#include <algorithm>
#include <stdexcept>
#include <string_view>
#include <optional>
#include <unordered_set>
#include <vector>

namespace arrange::core {
    namespace {
        // 结构变化必然重测与重建命中；放置与变换必然重绘与重建命中；资源变化必然重绘
        std::uint32_t impliedDirty(DirtyFlag flag) noexcept {
            auto dirty = dirtyMask(flag);
            if (flag == DirtyFlag::Structure) dirty |= dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::HitTest);
            if (flag == DirtyFlag::Placement || flag == DirtyFlag::Transform) dirty |= dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
            if (flag == DirtyFlag::Resource) dirty |= dirtyMask(DirtyFlag::Paint);
            return dirty;
        }
    }

    namespace {
        bool hasArea(Rect rect) {
            return rect.width > 0.0f && rect.height > 0.0f;
        }

        std::vector<float> scrollValues(const LayoutNode& node) {
            std::vector<float> values;
            if (!std::holds_alternative<LazyMeasurePolicy>(node.measurePolicy)) return values;
            for (const auto& instance : node.modifier.elements()) {
                const auto* input = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value);
                if (input && (input->kind == LayoutModifierKind::VerticalScroll || input->kind == LayoutModifierKind::HorizontalScroll)) values.push_back(input->scrollValue);
            }
            return values;
        }

        Rect unionRect(Rect left, Rect right) {
            const auto x1 = std::min(left.x, right.x);
            const auto y1 = std::min(left.y, right.y);
            const auto x2 = std::max(left.x + left.width, right.x + right.width);
            const auto y2 = std::max(left.y + left.height, right.y + right.height);
            return {x1, y1, x2 - x1, y2 - y1};
        }

        template <typename T>
        const T* getIf(const TreeMutation& mutation) noexcept {
            return std::get_if<T>(&mutation);
        }
    }

    void LayoutTree::apply(const std::vector<TreeMutation>& mutations) {
        for (const auto& mutation : mutations) applyMutation(mutation);
    }

    void LayoutTree::applyMutation(const TreeMutation& mutation) {
        if (const auto* op = getIf<CreateNodeMutation>(mutation)) {
            if (op->id == 0 || contains(op->id)) throw std::invalid_argument("Arrange createNode requires a fresh nonzero node id");
            LayoutNode node;
            node.id = op->id;
            node.type = op->type;
            if (op->type == NodeType::Root) node.measurePolicy = BoxMeasurePolicy{LayoutAlignment::TopStart, true};
            node.generation = op->generation ? op->generation : allocateRuntimeIdentity();
            markDirty(node, DirtyFlag::Structure);
            invalidation_.record(impliedDirty(DirtyFlag::Structure));
            journalNode(op->id);
            node.journalEpoch = journalEpoch_;
            nodes_[op->id] = std::move(node);
            clearParent(op->id);
            return;
        }

        if (const auto* op = getIf<DeleteNodeMutation>(mutation)) {
            if (!contains(op->id)) return;
            detachFromParents(op->id);
            eraseSubtree(op->id);
            return;
        }

        if (const auto* op = getIf<InsertChildMutation>(mutation)) {
            (void)require(op->child);
            if (op->parent == op->child) throw std::runtime_error("Arrange layout tree cannot insert a node into itself");
            std::unordered_set<NodeId> visited;
            if (isDescendant(op->child, op->parent, visited)) {
                throw std::runtime_error("Arrange layout tree cannot insert an ancestor as a child");
            }
            auto& parent = mutableNode(op->parent);
            if (const auto oldParent = parentOf(op->child)) {
                auto& oldParentNode = mutableNode(*oldParent);
                oldParentNode.children.erase(std::remove(oldParentNode.children.begin(), oldParentNode.children.end(), op->child), oldParentNode.children.end());
                invalidateNode(*oldParent, DirtyFlag::Structure);
            }
            parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op->child), parent.children.end());
            const auto insertAt = std::min<std::size_t>(op->index, parent.children.size());
            parent.children.insert(parent.children.begin() + static_cast<std::ptrdiff_t>(insertAt), op->child);
            setParent(op->child, op->parent);
            invalidateNode(op->parent, DirtyFlag::Structure);
            return;
        }

        if (const auto* op = getIf<RemoveChildMutation>(mutation)) {
            auto& parent = mutableNode(op->parent);
            const auto oldSize = parent.children.size();
            parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op->child), parent.children.end());
            if (parent.children.size() != oldSize) {
                clearParent(op->child);
                invalidateNode(op->parent, DirtyFlag::Structure);
            }
            return;
        }

        if (const auto* op = getIf<SetPropMutation>(mutation)) {
            const auto input = hostInputFromName(op->key);
            if (!input) throw std::invalid_argument("Arrange unknown host input: " + op->key);
            setHostInput(op->id, *input, op->value);
            return;
        }

        if (const auto* op = getIf<SetModifierMutation>(mutation)) {
            setModifierChain(op->id, op->modifier);
            return;
        }

        if (const auto* op = getIf<NativeInvalidationMutation>(mutation)) {
            invalidateNode(op->id, op->flag);
        }
    }

    void LayoutTree::markInputDirty(NodeId id, std::uint32_t mask) {
        for (auto flag : {DirtyFlag::Layout, DirtyFlag::Placement, DirtyFlag::Paint, DirtyFlag::HitTest, DirtyFlag::Focus, DirtyFlag::EventSlot, DirtyFlag::Resource, DirtyFlag::Accessibility}) {
            if ((mask & dirtyMask(flag)) != 0) invalidateNode(id, flag);
        }
    }

    std::uint32_t LayoutTree::setHostInput(NodeId id, HostInput input, const PropValue& value) {
        auto& node = mutableNode(id);
        const auto name = std::string(hostInputName(input));
        if (input == HostInput::MeasurePolicy) {
            const auto policy = readMeasurePolicy(value, &node.measurePolicy);
            const auto mask = measurePolicyInvalidation(node.measurePolicy, policy);
            node.measurePolicy = policy;
            markInputDirty(id, mask);
            return mask;
        }
        std::string error;
        if (!validateSetPropMutation(node.type, name, value, error)) throw std::invalid_argument(error);
        // 空值回到默认的可用状态
        const auto enabled = value.isNull() || value.boolean;
        if (enabled == node.enabled) return 0;
        node.enabled = enabled;
        const auto mask = hostInputInvalidation(input);
        markInputDirty(id, mask);
        return mask;
    }

    std::uint32_t LayoutTree::setModifierInput(NodeId id, ModifierHandle handle, const ModifierValue& value) {
        auto& node = mutableNode(id);
        const auto previousScroll = scrollValues(node);
        auto mask = node.modifier.update(handle, value);
        if (previousScroll != scrollValues(node)) mask |= dirtyMask(DirtyFlag::Layout);
        markInputDirty(id, mask);
        return mask;
    }

    std::uint32_t LayoutTree::setModifierChain(NodeId id, const ModifierDescriptors& descriptors) {
        auto& node = mutableNode(id);
        const auto previousScroll = scrollValues(node);
        auto result = node.modifier.reconcile(descriptors);
        if (previousScroll != scrollValues(node)) result.dirty |= dirtyMask(DirtyFlag::Layout);
        markInputDirty(id, result.dirty);
        return result.dirty;
    }

    const LayoutNode& LayoutTree::node(NodeId id) const {
        return require(id);
    }

    LayoutNode& LayoutTree::mutableNode(NodeId id) {
        ++nodeAccesses_;
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) throw std::runtime_error("Arrange 布局节点不存在：" + std::to_string(id));
        auto& node = it->second;
        if (journal_ && node.journalEpoch != journalEpoch_) {
            journal_->nodes.emplace_back(id, node);
            node.journalEpoch = journalEpoch_;
        }
        return node;
    }

    void LayoutTree::beginJournal() {
        if (journal_) throw std::logic_error("Arrange 写入日志不能嵌套");
        journal_.emplace();
        ++journalEpoch_;
        journal_->invalidation = invalidation_;
        journal_->frameTimeMillis = frameTimeMillis_;
    }

    void LayoutTree::commitJournal() noexcept {
        journal_.reset();
    }

    void LayoutTree::rollbackJournal() {
        if (!journal_) return;
        auto journal = std::move(*journal_);
        journal_.reset();
        for (auto it = journal.nodes.rbegin(); it != journal.nodes.rend(); ++it)
            if (it->second)
                nodes_.insert_or_assign(it->first, std::move(*it->second));
            else
                nodes_.erase(it->first);
        for (auto it = journal.parents.rbegin(); it != journal.parents.rend(); ++it)
            if (it->second)
                parentByNode_.insert_or_assign(it->first, *it->second);
            else
                parentByNode_.erase(it->first);
        invalidation_ = journal.invalidation;
        frameTimeMillis_ = journal.frameTimeMillis;
    }

    void LayoutTree::journalNode(NodeId id) {
        if (!journal_) return;
        const auto it = nodes_.find(id);
        if (it == nodes_.end())
            journal_->nodes.emplace_back(id, std::nullopt);
        else if (it->second.journalEpoch != journalEpoch_) {
            journal_->nodes.emplace_back(id, it->second);
            it->second.journalEpoch = journalEpoch_;
        }
    }

    void LayoutTree::journalParent(NodeId child) {
        if (journal_) journal_->parents.emplace_back(child, parentOf(child));
    }

    std::vector<NodeId> LayoutTree::nodeIds() const {
        std::vector<NodeId> result;
        result.reserve(nodes_.size());
        for (const auto& [id, _] : nodes_) result.push_back(id);
        std::sort(result.begin(), result.end());
        return result;
    }

    DirtySnapshot LayoutTree::dirtySnapshot(std::uint32_t mask) const noexcept {
        DirtySnapshot snapshot;
        for (const auto& [_, node] : nodes_) {
            const auto matchedDirty = (node.dirty | node.subtreeDirty) & mask;
            if (matchedDirty == 0) continue;
            ++snapshot.nodeCount;
            snapshot.combinedDirty |= matchedDirty;
            if (!hasArea(node.bounds)) continue;
            if (!snapshot.hasRepaintBounds) {
                snapshot.repaintBounds = node.bounds;
                snapshot.hasRepaintBounds = true;
            } else {
                snapshot.repaintBounds = unionRect(snapshot.repaintBounds, node.bounds);
            }
        }
        return snapshot;
    }

    std::size_t LayoutTree::activeAnimationCount() const noexcept {
        std::size_t count = 0;
        for (const auto& [_, node] : nodes_)
            for (const auto& instance : node.modifier.elements())
                if (std::holds_alternative<AnimateContentSizeModifier>(instance.descriptor.value) && instance.sizeAnimation.running) ++count;
        return count;
    }

    void LayoutTree::advanceAnimations(double timeMillis) {
        frameTimeMillis_ = timeMillis;
        for (const auto& [id, node] : nodes_) {
            for (const auto& instance : node.modifier.elements()) {
                if (std::holds_alternative<AnimateContentSizeModifier>(instance.descriptor.value) && instance.sizeAnimation.running) {
                    invalidateNode(id, DirtyFlag::Layout);
                    break;
                }
            }
        }
    }

    void LayoutTree::clearDirty() {
        for (auto& [id, node] : nodes_) {
            if (node.dirty == 0 && node.subtreeDirty == 0) continue;
            journalNode(id);
            node.dirty = 0;
            node.subtreeDirty = 0;
        }
    }

    void LayoutTree::markDirtyWithPropagation(NodeId id, DirtyFlag flag) {
        auto& dirtyNode = mutableNode(id);
        markDirty(dirtyNode, flag);

        switch (flag) {
            case DirtyFlag::Structure:
                markDirty(dirtyNode, DirtyFlag::Layout);
                markDirty(dirtyNode, DirtyFlag::HitTest);
                markAncestorsDirty(id, DirtyFlag::Structure);
                markAncestorsDirty(id, DirtyFlag::Layout);
                markAncestorsDirty(id, DirtyFlag::HitTest);
                break;
            case DirtyFlag::Layout:
                markAncestorsDirty(id, DirtyFlag::Layout);
                break;
            case DirtyFlag::Placement:
                markAncestorsDirty(id, DirtyFlag::Placement);
                [[fallthrough]];
            case DirtyFlag::Transform:
                markDirty(dirtyNode, DirtyFlag::Paint);
                markDirty(dirtyNode, DirtyFlag::HitTest);
                markAncestorsDirty(id, DirtyFlag::HitTest);
                markAncestorsDirty(id, DirtyFlag::Paint);
                break;
            case DirtyFlag::HitTest:
                markAncestorsDirty(id, DirtyFlag::HitTest);
                break;
            case DirtyFlag::Resource:
                markDirty(dirtyNode, DirtyFlag::Paint);
                markAncestorsDirty(id, DirtyFlag::Paint);
                break;
            case DirtyFlag::Paint:
                markAncestorsDirty(id, DirtyFlag::Paint);
                break;
            case DirtyFlag::Focus:
            case DirtyFlag::Accessibility:
            case DirtyFlag::EventSlot:
            case DirtyFlag::Diagnostics:
                break;
        }
    }

    void LayoutTree::markAncestorsDirty(NodeId id, DirtyFlag flag) {
        auto current = id;
        std::unordered_set<NodeId> visited;
        while (const auto parentId = parentOf(current)) {
            if (!visited.insert(*parentId).second) break;
            if (require(*parentId).subtreeDirty & dirtyMask(flag)) break;
            auto& parent = mutableNode(*parentId);
            parent.subtreeDirty |= dirtyMask(flag);
            if (flag == DirtyFlag::Placement || flag == DirtyFlag::Structure || flag == DirtyFlag::Layout) markDirty(parent, flag);
            current = *parentId;
        }
    }

    void LayoutTree::invalidateNode(NodeId id, DirtyFlag flag) {
        markDirtyWithPropagation(id, flag);
        invalidation_.record(impliedDirty(flag));
    }

    void LayoutTree::invalidateScene(DirtyFlag flag) {
        const auto dirty = impliedDirty(flag);
        for (auto& [id, node] : nodes_) {
            journalNode(id);
            node.dirty |= dirty;
        }
        invalidation_.record(dirty);
    }

    void LayoutTree::invalidateViewport() noexcept {
        invalidation_.record(impliedDirty(DirtyFlag::Layout));
    }

    void LayoutTree::detachFromParents(NodeId id) {
        if (const auto parentId = parentOf(id)) {
            auto& node = mutableNode(*parentId);
            const auto oldSize = node.children.size();
            node.children.erase(std::remove(node.children.begin(), node.children.end(), id), node.children.end());
            if (node.children.size() != oldSize) {
                markDirty(node, DirtyFlag::Structure);
                markDirty(node, DirtyFlag::Layout);
                markDirty(node, DirtyFlag::HitTest);
                markAncestorsDirty(node.id, DirtyFlag::Structure);
                markAncestorsDirty(node.id, DirtyFlag::Layout);
                markAncestorsDirty(node.id, DirtyFlag::HitTest);
                invalidation_.record(impliedDirty(DirtyFlag::Structure));
            }
        }
        clearParent(id);
    }

    void LayoutTree::eraseSubtree(NodeId id) {
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) return;
        const auto children = it->second.children;
        for (auto child : children) eraseSubtree(child);
        clearParent(id);
        journalNode(id);
        nodes_.erase(id);
    }

    void LayoutTree::setParent(NodeId child, NodeId parent) {
        journalParent(child);
        parentByNode_[child] = parent;
    }

    void LayoutTree::clearParent(NodeId child) {
        journalParent(child);
        parentByNode_.erase(child);
    }

    std::optional<NodeId> LayoutTree::parentOf(NodeId id) const noexcept {
        const auto it = parentByNode_.find(id);
        if (it == parentByNode_.end()) return std::nullopt;
        return it->second;
    }

    const LayoutNode& LayoutTree::require(NodeId id) const {
        ++nodeAccesses_;
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) throw std::runtime_error("Arrange 布局节点不存在：" + std::to_string(id));
        return it->second;
    }

    bool LayoutTree::isDescendant(NodeId ancestor, NodeId candidate, std::unordered_set<NodeId>& visited) const {
        if (ancestor == candidate) return true;
        if (!visited.insert(ancestor).second) return false;
        const auto it = nodes_.find(ancestor);
        if (it == nodes_.end()) return false;
        for (auto child : it->second.children) {
            if (isDescendant(child, candidate, visited)) return true;
        }
        return false;
    }
}
