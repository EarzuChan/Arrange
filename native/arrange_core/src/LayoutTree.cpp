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
        bool hasArea(Rect rect) { return rect.width > 0.0f && rect.height > 0.0f; }

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
    } // namespace

    void LayoutTree::apply(const std::vector<TreeMutation>& mutations) {
        for (const auto& mutation : mutations) applyMutation(mutation);
    }

    void LayoutTree::applyMutation(const TreeMutation& mutation) {
        if (const auto* op = getIf<CreateNodeMutation>(mutation)) {
            if (op->id == 0 || contains(op->id)) throw std::invalid_argument("Arrange createNode requires a fresh nonzero node id");
            ArrangeNode node;
            node.id = op->id;
            node.type = op->type;
            node.generation = op->generation ? op->generation : allocateRuntimeIdentity();
            markDirty(node, DirtyFlag::Structure);
            recordDirtyAttribution(op->id, DirtyFlag::Structure, InvalidationSource::NativeMutation, "node", "create node");
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
            require(op->child);
            if (op->parent == op->child) throw std::runtime_error("Arrange layout tree cannot insert a node into itself");
            std::unordered_set<NodeId> visited;
            if (isDescendant(op->child, op->parent, visited)) { throw std::runtime_error("Arrange layout tree cannot insert an ancestor as a child"); }
            auto& parent = require(op->parent);
            if (const auto oldParent = parentOf(op->child)) {
                auto& oldParentNode = require(*oldParent);
                oldParentNode.children.erase(std::remove(oldParentNode.children.begin(), oldParentNode.children.end(), op->child), oldParentNode.children.end());
                markDirtyWithPropagation(*oldParent, DirtyFlag::Structure);
            }
            parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op->child), parent.children.end());
            const auto insertAt = std::min<std::size_t>(op->index, parent.children.size());
            parent.children.insert(parent.children.begin() + static_cast<std::ptrdiff_t>(insertAt), op->child);
            setParent(op->child, op->parent);
            markDirtyWithPropagation(op->parent, DirtyFlag::Structure);
            return;
        }

        if (const auto* op = getIf<RemoveChildMutation>(mutation)) {
            auto& parent = require(op->parent);
            const auto oldSize = parent.children.size();
            parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op->child), parent.children.end());
            if (parent.children.size() != oldSize) {
                clearParent(op->child);
                markDirtyWithPropagation(op->parent, DirtyFlag::Structure);
            }
            return;
        }

        if (const auto* op = getIf<SetPropMutation>(mutation)) {
            const auto input = hostInputFromName(op->key);
            if (!input) throw std::invalid_argument("Arrange unknown host input: " + op->key);
            setHostInput(op->id, *input, op->value);
            return;
        }

        if (const auto* op = getIf<SetEventSlotMutation>(mutation)) {
            auto& node = require(op->id);
            if (op->kind != EventSlotKind::None && op->slot.valid()) {
                node.eventSlots[op->kind] = op->slot;
                markDirtyAttributed(op->id, DirtyFlag::EventSlot, InvalidationSource::NativeMutation, eventSlotKindName(op->kind), "event callback changed");
            }
            return;
        }

        if (const auto* op = getIf<ClearEventSlotMutation>(mutation)) {
            auto& node = require(op->id);
            if (op->kind != EventSlotKind::None && node.eventSlots.erase(op->kind) > 0) {
                markDirtyAttributed(op->id, DirtyFlag::EventSlot, InvalidationSource::NativeMutation, eventSlotKindName(op->kind), "event callback removed");
            }
            return;
        }

        if (const auto* op = getIf<SetModifierMutation>(mutation)) {
            setModifierChain(op->id, op->modifier);
            return;
        }

        if (const auto* op = getIf<SetTextMutation>(mutation)) {
            setHostInput(op->id, HostInput::Text, PropValue::stringValue(op->text));
            return;
        }

        if (const auto* op = getIf<NativeInvalidationMutation>(mutation)) {
            markDirtyAttributed(op->id, op->flag, InvalidationSource::NativeState, op->field, op->reason);
        }
    }

    void LayoutTree::markInputDirty(NodeId id, std::uint32_t mask) {
        for (auto flag : {DirtyFlag::Layout, DirtyFlag::Placement, DirtyFlag::Paint, DirtyFlag::HitTest, DirtyFlag::Focus, DirtyFlag::EventSlot, DirtyFlag::Resource, DirtyFlag::Accessibility}) {
            if ((mask & dirtyMask(flag)) != 0) markDirtyAttributed(id, flag, InvalidationSource::NativeMutation, "typed input", "consumer input changed");
        }
    }

    std::uint32_t LayoutTree::setHostInput(NodeId id, HostInput input, const PropValue& value) {
        auto& node = require(id);
        const auto name = std::string(hostInputName(input));
        if (input == HostInput::Text) {
            if (!value.isString()) throw std::invalid_argument("Arrange text input requires string");
            if (node.text == value.string) return 0;
            const auto mask = hostInputInvalidation(input, nullptr, value);
            node.text = value.string;
            markInputDirty(id, mask);
            return mask;
        }
        std::string error;
        if (!validateSetPropMutation(node.type, name, value, error)) throw std::invalid_argument(error);
        const auto previous = node.props.find(name);
        if (previous == node.props.end() && value.isNull()) return 0;
        const auto mask = hostInputInvalidation(input, previous == node.props.end() ? nullptr : &previous->second, value);
        if (mask != 0) {
            if (value.isNull()) node.props.erase(name);
            else node.props[name] = value;
            markInputDirty(id, mask);
        }
        return mask;
    }

    std::uint32_t LayoutTree::setModifierInput(NodeId id, ModifierHandle handle, const ModifierValue& value) {
        const auto mask = require(id).modifier.update(handle, value);
        markInputDirty(id, mask);
        return mask;
    }

    std::uint32_t LayoutTree::setModifierChain(NodeId id, const ModifierDescriptors& descriptors) {
        const auto result = require(id).modifier.reconcile(descriptors);
        markInputDirty(id, result.dirty);
        return result.dirty;
    }

    const ArrangeNode& LayoutTree::node(NodeId id) const { return require(id); }
    ArrangeNode& LayoutTree::node(NodeId id) { return require(id); }

    DirtySnapshot LayoutTree::dirtySnapshot(std::uint32_t mask) const noexcept {
        DirtySnapshot snapshot;
        for (const auto& [_, node] : nodes_) {
            const auto matchedDirty = node.dirty & mask;
            if (matchedDirty == 0) continue;
            ++snapshot.nodeCount;
            snapshot.combinedDirty |= matchedDirty;
            if (!hasArea(node.bounds)) continue;
            if (!snapshot.hasRepaintBounds) {
                snapshot.repaintBounds = node.bounds;
                snapshot.hasRepaintBounds = true;
            }
            else { snapshot.repaintBounds = unionRect(snapshot.repaintBounds, node.bounds); }
        }
        return snapshot;
    }

    void LayoutTree::clearDirty() noexcept { for (auto& [_, node] : nodes_) node.dirty = 0; }

    void LayoutTree::markDirtyWithPropagation(NodeId id, DirtyFlag flag) {
        auto& dirtyNode = require(id);
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
        case DirtyFlag::Focus:
        case DirtyFlag::Accessibility:
        case DirtyFlag::EventSlot:
            break;
        }
    }

    void LayoutTree::markAncestorsDirty(NodeId id, DirtyFlag flag) {
        auto current = id;
        std::unordered_set<NodeId> visited;
        while (const auto parentId = parentOf(current)) {
            if (!visited.insert(*parentId).second) break;
            markDirty(require(*parentId), flag);
            current = *parentId;
        }
    }

    void LayoutTree::markDirtyAttributed(
        NodeId id,
        DirtyFlag flag,
        InvalidationSource source,
        std::string field,
        std::string reason) {
        markDirtyWithPropagation(id, flag);
        recordDirtyAttribution(id, flag, source, std::move(field), std::move(reason));
    }

    void LayoutTree::recordDirtyAttribution(
        NodeId id,
        DirtyFlag flag,
        InvalidationSource source,
        std::string field,
        std::string reason) {
        std::uint32_t dirty = dirtyMask(flag);
        switch (flag) {
        case DirtyFlag::Structure:
            dirty |= dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::HitTest);
            break;
        case DirtyFlag::Placement:
        case DirtyFlag::Transform:
            dirty |= dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
            break;
        case DirtyFlag::Resource:
            dirty |= dirtyMask(DirtyFlag::Paint);
            break;
        case DirtyFlag::Layout:
        case DirtyFlag::Paint:
        case DirtyFlag::HitTest:
        case DirtyFlag::Focus:
        case DirtyFlag::Accessibility:
        case DirtyFlag::EventSlot:
            break;
        }
        invalidation_.record(source, id, dirty, std::move(field), std::move(reason));
    }

    void LayoutTree::recordSceneInvalidation(
        DirtyFlag flag,
        InvalidationSource source,
        std::string field,
        std::string reason) {
        std::uint32_t dirty = dirtyMask(flag);
        switch (flag) {
        case DirtyFlag::Structure:
            dirty |= dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::HitTest);
            break;
        case DirtyFlag::Placement:
        case DirtyFlag::Transform:
            dirty |= dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
            break;
        case DirtyFlag::Resource:
            dirty |= dirtyMask(DirtyFlag::Paint);
            break;
        case DirtyFlag::Layout:
        case DirtyFlag::Paint:
        case DirtyFlag::HitTest:
        case DirtyFlag::Focus:
        case DirtyFlag::Accessibility:
        case DirtyFlag::EventSlot:
            break;
        }
        invalidation_.record(source, std::nullopt, dirty, std::move(field), std::move(reason));
    }

    void LayoutTree::detachFromParents(NodeId id) {
        if (const auto parentId = parentOf(id)) {
            auto& node = require(*parentId);
            const auto oldSize = node.children.size();
            node.children.erase(std::remove(node.children.begin(), node.children.end(), id), node.children.end());
            if (node.children.size() != oldSize) {
                markDirty(node, DirtyFlag::Structure);
                markDirty(node, DirtyFlag::Layout);
                markDirty(node, DirtyFlag::HitTest);
                markAncestorsDirty(node.id, DirtyFlag::Structure);
                markAncestorsDirty(node.id, DirtyFlag::Layout);
                markAncestorsDirty(node.id, DirtyFlag::HitTest);
                recordDirtyAttribution(node.id, DirtyFlag::Structure, InvalidationSource::NativeMutation, "children", "detach child");
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
        nodes_.erase(id);
    }

    void LayoutTree::setParent(NodeId child, NodeId parent) { parentByNode_[child] = parent; }
    void LayoutTree::clearParent(NodeId child) { parentByNode_.erase(child); }

    std::optional<NodeId> LayoutTree::parentOf(NodeId id) const noexcept {
        const auto it = parentByNode_.find(id);
        if (it == parentByNode_.end()) return std::nullopt;
        return it->second;
    }

    ArrangeNode& LayoutTree::require(NodeId id) {
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) throw std::runtime_error("Arrange layout tree node does not exist");
        return it->second;
    }

    const ArrangeNode& LayoutTree::require(NodeId id) const {
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) throw std::runtime_error("Arrange layout tree node does not exist");
        return it->second;
    }

    bool LayoutTree::isDescendant(NodeId ancestor, NodeId candidate, std::unordered_set<NodeId>& visited) const {
        if (ancestor == candidate) return true;
        if (!visited.insert(ancestor).second) return false;
        const auto it = nodes_.find(ancestor);
        if (it == nodes_.end()) return false;
        for (auto child : it->second.children) { if (isDescendant(child, candidate, visited)) return true; }
        return false;
    }
} // namespace arrange::core
