#include <arrange/core/HitTest.h>
#include <arrange/core/ModifierGeometry.h>

#include <algorithm>
#include <functional>

namespace arrange::core {
    namespace {
        // 文本框之外的输入受体区域；clickable 之外的类型不参与旧的单点命中
        void pushInputRegion(std::vector<HitRegion>& regions, const ModifierInstance& instance, const ModifierValue& value, NodeId id, std::uint64_t generation, std::size_t constraint) {
            const auto* input = std::get_if<InputModifierSemantics>(&value);
            if (!input || !input->enabled || input->kind == InputModifierKind::Focusable || input->kind == InputModifierKind::KeyEvent) return;
            const auto clickable = input->kind == InputModifierKind::Clickable;
            regions.push_back({instance.bounds, {true, id, clickable, input->eventSlot, instance.handle, generation, input->kind}, constraint});
        }

        void collect(const LayoutTree& tree, NodeId id, std::size_t constraint, HitGeometry& snapshot) {
            if (!nodeInteractionEnabled(tree, id)) return;
            const auto& node = tree.node(id);
            const auto generic = snapshot.regions.size();
            snapshot.regions.push_back({node.contentBounds, {true, id, false, {}, {}, node.generation}, constraint});
            for (const auto& instance : node.modifier.elements()) {
                const auto& value = instance.descriptor.value;
                const auto* layout = std::get_if<LayoutModifierSemantics>(&value);
                const auto scroll = layout && (layout->kind == LayoutModifierKind::VerticalScroll || layout->kind == LayoutModifierKind::HorizontalScroll);
                if (scroll || std::holds_alternative<TransformModifierSemantics>(value) || std::holds_alternative<ClipModifier>(value) || std::holds_alternative<AnimateContentSizeModifier>(value)) {
                    snapshot.constraints.push_back({instance, constraint});
                    constraint = snapshot.constraints.size();
                }
                if (const auto* field = std::get_if<TextFieldModifier>(&value); field && field->enabled) snapshot.regions.push_back({instance.bounds, {true, id, false, {}, instance.handle, node.generation}, constraint});
                pushInputRegion(snapshot.regions, instance, value, id, node.generation, constraint);
            }
            snapshot.regions[generic].constraint = constraint;
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId a, NodeId b) { return tree.node(a).modifier.zIndex() < tree.node(b).modifier.zIndex(); });
            for (auto child : children) collect(tree, child, constraint, snapshot);
        }

        bool enter(const HitGeometry& geometry, std::size_t constraint, Point& point) {
            std::vector<std::size_t> path;
            for (; constraint != 0; constraint = geometry.constraints[constraint - 1].parent) path.push_back(constraint);
            for (auto it = path.rbegin(); it != path.rend(); ++it)
                if (!enterModifier(geometry.constraints[*it - 1].geometry, point)) return false;
            return true;
        }

        HitTestResult hit(const HitFragment& fragment, Point point, bool clickableOnly) {
            if (!fragment.enabled || !fragment.local) return {};
            const auto& geometry = *fragment.local;
            auto contentPoint = point;
            if (enter(geometry, fragment.contentConstraint, contentPoint)) {
                for (auto child = fragment.children.rbegin(); child != fragment.children.rend(); ++child) {
                    const auto result = hit(**child, contentPoint, clickableOnly);
                    if (result.hit) return result;
                }
            }
            for (auto region = geometry.regions.rbegin(); region != geometry.regions.rend(); ++region) {
                if (clickableOnly && !region->target.clickable || region->target.input && !region->target.clickable) continue;
                auto local = point;
                if (enter(geometry, region->constraint, local) && containsRect(region->bounds, local)) return region->target;
            }
            return {};
        }

        bool chain(const HitFragment& fragment, Point point, std::vector<HitTestResult>& out) {
            if (!fragment.enabled || !fragment.local) return false;
            const auto& geometry = *fragment.local;
            auto any = false;
            auto contentPoint = point;
            if (enter(geometry, fragment.contentConstraint, contentPoint)) {
                for (auto child = fragment.children.rbegin(); child != fragment.children.rend(); ++child)
                    if (chain(**child, contentPoint, out)) {
                        any = true;
                        break;
                    }
            }
            for (auto region = geometry.regions.rbegin(); region != geometry.regions.rend(); ++region) {
                if (!region->target.input) continue;
                auto local = point;
                if (!enter(geometry, region->constraint, local) || !containsRect(region->bounds, local)) continue;
                auto result = region->target;
                result.local = {local.x - region->bounds.x, local.y - region->bounds.y};
                result.bounds = region->bounds;
                out.push_back(result);
                any = true;
            }
            return any;
        }
    }

    HitTestSnapshot buildCachedHitTestSnapshot(LayoutTree& tree, NodeId root, HitWorkCounters& counters) {
        HitTestSnapshot result;
        if (!tree.contains(root)) return result;
        std::function<std::shared_ptr<const HitFragment>(NodeId)> build = [&](NodeId id) -> std::shared_ptr<const HitFragment> {
            auto& node = tree.node(id);
            const auto input = node.props.find("enabled");
            const auto enabled = input == node.props.end() || input->second.boolOr(true);
            constexpr auto mask = dirtyMask(DirtyFlag::Structure) | dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Placement) | dirtyMask(DirtyFlag::HitTest) | dirtyMask(DirtyFlag::Transform);
            if (node.hitCache && node.hitCache->enabled == enabled && !((node.dirty | node.subtreeDirty) & mask)) {
                ++counters.subtreeCacheHits;
                return node.hitCache;
            }
            ++counters.nodesBuilt;
            auto fragment = std::make_shared<HitFragment>();
            fragment->enabled = enabled;
            if (enabled) {
                if (node.hitCache && node.hitCache->enabled && !(node.dirty & mask)) {
                    fragment->local = node.hitCache->local;
                    fragment->contentConstraint = node.hitCache->contentConstraint;
                    ++counters.geometryReuses;
                } else {
                    auto geometry = std::make_shared<HitGeometry>();
                    auto& local = *geometry;
                    std::size_t constraint = 0;
                    local.regions.push_back({node.contentBounds, {true, id, false, {}, {}, node.generation}, 0});
                    for (const auto& instance : node.modifier.elements()) {
                        const auto& value = instance.descriptor.value;
                        const auto* layout = std::get_if<LayoutModifierSemantics>(&value);
                        const auto scroll = layout && (layout->kind == LayoutModifierKind::VerticalScroll || layout->kind == LayoutModifierKind::HorizontalScroll);
                        if (scroll || std::holds_alternative<TransformModifierSemantics>(value) || std::holds_alternative<ClipModifier>(value) || std::holds_alternative<AnimateContentSizeModifier>(value)) {
                            auto geometry = instance;
                            geometry.paintCache.reset();
                            geometry.fragmentCache.reset();
                            local.constraints.push_back({std::move(geometry), constraint});
                            constraint = local.constraints.size();
                        }
                        if (const auto* field = std::get_if<TextFieldModifier>(&value); field && field->enabled) local.regions.push_back({instance.bounds, {true, id, false, {}, instance.handle, node.generation}, constraint});
                        pushInputRegion(local.regions, instance, value, id, node.generation, constraint);
                    }
                    local.regions[0].constraint = fragment->contentConstraint = constraint;
                    counters.emittedRegions += local.regions.size();
                    fragment->local = std::move(geometry);
                }
                auto children = node.children;
                std::stable_sort(children.begin(), children.end(), [&](NodeId a, NodeId b) { return tree.node(a).modifier.zIndex() < tree.node(b).modifier.zIndex(); });
                for (auto child : children) fragment->children.push_back(build(child));
            }
            return node.hitCache = fragment;
        };
        result.root = build(root);
        std::function<void(const HitFragment&)> flatten = [&](const HitFragment& fragment) {
            if (fragment.local) {
                result.constraints.insert(result.constraints.end(), fragment.local->constraints.begin(), fragment.local->constraints.end());
                result.regions.insert(result.regions.end(), fragment.local->regions.begin(), fragment.local->regions.end());
            }
            for (const auto& child : fragment.children) flatten(*child);
        };
        if (result.root) flatten(*result.root);
        return result;
    }

    HitTestSnapshot buildHitTestSnapshot(const LayoutTree& tree, NodeId root) {
        auto geometry = std::make_shared<HitGeometry>();
        if (tree.contains(root)) collect(tree, root, 0, *geometry);
        auto fragment = std::make_shared<HitFragment>();
        fragment->local = std::move(geometry);
        HitTestSnapshot snapshot;
        snapshot.root = std::move(fragment);
        snapshot.constraints = snapshot.root->local->constraints;
        snapshot.regions = snapshot.root->local->regions;
        return snapshot;
    }

    std::vector<HitRegion> exportHitRegions(const HitTestSnapshot& snapshot) {
        std::vector<HitRegion> regions;
        std::function<void(const HitFragment&)> visit = [&](const HitFragment& part) {
            if (part.local) regions.insert(regions.end(), part.local->regions.begin(), part.local->regions.end());
            for (const auto& child : part.children) visit(*child);
        };
        if (snapshot.root) visit(*snapshot.root);
        return regions;
    }

    HitTestResult HitTester::hitTest(const HitTestSnapshot& snapshot, Point point) const {
        return snapshot.root ? hit(*snapshot.root, point, false) : HitTestResult{};
    }

    HitTestResult HitTester::hitTestClickable(const HitTestSnapshot& snapshot, Point point) const {
        return snapshot.root ? hit(*snapshot.root, point, true) : HitTestResult{};
    }

    std::vector<HitTestResult> HitTester::hitChain(const HitTestSnapshot& snapshot, Point point) const {
        std::vector<HitTestResult> result;
        if (snapshot.root) (void)chain(*snapshot.root, point, result);
        return result;
    }

    HitTestResult HitTester::hitTest(const LayoutTree& tree, NodeId root, Point point) const {
        return hitTest(buildHitTestSnapshot(tree, root), point);
    }

    HitTestResult HitTester::hitTestClickable(const LayoutTree& tree, NodeId root, Point point) const {
        return hitTestClickable(buildHitTestSnapshot(tree, root), point);
    }
}
