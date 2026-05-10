#include <arrange/core/LayoutTree.h>

#include <algorithm>
#include <arrange/core/Modifier.h>
#include <stdexcept>
#include <string_view>
#include <optional>
#include <unordered_set>
#include <vector>

namespace arrange::core {
    namespace {
        bool isResourceProp(std::string_view key) { return key == "source" || key == "src"; }

        bool isAccessibilityProp(std::string_view key) { return key == "contentDescription" || key == "content-description" || key == "label" || key == "description" || key == "role" || key == "enabled"; }

        bool isEventProp(std::string_view key) {
            return key.rfind("on", 0) == 0 ||
                key.rfind("__arrangeEventSlot.", 0) == 0 ||
                key.find("EventSlot") != std::string_view::npos;
        }





        bool isNativeInputInvalidationProp(std::string_view key) {
            return key == "__arrangeNativeInputPaintInvalidation" ||
                key == "__arrangeNativeInputStateInvalidation";
        }

        bool hasArea(Rect rect) { return rect.width > 0.0f && rect.height > 0.0f; }

        Rect unionRect(Rect left, Rect right) {
            const auto x1 = std::min(left.x, right.x);
            const auto y1 = std::min(left.y, right.y);
            const auto x2 = std::max(left.x + left.width, right.x + right.width);
            const auto y2 = std::max(left.y + left.height, right.y + right.height);
            return {x1, y1, x2 - x1, y2 - y1};
        }
    } // namespace

    void LayoutTree::apply(const BridgeBatch& batch) {
        for (const auto& op : batch.ops) {
            switch (op.opcode) {
            case BridgeOpcode::CreateNode: {
                ArrangeNode node;
                node.id = op.id;
                node.type = nodeTypeFromBridgeName(op.nodeType);
                markDirty(node, DirtyFlag::Structure);
                recordDirtyAttribution(op.id, DirtyFlag::Structure, InvalidationSource::BridgeMutation, "node", "create node");
                nodes_[op.id] = std::move(node);
                clearParent(op.id);
                break;
            }
            case BridgeOpcode::DeleteNode: {
                if (!contains(op.id)) break;
                detachFromParents(op.id);
                eraseSubtree(op.id);
                break;
            }
            case BridgeOpcode::InsertChild: {
                require(op.child);
                if (op.parent == op.child) throw std::runtime_error("Arrange layout tree cannot insert a node into itself");
                std::unordered_set<NodeId> visited;
                if (isDescendant(op.child, op.parent, visited)) { throw std::runtime_error("Arrange layout tree cannot insert an ancestor as a child"); }
                auto& parent = require(op.parent);
                if (const auto oldParent = parentOf(op.child)) {
                    auto& oldParentNode = require(*oldParent);
                    oldParentNode.children.erase(std::remove(oldParentNode.children.begin(), oldParentNode.children.end(), op.child), oldParentNode.children.end());
                    markDirtyWithPropagation(*oldParent, DirtyFlag::Structure);
                }
                parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op.child), parent.children.end());
                const auto insertAt = std::min<std::size_t>(op.index, parent.children.size());
                parent.children.insert(parent.children.begin() + static_cast<std::ptrdiff_t>(insertAt), op.child);
                setParent(op.child, op.parent);
                markDirtyWithPropagation(op.parent, DirtyFlag::Structure);
                break;
            }
            case BridgeOpcode::RemoveChild: {
                auto& parent = require(op.parent);
                const auto oldSize = parent.children.size();
                parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op.child), parent.children.end());
                if (parent.children.size() != oldSize) {
                    clearParent(op.child);
                    markDirtyWithPropagation(op.parent, DirtyFlag::Structure);
                }
                break;
            }
            case BridgeOpcode::SetProp: {
                auto& node = require(op.id);
                if (isNativeInputInvalidationProp(op.key)) {
                    const auto flag = op.key == "__arrangeNativeInputPaintInvalidation" ? DirtyFlag::Paint : DirtyFlag::EventSlot;
                    markDirtyAttributed(op.id, flag, InvalidationSource::NativeState, op.key, op.value);
                    break;
                }
                node.props[op.key] = op.value;
                if (isEventProp(op.key)) {
                    markDirtyAttributed(op.id, DirtyFlag::EventSlot, InvalidationSource::BridgeMutation, op.key, "event slot update");
                    break;
                }
                if (isResourceProp(op.key)) {
                    markDirtyAttributed(op.id, DirtyFlag::Resource, InvalidationSource::BridgeMutation, op.key, "resource prop changed");
                    break;
                }
                if (isAccessibilityProp(op.key)) {
                    markDirtyAttributed(op.id, DirtyFlag::Accessibility, InvalidationSource::BridgeMutation, op.key, "accessibility prop changed");
                    break;
                }
                markDirtyAttributed(op.id, DirtyFlag::Layout, InvalidationSource::BridgeMutation, op.key, "layout prop changed");
                markDirtyAttributed(op.id, DirtyFlag::Paint, InvalidationSource::BridgeMutation, op.key, "paint prop changed");
                break;
            }
            case BridgeOpcode::SetModifier: {
                auto& node = require(op.id);
                const auto oldModifier = node.modifier;
                auto newModifier = ModifierCompiler{}.compile(op.modifierPayload);
                const auto diff = diffCompiledModifier(oldModifier, newModifier);
                node.modifierPayload = op.modifierPayload;
                node.modifier = std::move(newModifier);
                if (diff.dirtyMask == 0) {
                    markDirtyAttributed(op.id, DirtyFlag::EventSlot, InvalidationSource::BridgeMutation, "modifier", "modifier metadata changed");
                    break;
                }
                if ((diff.dirtyMask & dirtyMask(DirtyFlag::Layout)) != 0) markDirtyAttributed(op.id, DirtyFlag::Layout, InvalidationSource::BridgeMutation, "modifier", "compiled layout modifier changed");
                if ((diff.dirtyMask & dirtyMask(DirtyFlag::Paint)) != 0) markDirtyAttributed(op.id, DirtyFlag::Paint, InvalidationSource::BridgeMutation, "modifier", "compiled paint modifier changed");
                if ((diff.dirtyMask & dirtyMask(DirtyFlag::Transform)) != 0) markDirtyAttributed(op.id, DirtyFlag::Transform, InvalidationSource::BridgeMutation, "modifier", "compiled transform modifier changed");
                if ((diff.dirtyMask & dirtyMask(DirtyFlag::HitTest)) != 0) markDirtyAttributed(op.id, DirtyFlag::HitTest, InvalidationSource::BridgeMutation, "modifier", "compiled input/hit-test modifier changed");
                if ((diff.dirtyMask & dirtyMask(DirtyFlag::Focus)) != 0) markDirtyAttributed(op.id, DirtyFlag::Focus, InvalidationSource::BridgeMutation, "modifier", "compiled focus modifier changed");
                break;
            }
            case BridgeOpcode::SetText: {
                auto& node = require(op.id);
                node.text = op.text;
                markDirtyAttributed(op.id, DirtyFlag::Layout, InvalidationSource::BridgeMutation, "text", "text changed");
                markDirtyAttributed(op.id, DirtyFlag::Paint, InvalidationSource::BridgeMutation, "text", "text changed");
                break;
            }
            }
        }
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
                recordDirtyAttribution(node.id, DirtyFlag::Structure, InvalidationSource::BridgeMutation, "children", "detach child");
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

    void LayoutTree::setParent(NodeId child, NodeId parent) {
        parentByNode_[child] = parent;
    }

    void LayoutTree::clearParent(NodeId child) {
        parentByNode_.erase(child);
    }

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
