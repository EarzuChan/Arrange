#include <arrange/core/SceneFramePipeline.h>

#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
    BindingHandle binding() { return {allocateRuntimeIdentity(), 1}; }
    PaintStyleSemantics color(std::uint32_t value) { PaintStyleSemantics paint; paint.color = value; return paint; }
    ModifierDescriptors box(std::uint32_t value) {
        LayoutModifierSemantics size;
        size.kind = LayoutModifierKind::Size;
        size.width = 100;
        size.height = 60;
        return {{size, "size"}, {OffsetModifier{}, "offset"}, {color(value), "background"}};
    }

    void verifyBindingsAndFailureBoundary() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        const NodeHandle node{1, allocateRuntimeIdentity()};
        const auto chain = binding();
        MutationTransaction mount;
        mount.operations.emplace_back(CreateNodeMutation{node.id, NodeType::Text, node.generation});
        mount.operations.emplace_back(RegisterBinding{chain, ModifierChainTarget{node}});
        mount.operations.emplace_back(SlotUpdate{chain, box(0xff112233)});
        check(!pipeline.run(scene, 1, {0, 500, 0, 500}, &mount, true, frame).error, "create/register/update in one frame failed");
        check(scene.bindingCount() == 1 && exportDrawOps(frame.content.scenePaint).front().color == 0xff112233, "slot did not reach paint");
        const auto paintHandle = scene.node(1).modifier.elements()[2].handle;
        const auto offsetHandle = scene.node(1).modifier.elements()[1].handle;
        const auto paint = binding(), offset = binding(), style = binding();
        MutationTransaction registerInputs;
        registerInputs.operations.emplace_back(RegisterBinding{paint, ModifierInputTarget{node, paintHandle}});
        registerInputs.operations.emplace_back(RegisterBinding{offset, ModifierInputTarget{node, offsetHandle}});
        registerInputs.operations.emplace_back(RegisterBinding{style, HostInputTarget{node, HostInput::TextStyle}});
        scene.apply(registerInputs);
        MutationTransaction paintUpdate;
        paintUpdate.operations.emplace_back(SlotUpdate{paint, ModifierValue{color(0xffabcdef)}});
        const auto initialHit = frame.content.hitTest;
        const auto initialHitBuilds = pipeline.counters().hitBuilds;
        const auto painted = pipeline.run(scene, 1, {0, 500, 0, 500}, &paintUpdate, true, frame);
        check(!painted.error && painted.plan.buildPaint && !painted.plan.measure && !painted.plan.layout, "typed paint input rebuilt layout");
        check(frame.content.hitTest == initialHit && pipeline.counters().hitBuilds == initialHitBuilds, "paint-only frame rebuilt hit geometry");
        MutationTransaction move;
        move.operations.emplace_back(SlotUpdate{offset, ModifierValue{OffsetModifier{30, 0}}});
        const auto moved = pipeline.run(scene, 1, {0, 500, 0, 500}, &move, true, frame);
        check(!moved.error && moved.plan.layout && !moved.plan.measure && exportDrawOps(frame.content.scenePaint).front().rect.x == 30, "typed placement failed");
        check(frame.content.hitTest != initialHit && pipeline.counters().hitBuilds == initialHitBuilds + 1, "placement retained stale hit geometry");
        const auto previousHit = frame.content.hitTest;
        const auto previousRevision = frame.revision;
        const auto previousColor = exportDrawOps(frame.content.scenePaint).front().color;
        MutationTransaction invalid;
        invalid.operations.emplace_back(SlotUpdate{paint, ModifierValue{color(0xff000001)}});
        invalid.operations.emplace_back(SlotUpdate{offset, PropValue::stringValue("wrong type")});
        const auto failed = pipeline.run(scene, 1, {0, 500, 0, 500}, &invalid, true, frame);
        check(failed.error.has_value(), "wrong slot payload accepted");
        check(frame.revision == previousRevision && exportDrawOps(frame.content.scenePaint).front().color == previousColor, "failed frame changed published content");
        check(std::get<PaintStyleSemantics>(scene.node(1).modifier.find(paintHandle)->descriptor.value).color == previousColor, "failed frame partially changed live scene");
        check(frame.content.hitTest == previousHit, "failed frame changed published hit geometry");
        check(pipeline.counters().failedSubmissions == 1, "failure counter not recorded");
        const auto rejected = scene.slotCounters().rejected;
        MutationTransaction stale;
        stale.operations.emplace_back(SlotUpdate{{paint.identity, paint.generation + 1}, ModifierValue{color(0)}});
        scene.apply(stale);
        check(scene.slotCounters().rejected == rejected + 1, "binding generation mismatch not rejected");
        MutationTransaction replace;
        replace.operations.emplace_back(SlotUpdate{chain, ModifierDescriptors{}});
        replace.operations.emplace_back(SlotUpdate{paint, ModifierValue{color(0xff000000)}});
        scene.apply(replace);
        check(scene.bindingCount() == 2 && scene.slotCounters().rejected == rejected + 2, "retired Modifier binding still writable");
        MutationTransaction deleted;
        deleted.operations.emplace_back(DeleteNodeMutation{1});
        deleted.operations.emplace_back(CreateNodeMutation{1, NodeType::Text, allocateRuntimeIdentity()});
        deleted.operations.emplace_back(SlotUpdate{chain, box(0xff000000)});
        scene.apply(deleted);
        check(scene.bindingCount() == 0 && scene.node(1).modifier.elements().empty(), "old node generation reached recreated node");
        scene.reset();
        scene.apply(stale);
        check(scene.bindingCount() == 0 && scene.slotCounters().rejected == 1, "reset accepted old binding");
    }

    void verifyOrderedSubmissions() {
        NativeScene scene;
        const NodeHandle node{1, allocateRuntimeIdentity()};
        const auto text = binding();
        MutationTransaction initial;
        initial.operations = {
            CreateNodeMutation{node.id, NodeType::Text, node.generation},
            RegisterBinding{text, HostInputTarget{node, HostInput::Text}},
            SlotUpdate{text, PropValue::stringValue("initial")},
        };
        scene.apply(initial);

        MutationTransaction write;
        write.operations = {SlotUpdate{text, PropValue::stringValue("before retirement")}};
        MutationTransaction retire;
        retire.operations = {RetireBinding{text}, SlotUpdate{text, PropValue::stringValue("late")}};
        MutationTransactionQueue queue;
        queue.push(std::move(write));
        queue.push(std::move(retire));
        scene.apply(*queue.take());
        check(scene.node(1).text == "before retirement" && scene.bindingCount() == 0,
              "merging submissions reordered a write after retirement");
        check(scene.slotCounters().rejected == 1, "late update was not rejected");

        const auto next = binding();
        MutationTransaction rebind;
        rebind.operations = {RegisterBinding{next, HostInputTarget{node, HostInput::Text}}};
        scene.apply(rebind);
        MutationTransaction invalidThenDelete;
        invalidThenDelete.operations = {
            SlotUpdate{next, ModifierValue{OffsetModifier{}}},
            DeleteNodeMutation{1},
        };
        bool failed = false;
        try { scene.apply(invalidThenDelete); } catch (const std::exception&) { failed = true; }
        check(failed && scene.contains(1) && scene.bindingCount() == 1,
              "later deletion hid an invalid earlier write");

        const auto replacement = binding();
        const NodeHandle recreated{1, allocateRuntimeIdentity()};
        MutationTransaction replace;
        replace.operations = {
            DeleteNodeMutation{1},
            CreateNodeMutation{1, NodeType::Text, recreated.generation},
            RegisterBinding{replacement, HostInputTarget{recreated, HostInput::Text}},
            SlotUpdate{next, PropValue::stringValue("stale")},
            SlotUpdate{replacement, PropValue::stringValue("replacement")},
        };
        scene.apply(replace);
        check(scene.node(1).text == "replacement" && scene.bindingCount() == 1,
              "ordered recreation retained the old binding");
    }

    void verifyHostInputsAndAtomicApply() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        const NodeHandle node{1, allocateRuntimeIdentity()};
        const auto text = binding(), style = binding();
        MutationTransaction mount;
        mount.operations.emplace_back(CreateNodeMutation{1, NodeType::Text, node.generation});
        mount.operations.emplace_back(RegisterBinding{text, HostInputTarget{node, HostInput::Text}});
        mount.operations.emplace_back(RegisterBinding{style, HostInputTarget{node, HostInput::TextStyle}});
        mount.operations.emplace_back(SlotUpdate{text, PropValue::stringValue("Reactive slots")});
        mount.operations.emplace_back(SlotUpdate{style, PropValue::objectValue({{"fontSize", PropValue::numberValue(16)}, {"color", PropValue::numberValue(0xff112233)}})});
        check(!pipeline.run(scene, 1, {0, 500, 0, 500}, &mount, true, frame).error, "host bindings mount failed");
        MutationTransaction recolor;
        recolor.operations.emplace_back(SlotUpdate{style, PropValue::objectValue({{"color", PropValue::numberValue(0xff445566)}, {"fontSize", PropValue::numberValue(16)}})});
        const auto result = pipeline.run(scene, 1, {0, 500, 0, 500}, &recolor, true, frame);
        check(result.plan.buildPaint && !result.plan.measure, "textStyle color change remeasured text");
        const auto paintBuilds = pipeline.counters().paintBuilds;
        const auto unchanged = pipeline.run(scene, 1, {0, 500, 0, 500}, &recolor, true, frame);
        check(!unchanged.plan.publishFrame && pipeline.counters().paintBuilds == paintBuilds && scene.slotCounters().unchanged > 0, "equal typed value rebuilt frame");
        MutationTransaction invalid;
        invalid.operations.emplace_back(CreateNodeMutation{2, NodeType::Box});
        invalid.operations.emplace_back(InsertChildMutation{2, 2, 0});
        bool failed = false;
        try { scene.apply(invalid); } catch (const std::exception&) { failed = true; }
        check(failed && !scene.contains(2), "NativeScene::apply retained partial structure on error");
        MutationTransaction retire;
        retire.operations.emplace_back(RetireBinding{text});
        retire.operations.emplace_back(SlotUpdate{text, PropValue::stringValue("late")});
        scene.apply(retire);
        check(scene.node(1).text == "Reactive slots" && scene.bindingCount() == 1, "retired host binding accepted late update");
    }
}

int main() {
    try {
        verifyOrderedSubmissions();
        verifyBindingsAndFailureBoundary();
        verifyHostInputsAndAtomicApply();
        std::cout << "Typed slots: lifecycle, phases, equality and atomic failure checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
