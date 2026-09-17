#include <arrange/core/HitTest.h>
#include <arrange/core/ModifierGeometry.h>

#include <algorithm>

namespace arrange::core {
    namespace {
        void collect(const LayoutTree& tree, NodeId id, std::size_t constraint, HitTestSnapshot& snapshot) {
            if (!nodeInteractionEnabled(tree, id)) return;
            const auto& node = tree.node(id);
            const auto generic = snapshot.regions.size();
            snapshot.regions.push_back({node.contentBounds, {true, id, false, {}, {}}, constraint});
            for (const auto& instance : node.modifier.elements()) {
                const auto& value = instance.descriptor.value;
                const auto* layout = std::get_if<LayoutModifierSemantics>(&value);
                const auto scroll = layout && (layout->kind == LayoutModifierKind::VerticalScroll || layout->kind == LayoutModifierKind::HorizontalScroll);
                if (scroll || std::holds_alternative<TransformModifierSemantics>(value) || std::holds_alternative<ClipModifier>(value)) {
                    snapshot.constraints.push_back({instance, constraint});
                    constraint = snapshot.constraints.size();
                }
                if (const auto* input = std::get_if<InputModifierSemantics>(&value); input && input->kind == InputModifierKind::Clickable && input->enabled) {
                    snapshot.regions.push_back({instance.bounds, {true, id, true, input->eventSlot, instance.handle}, constraint});
                }
            }
            snapshot.regions[generic].constraint = constraint;
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId a, NodeId b) { return tree.node(a).modifier.zIndex() < tree.node(b).modifier.zIndex(); });
            for (auto child : children) collect(tree, child, constraint, snapshot);
        }

        HitTestResult hit(const HitTestSnapshot& snapshot, Point point, bool clickableOnly) {
            std::vector<std::size_t> path;
            for (auto region = snapshot.regions.rbegin(); region != snapshot.regions.rend(); ++region) {
                if (clickableOnly && !region->target.clickable) continue;
                path.clear();
                for (auto constraint = region->constraint; constraint != 0; constraint = snapshot.constraints[constraint - 1].parent) path.push_back(constraint);
                auto local = point;
                bool visible = true;
                for (auto constraint = path.rbegin(); constraint != path.rend(); ++constraint) {
                    if (!enterModifier(snapshot.constraints[*constraint - 1].geometry, local)) { visible = false; break; }
                }
                if (visible && containsRect(region->bounds, local)) return region->target;
            }
            return {};
        }
    } // namespace

    HitTestSnapshot buildHitTestSnapshot(const LayoutTree& tree, NodeId root) {
        HitTestSnapshot snapshot;
        collect(tree, root, 0, snapshot);
        return snapshot;
    }

    HitTestResult HitTester::hitTest(const HitTestSnapshot& snapshot, Point point) const { return hit(snapshot, point, false); }
    HitTestResult HitTester::hitTestClickable(const HitTestSnapshot& snapshot, Point point) const { return hit(snapshot, point, true); }
    HitTestResult HitTester::hitTest(const LayoutTree& tree, NodeId root, Point point) const { return hitTest(buildHitTestSnapshot(tree, root), point); }
    HitTestResult HitTester::hitTestClickable(const LayoutTree& tree, NodeId root, Point point) const { return hitTestClickable(buildHitTestSnapshot(tree, root), point); }
} // namespace arrange::core
