#include "TextFixtures.h"
#include <arrange/core/HitTest.h>
#include <arrange/core/Layout.h>
#include <arrange/core/ModifierGeometry.h>
#include <arrange/core/Paint.h>
#include <arrange/core/PointerInputProcessor.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/core/Scroll.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }
    bool near(float a, float b) { return std::fabs(a - b) < 0.001f; }
    LayoutModifierSemantics size(float width, float height) {
        LayoutModifierSemantics value;
        value.kind = LayoutModifierKind::Size;
        value.width = width;
        value.height = height;
        return value;
    }
    PaintStyleSemantics background(std::uint32_t color) {
        PaintStyleSemantics value;
        value.color = color;
        return value;
    }
    InputModifierSemantics click(const char* path) {
        InputModifierSemantics value;
        value.eventSlot = makeEventSlotId(1, EventSlotKind::Click, path);
        return value;
    }
    template<class F> void rejects(F function, const char* message) {
        bool rejected = false;
        try { function(); } catch (const std::invalid_argument&) { rejected = true; }
        check(rejected, message);
    }

    void verifyIdentity() {
        ModifierChain chain;
        ModifierDescriptors descriptors{{background(0xff112233), "outer"}, {OffsetModifier{2, 3}, {}}, {background(0xff445566), "inner"}};
        chain.reconcile(descriptors);
        const auto outer = chain.elements()[0].handle;
        const auto inner = chain.elements()[2].handle;
        auto changed = descriptors;
        std::swap(changed[0], changed[2]);
        chain.reconcile(changed);
        check(chain.elements()[0].handle == inner && chain.elements()[2].handle == outer, "keyed Modifier move lost identity");
        const auto mask = chain.update(inner, background(0xffabcdef));
        check(mask == dirtyMask(DirtyFlag::Paint), "background invalidated geometry");
        check(chain.update(inner, background(0xffabcdef)) == 0, "equal value invalidated frame");
        const auto retired = chain.reconcile({{background(0xffabcdef), "inner"}});
        check(std::find(retired.retired.begin(), retired.retired.end(), outer) != retired.retired.end(), "retirement did not report removed instance");
        rejects([&] { chain.update(outer, background(1)); }, "retired handle accepted");
        rejects([&] { chain.update({inner.identity, inner.generation + 1}, background(1)); }, "wrong generation accepted");
        rejects([&] { chain.update(inner, OffsetModifier{}); }, "slot changed Modifier kind");
        rejects([&] { chain.reconcile({{background(1), "same"}, {background(2), "same"}}); }, "duplicate key accepted");
        check(chain.elements().size() == 1 && chain.elements()[0].handle == inner, "invalid reconciliation partially mutated chain");
        ModifierChain replacement;
        replacement.reconcile({{background(2), "inner"}});
        check(replacement.elements()[0].handle != inner, "new chain reused retired identity");
    }

    void verifyOnionGeometry() {
        LayoutTree tree;
        LayoutModifierSemantics padding;
        padding.padding = {10, 10, 10, 10};
        TransformModifierSemantics layer;
        layer.translationX = 50;
        ModifierDescriptors chain{{size(100, 80), {}}, {background(0xffff0000), {}}, {click("outer"), {}}, {padding, {}}, {layer, {}}, {background(0xff0000ff), {}}, {click("inner"), {}}};
        tree.apply({CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, SetModifierMutation{1, chain}});
        LayoutEngine layout;
        layout.layout(tree, 1, {0, 500, 0, 500});
        const auto& node = tree.node(1);
        check(node.bounds == Rect{0, 0, 100, 80}, "graphicsLayer changed layout bounds");
        check(node.modifier.elements()[5].bounds == Rect{10, 10, 80, 60}, "inner background lost layer geometry");
        auto ops = DrawOpsBuilder().exportScene(tree, 1);
        check(ops.size() == 4 && ops[0].rect == Rect{0, 0, 100, 80}, "outer background was transformed or inset");
        check(ops[1].type == DrawOpType::PushTransform && ops[1].translationX == 50 && ops[2].rect == Rect{10, 10, 80, 60} && ops[3].type == DrawOpType::PopTransform, "paint lost ordered layer wrapper");
        auto hit = HitTester().hitTestClickable(tree, 1, {65, 15});
        check(hit.eventSlot.path == "inner", "inner transformed clickable failed");
        check(HitTester().hitTestClickable(tree, 1, {5, 5}).eventSlot.path == "outer", "padding removed outer clickable area");
        PointerInputProcessor pointer;
        pointer.pointerDown(tree, 1, {65, 15});
        chain.back() = {click("replacement"), "new"};
        tree.apply({SetModifierMutation{1, chain}});
        layout.layout(tree, 1, {0, 500, 0, 500});
        check(!pointer.pointerUp(tree, 1, {65, 15}).clickTriggered, "pointer-up clicked replacement instance");
    }

    void verifyClipRequiredAndOffset() {
        LayoutTree tree;
        LayoutModifierSemantics required = size(120, 80);
        required.kind = LayoutModifierKind::RequiredSize;
        PaintStyleSemantics circle;
        circle.shapeType = "circle";
        ModifierDescriptors chain{{size(60, 60), {}}, {background(0xff111111), {}}, {required, {}}, {background(0xff222222), {}}, {ClipModifier{circle}, {}}, {click("circle"), {}}};
        tree.apply({CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, SetModifierMutation{1, chain}});
        LayoutEngine layout;
        layout.layout(tree, 1, {0, 500, 0, 500});
        check(tree.node(1).bounds == Rect{0, 0, 60, 60}, "required size did not report constrained size to parent");
        check(tree.node(1).modifier.elements()[3].bounds == Rect{-30, -10, 120, 80}, "required size lost overflowing inner geometry");
        check(!HitTester().hitTestClickable(tree, 1, {-29, -9}).hit, "ellipse clip hit corner outside shape");
        check(HitTester().hitTestClickable(tree, 1, {30, 30}).hit, "ellipse clip rejected center");
        chain = {{size(60, 60), {}}, {background(1), {}}, {OffsetModifier{15, 25}, {}}, {background(2), {}}, {click("offset"), {}}};
        tree.apply({SetModifierMutation{1, chain}});
        layout.layout(tree, 1, {0, 500, 0, 500});
        check(tree.node(1).modifier.elements()[1].bounds.x == 0 && tree.node(1).modifier.elements()[3].bounds.x == 15, "offset moved layers outside its scope");
        check(!HitTester().hitTestClickable(tree, 1, {1, 1}).hit && HitTester().hitTestClickable(tree, 1, {16, 26}).hit, "offset hit geometry differs from painting");
    }

    void verifyRepeatedWrappersAndScroll() {
        LayoutTree tree;
        LayoutEngine layout;
        LayoutModifierSemantics outerPadding, innerPadding;
        outerPadding.padding = {10, 10, 10, 10};
        innerPadding.padding = {5, 5, 5, 5};
        TransformModifierSemantics outerLayer, innerLayer;
        outerLayer.translationX = 30;
        innerLayer.translationY = 20;
        innerLayer.scaleX = 2;
        innerLayer.transformOriginX = 0;
        innerLayer.transformOriginY = 0;
        PaintStyleSemantics circle;
        circle.shapeType = "circle";
        ModifierDescriptors wrappers{
            {size(120, 100), {}}, {background(1), {}}, {outerPadding, {}},
            {ClipModifier{}, {}}, {outerLayer, {}}, {innerPadding, {}},
            {background(2), {}}, {ClipModifier{circle}, {}}, {innerLayer, {}},
            {click("deep"), {}},
        };
        tree.apply({CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, SetModifierMutation{1, wrappers}});
        layout.layout(tree, 1, {0, 500, 0, 500});
        check(tree.node(1).modifier.elements()[6].bounds == Rect{15, 15, 90, 70}, "repeated padding did not compose by layer");
        const auto ops = DrawOpsBuilder{}.exportScene(tree, 1);
        check(std::count_if(ops.begin(), ops.end(), [](const auto& op) { return op.type == DrawOpType::PushClip; }) == 2 &&
              std::count_if(ops.begin(), ops.end(), [](const auto& op) { return op.type == DrawOpType::PushTransform; }) == 2,
              "repeated clips or graphics layers collapsed");
        const auto snapshot = buildHitTestSnapshot(tree, 1);
        check(HitTester{}.hitTestClickable(snapshot, {55, 40}).eventSlot.path == "deep", "nested transform inverse mapping failed");
        check(!HitTester{}.hitTestClickable(snapshot, {40, 10}).hit, "nested clip failed to reject an outside point");

        LayoutModifierSemantics outerScroll, innerScroll;
        outerScroll.kind = innerScroll.kind = LayoutModifierKind::VerticalScroll;
        outerScroll.eventSlot = makeEventSlotId(1, EventSlotKind::VerticalScroll, "outer");
        innerScroll.eventSlot = makeEventSlotId(1, EventSlotKind::VerticalScroll, "inner");
        ModifierDescriptors scrolling{
            {size(100, 100), "viewport"}, {outerScroll, "outer"},
            {size(100, 200), "inner-viewport"}, {innerScroll, "inner"},
            {size(100, 400), "content"}, {background(3), {}}, {click("content"), {}},
        };
        tree.apply({SetModifierMutation{1, scrolling}});
        layout.layout(tree, 1, {0, 500, 0, 500});
        auto wheel = ScrollDispatcher{}.verticalWheel(tree, 1, {30, 30}, -1, 40);
        check(wheel.consumed && wheel.eventSlot.path == "inner" && near(wheel.value, 40) && near(wheel.maxValue, 200),
              "repeated scroll did not route to the inner instance");
        innerScroll.scrollValue = 200;
        scrolling[3].value = innerScroll;
        tree.apply({SetModifierMutation{1, scrolling}});
        layout.place(tree, 1);
        wheel = ScrollDispatcher{}.verticalWheel(tree, 1, {30, 30}, -1, 40);
        check(wheel.consumed && wheel.eventSlot.path == "outer" && near(wheel.value, 40) && near(wheel.maxValue, 100),
              "inner scroll boundary did not yield to the outer instance");
        outerScroll.scrollValue = 20;
        scrolling[1].value = outerScroll;
        tree.apply({SetModifierMutation{1, scrolling}});
        layout.place(tree, 1);
        check(near(tree.node(1).modifier.elements()[5].bounds.y, -220), "nested scrolling offsets did not compose");
        check(!HitTester{}.hitTestClickable(tree, 1, {30, 101}).hit, "outer scroll viewport did not clip inner interaction");
    }

    void verifyLocalCaches() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Column")}})}};
        for (NodeId id = 2; id < 52; ++id) {
            initial.operations.push_back(CreateNodeMutation{id, arrange::core::NodeType::Layout});
        initial.operations.push_back(arrange::core::SetPropMutation{id, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})});
            initial.operations.push_back(SetModifierMutation{id, {{size(100, 20), {}}, {OffsetModifier{}, {}}, {background(0xff123456), {}}, {click("row"), {}}}});
            initial.operations.push_back(InsertChildMutation{1, id, id - 2});
        }
        auto run = [&](MutationTransaction* transaction) {
            const auto result = pipeline.run(scene, 1, {0, 500, 0, 5000}, transaction, true, frame);
            check(!result.error, "cached frame failed");
            const auto reference = buildHitTestSnapshot(scene.tree(), 1);
            for (float y = 0; y < 1100; y += 11) {
                const auto expected = HitTester{}.hitTestClickable(reference, {10, y});
                const auto actual = HitTester{}.hitTestClickable(*frame.content.hitTest, {10, y});
                check(expected.hit == actual.hit && expected.node == actual.node && expected.modifier == actual.modifier && expected.eventSlot == actual.eventSlot, "cached hit list differs from uncached hierarchy");
            }
        };
        run(&initial);
        const auto untouched = scene.node(40).paintCache;
        auto before = pipeline.counters();
        MutationTransaction color;
        color.operations = {SetModifierMutation{2, {{size(100, 20), {}}, {OffsetModifier{}, {}}, {background(0xffabcdef), {}}, {click("row"), {}}}}};
        run(&color);
        auto after = pipeline.counters();
        check(after.layoutWork.measuredNodes == before.layoutWork.measuredNodes && after.layoutWork.placedNodes == before.layoutWork.placedNodes, "local color ran layout");
        check(after.paintWork.nodesBuilt - before.paintWork.nodesBuilt == 2 && after.paintWork.layersBuilt - before.paintWork.layersBuilt == 1, "color rebuilt unrelated nodes or Modifier layers");
        check(scene.node(40).paintCache == untouched, "unrelated immutable paint fragment was copied");
        before = after;
        MutationTransaction offset;
        offset.operations = {SetModifierMutation{2, {{size(100, 20), {}}, {OffsetModifier{8, 4}, {}}, {background(0xffabcdef), {}}, {click("row"), {}}}}};
        run(&offset);
        after = pipeline.counters();
        check(after.layoutWork.measuredNodes == before.layoutWork.measuredNodes && after.layoutWork.placedNodes - before.layoutWork.placedNodes == 2, "offset did not isolate placement path");
        check(after.hitWork.nodesBuilt - before.hitWork.nodesBuilt == 2, "offset rebuilt unrelated hit fragments");
        before = after;
        MutationTransaction resize;
        resize.operations = {SetModifierMutation{2, {{size(120, 20), {}}, {OffsetModifier{8, 4}, {}}, {background(0xffabcdef), {}}, {click("row"), {}}}}};
        run(&resize);
        after = pipeline.counters();
        check(after.layoutWork.measuredNodes - before.layoutWork.measuredNodes == 2, "size change measured unrelated siblings");
        check(after.layoutWork.measureCacheHits - before.layoutWork.measureCacheHits == 49, "sibling measure cache was not reused");
        check(after.layoutWork.placedNodes - before.layoutWork.placedNodes == 2, "unchanged sibling positions were recomputed");
        const auto published = frame.revision;
        run(&resize);
        check(frame.revision == published, "equal typed values produced an unnecessary publication");

        TransformModifierSemantics transform;
        transform.translationX = 20;
        MutationTransaction wrap;
        wrap.operations = {SetModifierMutation{1, {{ClipModifier{}, {}}, {transform, {}}}}};
        run(&wrap);
        before = pipeline.counters();
        transform.rotationZ = 12;
        wrap.operations = {SetModifierMutation{1, {{ClipModifier{}, {}}, {transform, {}}}}};
        run(&wrap);
        after = pipeline.counters();
        check(after.layoutWork.measuredNodes == before.layoutWork.measuredNodes && after.hitWork.nodesBuilt - before.hitWork.nodesBuilt == 1, "ancestor transform failed to retain local child hit data");
        before = after;
        transform.alpha = 0.5f;
        wrap.operations = {SetModifierMutation{1, {{ClipModifier{}, {}}, {transform, {}}}}};
        run(&wrap);
        check(pipeline.counters().hitBuilds == before.hitBuilds, "graphicsLayer alpha rebuilt hit data");
        std::cout << "Local cache evidence: color=2 nodes/1 layer, offset=2 placed, resize=2 measured/49 cache hits\n";
    }

    void verifyConstraintAndBaselineDependencies() {
        LayoutTree tree;
        LayoutEngine layout;
        ParentDataModifierSemantics weight;
        weight.weight = 1;
        tree.apply({CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Row")}})}, CreateNodeMutation{2, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, CreateNodeMutation{3, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{3, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})},
            SetModifierMutation{1, {{size(240, 40), {}}}}, SetModifierMutation{2, {{weight, {}}}}, SetModifierMutation{3, {{weight, {}}}},
            InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}});
        layout.layout(tree, 1, {0, 500, 0, 500}); tree.clearDirty();
        check(near(tree.node(2).bounds.width, 120), "initial weighted constraint failed");
        weight.weight = 2;
        tree.setModifierChain(2, {{weight, {}}});
        layout.layout(tree, 1, {0, 500, 0, 500}); tree.clearDirty();
        check(near(tree.node(2).bounds.width, 160) && near(tree.node(3).bounds.width, 80), "parent data did not invalidate sibling constraints");
        layout.resetCounters();
        layout.layout(tree, 1, {0, 600, 0, 500}); tree.clearDirty();
        check(layout.counters().measuredNodes == 1 && layout.counters().measureCacheHits == 2, "unchanged descendant constraints missed resize cache");
        LayoutModifierSemantics padding;
        padding.padding.top = 7;
        tree.apply({CreateNodeMutation{4, arrange::core::NodeType::Layout}, SetPropMutation{4, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, CreateNodeMutation{5, arrange::core::NodeType::Layout}, SetPropMutation{5, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, RemoveChildMutation{1, 2}, RemoveChildMutation{1, 3},
            SetModifierMutation{1, {}}, SetPropMutation{1, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Row")}, {"verticalAlignment", PropValue::stringValue("Baseline")}})},
            SetModifierMutation{4, {{padding, {}}, {test_support::text("小字"), {}}}}, SetModifierMutation{5, {{test_support::text("大字", 0xff000000u, 30, 36), {}}}},
            InsertChildMutation{1, 4, 0}, InsertChildMutation{1, 5, 1}});
        layout.layout(tree, 1, {0, 600, 0, 500}); tree.clearDirty();
        check(near(tree.node(4).bounds.y + tree.node(4).baseline, tree.node(5).bounds.y + tree.node(5).baseline), "row baselines ignored Modifier padding");
        const auto previousBaseline = tree.node(1).baseline;
        tree.setModifierChain(5, {{test_support::text("大字", 0xff000000u, 40, 48), {}}});
        layout.resetCounters(); layout.layout(tree, 1, {0, 600, 0, 500});
        check(tree.node(1).baseline > previousBaseline && layout.counters().measureCacheHits == 1, "baseline input failed to propagate while retaining sibling measurement");
        check(near(tree.node(4).bounds.y + tree.node(4).baseline, tree.node(5).bounds.y + tree.node(5).baseline), "baseline update left stale sibling placement");
    }

    void verifyContentSizeAnimation() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        AnimateContentSizeModifier animated;
        animated.animationSpec.kind = AnimationKind::Tween;
        animated.animationSpec.durationMillis = 100;
        animated.animationSpec.bezier = {0, 0, 1, 1};
        MutationTransaction initial;
        initial.operations = {
            CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Column")}})}, CreateNodeMutation{2, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, CreateNodeMutation{3, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{3, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, CreateNodeMutation{4, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{4, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})},
            SetModifierMutation{2, {{animated, "animation"}}}, SetModifierMutation{3, {{size(100, 20), {}}, {background(0xff123456), {}}, {click("animated"), {}}}},
            SetModifierMutation{4, {{size(100, 20), {}}, {background(0xff654321), {}}}},
            InsertChildMutation{1, 2, 0}, InsertChildMutation{2, 3, 0}, InsertChildMutation{1, 4, 1},
        };
        const auto run = [&](MutationTransaction* transaction, double time, const FrameFinalizer& finalize = {}) {
            return pipeline.run(scene, 1, {0, 500, 0, 500}, transaction, true, frame, finalize, time);
        };
        check(!run(&initial, 0).error && near(scene.node(2).bounds.height, 20), "content size animated its first measurement");
        MutationTransaction target;
        target.operations = {SetModifierMutation{3, {{size(100, 100), {}}, {background(0xff123456), {}}, {click("animated"), {}}}}};
        check(!run(&target, 100).error && near(scene.node(2).bounds.height, 20), "content size jumped to target");
        check(scene.tree().activeAnimationCount() == 1, "native animation was not retained by instance");
        const auto before = pipeline.counters();
        check(!run(nullptr, 150).error && near(scene.node(2).bounds.height, 60), "content size did not sample VBlank timestamp");
        check(near(scene.node(4).bounds.y, 60), "animated size did not affect sibling placement");
        check(pipeline.counters().layoutWork.measuredNodes - before.layoutWork.measuredNodes == 2, "content animation remeasured its stable child or sibling");
        check(!HitTester{}.hitTestClickable(*frame.content.hitTest, {5, 80}).hit && HitTester{}.hitTestClickable(*frame.content.hitTest, {5, 40}).hit, "content animation hit clip disagreed with intermediate size");
        const auto revision = frame.revision;
        const auto fail = run(nullptr, 175, [](const auto&, auto&) { throw std::runtime_error("test finalizer failure"); });
        check(fail.error.has_value() && frame.revision == revision && near(scene.node(2).bounds.height, 60), "failed animation candidate changed published geometry");
        target.operations = {SetModifierMutation{3, {{size(100, 40), {}}, {background(0xff123456), {}}, {click("animated"), {}}}}};
        check(!run(&target, 180).error && near(scene.node(2).bounds.height, 60), "retarget did not preserve presented size");
        check(!run(nullptr, 280).error && near(scene.node(2).bounds.height, 40) && scene.tree().activeAnimationCount() == 0, "content animation did not settle and release clock demand");
        target.operations = {SetModifierMutation{3, {{size(100, 200), {}}, {background(0xff123456), {}}, {click("animated"), {}}}}};
        (void)run(&target, 300);
        MutationTransaction remove;
        remove.operations = {DeleteNodeMutation{2}};
        check(!run(&remove, 320).error && scene.tree().activeAnimationCount() == 0, "retired size modifier retained native animation");
    }

    void verifyPhaseSeparation() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        ModifierDescriptors chain{{size(100, 60), {}}, {OffsetModifier{}, {}}, {background(1), {}}};
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, SetModifierMutation{1, chain}};
        (void)pipeline.run(scene, 1, {0, 500, 0, 500}, &initial, true, frame);
        chain.back().value = background(2);
        MutationTransaction color;
        color.operations = {SetModifierMutation{1, chain}};
        const auto painted = pipeline.run(scene, 1, {0, 500, 0, 500}, &color, true, frame);
        check(!painted.plan.measure && !painted.plan.layout && painted.plan.buildPaint && !painted.plan.buildHitTest, "color reran geometry phases");
        chain[1].value = OffsetModifier{25, 0};
        MutationTransaction offset;
        offset.operations = {SetModifierMutation{1, chain}};
        const auto placed = pipeline.run(scene, 1, {0, 500, 0, 500}, &offset, true, frame);
        check(!placed.plan.measure && placed.plan.layout && placed.plan.buildPaint && placed.plan.buildHitTest, "offset failed to reuse measurement");
        check(exportDrawOps(frame.content.scenePaint)[0].rect.x == 25, "placement-only frame used stale coordinates");
        chain[0].value = size(130, 60);
        MutationTransaction resized;
        resized.operations = {SetModifierMutation{1, chain}};
        check(pipeline.run(scene, 1, {0, 500, 0, 500}, &resized, true, frame).plan.measure, "size update skipped measure");
    }
}

int main() {
    try {
        verifyIdentity();
        verifyOnionGeometry();
        verifyClipRequiredAndOffset();
        verifyRepeatedWrappersAndScroll();
        verifyPhaseSeparation();
        verifyLocalCaches();
        verifyContentSizeAnimation();
        verifyConstraintAndBaselineDependencies();
        std::cout << "Modifier runtime: identity, geometry, painting, hit and phase checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
