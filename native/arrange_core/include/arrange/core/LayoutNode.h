#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>
#include "Geometry.h"
#include "Modifier.h"
#include "PropValue.h"
#include "MeasurePolicy.h"

namespace arrange::core {
    enum class NodeType { Root, Layout, Unknown };

    struct PaintFragment;
    struct HitFragment;
    struct TextLayout;
    struct DrawOp;

    struct LayoutNode {
        NodeId id = 0;
        NodeType type = NodeType::Unknown;
        MeasurePolicy measurePolicy = MinSizeMeasurePolicy{};
        std::unordered_map<std::string, PropValue> props;
        ModifierChain modifier;
        Rect contentBounds;
        std::uint64_t generation = 0;
        Rect bounds;
        float baseline = -1.0f;
        std::vector<NodeId> children;
        std::uint32_t dirty = 0;
        std::uint32_t subtreeDirty = 0;
        Constraints measuredConstraints;
        bool measurementValid = false;
        bool placementValid = false;
        std::shared_ptr<const PaintFragment> paintCache;
        std::shared_ptr<const PaintFragment> contentFragment;
        std::shared_ptr<const HitFragment> hitCache;
    };

    inline void markDirty(LayoutNode& node, DirtyFlag flag) noexcept {
        node.dirty |= dirtyMask(flag);
    }
}  // namespace arrange::core
