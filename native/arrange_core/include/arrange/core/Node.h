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

    struct ArrangeNode {
        NodeId id = 0;
        NodeType type = NodeType::Unknown;
        MeasurePolicy measurePolicy = MinSizeMeasurePolicy{};
        std::unordered_map<std::string, PropValue> props;
        std::unordered_map<EventSlotKind, EventSlotId> eventSlots;
        ModifierChain modifier;
        Rect contentBounds;
        std::uint64_t generation = 0;
        Rect bounds;
        float baseline = -1.0f;
        std::vector<NodeId> children;
        std::uint32_t dirty = 0;
        Constraints measuredConstraints;
        bool measurementValid = false;
        bool placementValid = false;
        std::shared_ptr<const PaintFragment> paintCache;
        std::shared_ptr<const PaintFragment> contentFragment;
        std::shared_ptr<const std::vector<DrawOp>> paintContent;
        std::uint64_t contentRevision = 1;
        std::uint64_t paintedContentRevision = 0;
        Size paintedContentSize;
        std::shared_ptr<const HitFragment> hitCache;

    };

    inline void markDirty(ArrangeNode& node, DirtyFlag flag) noexcept { node.dirty |= dirtyMask(flag); }
}
