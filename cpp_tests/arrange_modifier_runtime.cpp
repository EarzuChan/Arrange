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
        tree.apply({CreateNodeMutation{1, NodeType::Box}, SetModifierMutation{1, chain}});
        LayoutEngine layout;
        layout.layout(tree, 1, {0, 500, 0, 500});
        const auto& node = tree.node(1);
        check(node.bounds == Rect{0, 0, 100, 80}, "graphicsLayer changed layout bounds");
        check(node.modifier.elements()[5].bounds == Rect{10, 10, 80, 60}, "inner background lost layer geometry");
        auto ops = DrawOpsBuilder().collect(tree, 1);
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
        tree.apply({CreateNodeMutation{1, NodeType::Box}, SetModifierMutation{1, chain}});
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
        tree.apply({CreateNodeMutation{1, NodeType::Box}, SetModifierMutation{1, wrappers}});
        layout.layout(tree, 1, {0, 500, 0, 500});
        check(tree.node(1).modifier.elements()[6].bounds == Rect{15, 15, 90, 70}, "repeated padding did not compose by layer");
        const auto ops = DrawOpsBuilder{}.collect(tree, 1);
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

    void verifyPhaseSeparation() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        ModifierDescriptors chain{{size(100, 60), {}}, {OffsetModifier{}, {}}, {background(1), {}}};
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Box}, SetModifierMutation{1, chain}};
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
        check(frame.content.drawOps[0].rect.x == 25, "placement-only frame used stale coordinates");
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
        std::cout << "Modifier runtime: identity, geometry, painting, hit and phase checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
