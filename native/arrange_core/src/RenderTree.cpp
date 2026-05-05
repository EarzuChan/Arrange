#include <arrange/core/RenderTree.h>

#include <algorithm>
#include <stdexcept>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace arrange::core {
    namespace {
        bool isResourceProp(std::string_view key) { return key == "source" || key == "src"; }

        bool isAccessibilityProp(std::string_view key) { return key == "contentDescription" || key == "content-description" || key == "label" || key == "description" || key == "role" || key == "enabled"; }

        bool isEventProp(std::string_view key) { return key.rfind("on", 0) == 0 || key.find("callbackHandle") != std::string_view::npos; }

        bool isNativeHitTestProp(std::string_view key) {
            return key.rfind("__arrangeModifier.", 0) == 0 ||
                key == "__arrangeModifierCount" ||
                key == "__arrangeClickableEnabled" ||
                key == "__arrangeClickCallback" ||
                key == "__arrangeZIndex" ||
                key == "__arrangeLayoutOffsetX" ||
                key == "__arrangeLayoutOffsetY" ||
                key == "__arrangeLayerScaleX" ||
                key == "__arrangeLayerScaleY" ||
                key == "__arrangeLayerRotationZ" ||
                key == "__arrangeLayerTransformOriginX" ||
                key == "__arrangeLayerTransformOriginY" ||
                key == "__arrangeVerticalScrollEnabled" ||
                key == "__arrangeVerticalScrollValue" ||
                key == "__arrangeHorizontalScrollEnabled" ||
                key == "__arrangeHorizontalScrollValue";
        }

        bool isNativeTransformProp(std::string_view key) {
            return key.rfind("__arrangeModifier.", 0) == 0 ||
                key == "__arrangeModifierCount" ||
                key == "__arrangeZIndex" ||
                key == "__arrangeLayoutOffsetX" ||
                key == "__arrangeLayoutOffsetY" ||
                key == "__arrangeLayerScaleX" ||
                key == "__arrangeLayerScaleY" ||
                key == "__arrangeLayerRotationZ" ||
                key == "__arrangeLayerTransformOriginX" ||
                key == "__arrangeLayerTransformOriginY";
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

    void RenderTree::apply(const BridgeBatch& batch) {
        for (const auto& op : batch.ops) {
            switch (op.opcode) {
            case BridgeOpcode::CreateNode: {
                ArrangeNode node;
                node.id = op.id;
                node.type = nodeTypeFromBridgeName(op.nodeType);
                markDirty(node, DirtyFlag::Structure);
                nodes_[op.id] = std::move(node);
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
                if (op.parent == op.child) throw std::runtime_error("Arrange render tree cannot insert a node into itself");
                std::unordered_set<NodeId> visited;
                if (isDescendant(op.child, op.parent, visited)) { throw std::runtime_error("Arrange render tree cannot insert an ancestor as a child"); }
                auto& parent = require(op.parent);
                parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op.child), parent.children.end());
                const auto insertAt = std::min<std::size_t>(op.index, parent.children.size());
                parent.children.insert(parent.children.begin() + static_cast<std::ptrdiff_t>(insertAt), op.child);
                markDirtyWithPropagation(op.parent, DirtyFlag::Structure);
                break;
            }
            case BridgeOpcode::RemoveChild: {
                auto& parent = require(op.parent);
                const auto oldSize = parent.children.size();
                parent.children.erase(std::remove(parent.children.begin(), parent.children.end(), op.child), parent.children.end());
                if (parent.children.size() != oldSize) markDirtyWithPropagation(op.parent, DirtyFlag::Structure);
                break;
            }
            case BridgeOpcode::SetProp: {
                auto& node = require(op.id);
                node.props[op.key] = op.value;
                markDirtyWithPropagation(op.id, DirtyFlag::Layout);
                markDirtyWithPropagation(op.id, DirtyFlag::Paint);
                if (isResourceProp(op.key)) markDirtyWithPropagation(op.id, DirtyFlag::Resource);
                if (isAccessibilityProp(op.key)) markDirtyWithPropagation(op.id, DirtyFlag::Accessibility);
                if (isEventProp(op.key) || isNativeHitTestProp(op.key)) markDirtyWithPropagation(op.id, DirtyFlag::HitTest);
                if (isNativeTransformProp(op.key)) markDirtyWithPropagation(op.id, DirtyFlag::Transform);
                break;
            }
            case BridgeOpcode::SetModifier: {
                auto& node = require(op.id);
                node.modifierDebugJson = op.modifierDebugJson;
                break;
            }
            case BridgeOpcode::SetText: {
                auto& node = require(op.id);
                node.text = op.text;
                markDirtyWithPropagation(op.id, DirtyFlag::Layout);
                markDirtyWithPropagation(op.id, DirtyFlag::Paint);
                break;
            }
            }
        }
    }

    const ArrangeNode& RenderTree::node(NodeId id) const { return require(id); }
    ArrangeNode& RenderTree::node(NodeId id) { return require(id); }

    DirtySnapshot RenderTree::dirtySnapshot(std::uint32_t mask) const noexcept {
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

    void RenderTree::clearDirty() noexcept { for (auto& [_, node] : nodes_) node.dirty = 0; }

    void RenderTree::markDirtyWithPropagation(NodeId id, DirtyFlag flag) {
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
            markAncestorsDirty(id, DirtyFlag::HitTest);
            markAncestorsDirty(id, DirtyFlag::Paint);
            break;
        case DirtyFlag::HitTest:
            markAncestorsDirty(id, DirtyFlag::HitTest);
            break;
        case DirtyFlag::Resource:
            markAncestorsDirty(id, DirtyFlag::Layout);
            markAncestorsDirty(id, DirtyFlag::Paint);
            break;
        case DirtyFlag::Paint:
        case DirtyFlag::Focus:
        case DirtyFlag::Accessibility:
            break;
        }
    }

    void RenderTree::markAncestorsDirty(NodeId id, DirtyFlag flag) {
        std::vector<NodeId> parents;
        for (const auto& [candidateId, node] : nodes_) { if (std::find(node.children.begin(), node.children.end(), id) != node.children.end()) parents.push_back(candidateId); }
        for (auto parentId : parents) {
            markDirty(require(parentId), flag);
            markAncestorsDirty(parentId, flag);
        }
    }

    void RenderTree::detachFromParents(NodeId id) {
        for (auto& [_, node] : nodes_) {
            const auto oldSize = node.children.size();
            node.children.erase(std::remove(node.children.begin(), node.children.end(), id), node.children.end());
            if (node.children.size() != oldSize) {
                markDirty(node, DirtyFlag::Structure);
                markDirty(node, DirtyFlag::Layout);
                markDirty(node, DirtyFlag::HitTest);
                markAncestorsDirty(node.id, DirtyFlag::Structure);
                markAncestorsDirty(node.id, DirtyFlag::Layout);
                markAncestorsDirty(node.id, DirtyFlag::HitTest);
            }
        }
    }

    void RenderTree::eraseSubtree(NodeId id) {
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) return;
        const auto children = it->second.children;
        for (auto child : children) eraseSubtree(child);
        nodes_.erase(id);
    }

    ArrangeNode& RenderTree::require(NodeId id) {
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) throw std::runtime_error("Arrange render tree node does not exist");
        return it->second;
    }

    const ArrangeNode& RenderTree::require(NodeId id) const {
        const auto it = nodes_.find(id);
        if (it == nodes_.end()) throw std::runtime_error("Arrange render tree node does not exist");
        return it->second;
    }

    bool RenderTree::isDescendant(NodeId ancestor, NodeId candidate, std::unordered_set<NodeId>& visited) const {
        if (ancestor == candidate) return true;
        if (!visited.insert(ancestor).second) return false;
        const auto it = nodes_.find(ancestor);
        if (it == nodes_.end()) return false;
        for (auto child : it->second.children) { if (isDescendant(child, candidate, visited)) return true; }
        return false;
    }
} // namespace arrange::core
