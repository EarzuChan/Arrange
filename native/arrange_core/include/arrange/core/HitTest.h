#pragma once

#include "Geometry.h"
#include "LayoutTree.h"
#include "Modifier.h"

#include <optional>
#include <vector>

namespace arrange::core {
    struct HitTestResult {
        bool hit = false;
        NodeId node = 0;
        bool clickable = false;
        EventSlotId eventSlot;
        ModifierHandle modifier;
        std::uint64_t generation = 0;
        // 输入受体类型；空表示仅为节点或文本框命中
        std::optional<InputModifierKind> input;
        // 受体本地坐标，只在命中链结果中填写
        Point local;
        Rect bounds;
    };

    struct HitConstraint {
        ModifierInstance geometry;
        std::size_t parent = 0;
    };

    struct HitRegion {
        Rect bounds;
        HitTestResult target;
        std::size_t constraint = 0;
    };

    struct HitGeometry {
        // constraint 0 是根哨兵，其他索引指向 constraints[index - 1]
        std::vector<HitConstraint> constraints;
        std::vector<HitRegion> regions;
    };

    struct HitFragment {
        std::shared_ptr<const HitGeometry> local;
        std::size_t contentConstraint = 0;
        bool enabled = true;
        std::vector<std::shared_ptr<const HitFragment>> children;
    };

    struct HitTestSnapshot {
        std::shared_ptr<const HitFragment> root;
        std::vector<HitConstraint> constraints;
        std::vector<HitRegion> regions;
    };

    struct HitWorkCounters {
        std::uint64_t nodesBuilt = 0;
        std::uint64_t subtreeCacheHits = 0;
        std::uint64_t emittedRegions = 0;
        std::uint64_t geometryReuses = 0;
    };

    std::vector<HitRegion> exportHitRegions(const HitTestSnapshot& snapshot);

    HitTestSnapshot buildCachedHitTestSnapshot(LayoutTree& tree, NodeId root, HitWorkCounters& counters);
    HitTestSnapshot buildHitTestSnapshot(const LayoutTree& tree, NodeId root);

    class HitTester {
       public:
        HitTestResult hitTest(const HitTestSnapshot& snapshot, Point point) const;
        HitTestResult hitTestClickable(const HitTestSnapshot& snapshot, Point point) const;
        HitTestResult hitTest(const LayoutTree& tree, NodeId root, Point point) const;
        HitTestResult hitTestClickable(const LayoutTree& tree, NodeId root, Point point) const;
        // 指针下的全部输入受体，由内向外；遇到含受体的子树后不再查看其下层兄弟
        std::vector<HitTestResult> hitChain(const HitTestSnapshot& snapshot, Point point) const;
    };
}
