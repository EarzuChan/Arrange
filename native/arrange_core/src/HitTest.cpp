#include <arrange/core/HitTest.h>
#include <arrange/core/ModifierGeometry.h>

#include <algorithm>
#include <functional>

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
                if (scroll || std::holds_alternative<TransformModifierSemantics>(value) || std::holds_alternative<ClipModifier>(value) || std::holds_alternative<AnimateContentSizeModifier>(value)) {
                    snapshot.constraints.push_back({instance, constraint});
                    constraint = snapshot.constraints.size();
                }
                if (const auto* field = std::get_if<TextFieldModifier>(&value); field && field->enabled) snapshot.regions.push_back({instance.bounds, {true, id, false, {}, instance.handle}, constraint});
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

    HitTestSnapshot buildCachedHitTestSnapshot(LayoutTree& tree, NodeId root, HitWorkCounters& counters) {
        HitTestSnapshot result;
        if (!tree.contains(root)) return result;
        std::function<std::shared_ptr<const HitFragment>(NodeId)> build = [&](NodeId id) -> std::shared_ptr<const HitFragment> {
            auto& node = tree.node(id);
            const auto enabled = nodeInteractionEnabled(tree, id);
            constexpr auto mask = dirtyMask(DirtyFlag::Structure) | dirtyMask(DirtyFlag::Layout) |
                dirtyMask(DirtyFlag::Placement) | dirtyMask(DirtyFlag::HitTest) | dirtyMask(DirtyFlag::Transform);
            if (node.hitCache && node.hitCache->enabled == enabled && !(node.dirty & mask)) {
                ++counters.subtreeCacheHits;
                return node.hitCache;
            }
            ++counters.nodesBuilt;
            auto fragment = std::make_shared<HitFragment>();
            fragment->enabled = enabled;
            if (enabled) {
                auto& local = fragment->local;
                std::size_t constraint = 0;
                local.regions.push_back({node.contentBounds, {true, id, false, {}, {}}, 0});
                for (const auto& instance : node.modifier.elements()) {
                    const auto& value = instance.descriptor.value;
                    const auto* layout = std::get_if<LayoutModifierSemantics>(&value);
                    const auto scroll = layout && (layout->kind == LayoutModifierKind::VerticalScroll || layout->kind == LayoutModifierKind::HorizontalScroll);
                    if (scroll || std::holds_alternative<TransformModifierSemantics>(value) || std::holds_alternative<ClipModifier>(value) || std::holds_alternative<AnimateContentSizeModifier>(value)) {
                        auto geometry = instance;
                        geometry.paintCache.reset();
                        local.constraints.push_back({std::move(geometry), constraint});
                        constraint = local.constraints.size();
                    }
                    if (const auto* field = std::get_if<TextFieldModifier>(&value); field && field->enabled) local.regions.push_back({instance.bounds, {true, id, false, {}, instance.handle}, constraint});
                    if (const auto* input = std::get_if<InputModifierSemantics>(&value); input && input->kind == InputModifierKind::Clickable && input->enabled)
                        local.regions.push_back({instance.bounds, {true, id, true, input->eventSlot, instance.handle}, constraint});
                }
                local.regions[0].constraint = fragment->contentConstraint = constraint;
                auto children = node.children;
                std::stable_sort(children.begin(), children.end(), [&](NodeId a, NodeId b) { return tree.node(a).modifier.zIndex() < tree.node(b).modifier.zIndex(); });
                for (auto child : children) fragment->children.push_back(build(child));
            }
            return node.hitCache = fragment;
        };
        const auto fragment = build(root);
        std::function<void(const HitFragment&, std::size_t)> flatten = [&](const HitFragment& part, std::size_t parent) {
            const auto base = result.constraints.size();
            const auto remap = [&](std::size_t local) { return local ? base + local : parent; };
            for (auto constraint : part.local.constraints) {
                constraint.parent = remap(constraint.parent);
                result.constraints.push_back(std::move(constraint));
            }
            for (auto region : part.local.regions) {
                region.constraint = remap(region.constraint);
                result.regions.push_back(std::move(region));
            }
            for (const auto& child : part.children) flatten(*child, remap(part.contentConstraint));
        };
        flatten(*fragment, 0);
        counters.emittedRegions += result.regions.size();
        return result;
    }

    HitTestSnapshot buildHitTestSnapshot(const LayoutTree& tree, NodeId root) {
        HitTestSnapshot snapshot;
        if (tree.contains(root)) collect(tree, root, 0, snapshot);
        return snapshot;
    }

    HitTestResult HitTester::hitTest(const HitTestSnapshot& snapshot, Point point) const { return hit(snapshot, point, false); }
    HitTestResult HitTester::hitTestClickable(const HitTestSnapshot& snapshot, Point point) const { return hit(snapshot, point, true); }
    HitTestResult HitTester::hitTest(const LayoutTree& tree, NodeId root, Point point) const { return hitTest(buildHitTestSnapshot(tree, root), point); }
    HitTestResult HitTester::hitTestClickable(const LayoutTree& tree, NodeId root, Point point) const { return hitTestClickable(buildHitTestSnapshot(tree, root), point); }
} // namespace arrange::core
