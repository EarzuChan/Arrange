#pragma once
#include <cstdint>
#include <memory>
#include <vector>
#include "Geometry.h"
#include "Modifier.h"
#include "MeasurePolicy.h"

namespace arrange::core {
    enum class NodeType { Root, Layout, Unknown };

    struct LazyLayoutState;
    struct PaintFragment;
    struct HitFragment;
    struct TextLayout;
    struct DrawOp;

    struct LayoutNode {
        NodeId id = 0;
        NodeType type = NodeType::Unknown;
        MeasurePolicy measurePolicy = MinSizeMeasurePolicy{};
        // 宿主输入 enabled；为 false 时整棵子树不参与命中与交互
        bool enabled = true;
        ModifierChain modifier;
        Rect contentBounds;
        std::uint64_t generation = 0;
        Rect bounds;
        float baseline = -1.0f;
        std::vector<NodeId> children;
        std::vector<std::vector<NodeId>> flowLines;
        std::shared_ptr<LazyLayoutState> lazy;
        std::uint32_t dirty = 0;
        std::uint32_t subtreeDirty = 0;
        Constraints measuredConstraints;
        bool measurementValid = false;
        bool placementValid = false;
        std::shared_ptr<const PaintFragment> paintCache;
        std::shared_ptr<const PaintFragment> contentFragment;
        std::shared_ptr<const HitFragment> hitCache;
        // 写入日志已保存原值的轮次，同一帧内重复写入不再查表
        std::uint64_t journalEpoch = 0;
    };

    inline void markDirty(LayoutNode& node, DirtyFlag flag) noexcept {
        node.dirty |= dirtyMask(flag);
    }
}
