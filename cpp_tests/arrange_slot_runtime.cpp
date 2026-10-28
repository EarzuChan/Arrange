#include "TextFixtures.h"
#include <arrange/core/SceneFramePipeline.h>

#include <iostream>
#include <map>
#include <optional>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    BindingHandle binding() {
        return {allocateRuntimeIdentity(), 1};
    }

    PaintStyleSemantics color(std::uint32_t value) {
        PaintStyleSemantics paint;
        paint.color = value;
        return paint;
    }

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
        mount.operations.emplace_back(CreateNodeMutation{node.id, arrange::core::NodeType::Layout, node.generation});
        mount.operations.emplace_back(SetPropMutation{node.id, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})});
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
        registerInputs.operations.emplace_back(RegisterBinding{style, HostInputTarget{node, HostInput::Enabled}});
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
        deleted.operations.emplace_back(CreateNodeMutation{1, arrange::core::NodeType::Layout, allocateRuntimeIdentity()});
        deleted.operations.emplace_back(SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})});
        deleted.operations.emplace_back(SlotUpdate{chain, box(0xff000000)});
        scene.apply(deleted);
        check(scene.bindingCount() == 0 && scene.node(1).modifier.elements().empty(), "old node generation reached recreated node");
        scene.reset();
        scene.apply(stale);
        check(scene.bindingCount() == 0 && scene.slotCounters().rejected == 1, "reset accepted old binding");
    }

    struct NodeState {
        Rect bounds;
        std::vector<NodeId> children;
        std::optional<NodeId> parent;
        std::uint32_t dirty = 0;
        std::uint32_t subtreeDirty = 0;
        bool measured = false;
        bool placed = false;
        const void* paint = nullptr;
        const void* hit = nullptr;
        std::size_t modifiers = 0;
        bool operator==(const NodeState&) const = default;
    };

    std::map<NodeId, NodeState> capture(const NativeScene& scene) {
        std::map<NodeId, NodeState> result;
        const auto& tree = scene.tree();
        for (const auto id : tree.nodeIds()) {
            const auto& node = tree.node(id);
            result[id] = {node.bounds, node.children, tree.parentOf(id), node.dirty, node.subtreeDirty, node.measurementValid, node.placementValid, node.paintCache.get(), node.hitCache.get(), node.modifier.elements().size()};
        }
        return result;
    }

    // 写入日志：注入失败后场景逐字段回到上次成功状态；局部帧只记录被写节点
    void verifyJournalRollback() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        const auto column = PropValue::objectValue({{"kind", PropValue::stringValue("Column")}});
        MutationTransaction mount;
        mount.operations.emplace_back(CreateNodeMutation{1, arrange::core::NodeType::Layout, allocateRuntimeIdentity()});
        mount.operations.emplace_back(SetPropMutation{1, "measurePolicy", column});
        std::vector<NodeHandle> children;
        for (NodeId id = 2; id < 12; ++id) {
            children.push_back({id, allocateRuntimeIdentity()});
            mount.operations.emplace_back(CreateNodeMutation{id, arrange::core::NodeType::Layout, children.back().generation});
            mount.operations.emplace_back(InsertChildMutation{1, id, static_cast<std::uint32_t>(id - 2)});
            mount.operations.emplace_back(SetModifierMutation{id, box(0xff000000u + id)});
        }
        const auto chain = binding();
        mount.operations.emplace_back(RegisterBinding{chain, ModifierChainTarget{children[0]}});
        check(!pipeline.run(scene, 1, {0, 500, 0, 2000}, &mount, true, frame).error, "挂载帧失败");

        const auto before = capture(scene);
        const auto bindings = scene.bindingCount();
        const auto counters = scene.slotCounters();
        const auto revision = frame.revision;
        const auto invalidation = scene.invalidationSnapshot();
        MutationTransaction change;
        change.operations.emplace_back(CreateNodeMutation{50, arrange::core::NodeType::Layout, allocateRuntimeIdentity()});
        change.operations.emplace_back(InsertChildMutation{1, 50, 0});
        change.operations.emplace_back(SetModifierMutation{50, box(0xff123456)});
        change.operations.emplace_back(DeleteNodeMutation{3});
        change.operations.emplace_back(SlotUpdate{chain, box(0xff654321)});
        change.operations.emplace_back(RegisterBinding{binding(), ModifierChainTarget{children[2]}});
        change.operations.emplace_back(RetireBinding{chain});
        const auto failed = pipeline.run(scene, 1, {0, 500, 0, 2000}, &change, true, frame, [](const NativeScene&, PublishedFrame&) { throw std::runtime_error("注入失败"); });
        check(failed.error.has_value() && failed.plan.measure && failed.plan.buildPaint, "注入失败应发生在测量与绘制之后");
        check(capture(scene) == before, "失败帧回滚后节点、父子关系、几何或缓存与上次成功状态不同");
        check(scene.bindingCount() == bindings && scene.slotCounters().registrations == counters.registrations && scene.slotCounters().retirements == counters.retirements && scene.slotCounters().updates == counters.updates, "失败帧回滚后绑定或计数与上次成功状态不同");
        check(scene.invalidationSnapshot().combinedDirty == invalidation.combinedDirty && frame.revision == revision, "失败帧改变了失效汇总或已发布帧");

        const auto applied = pipeline.run(scene, 1, {0, 500, 0, 2000}, &change, true, frame);
        check(!applied.error && scene.contains(50) && !scene.contains(3) && scene.bindingCount() == bindings, "回滚后同一事务应能完整提交");

        MutationTransaction paint;
        paint.operations.emplace_back(SetModifierMutation{5, box(0xffabcdef)});
        const auto copied = pipeline.counters().candidateNodesCopied;
        check(!pipeline.run(scene, 1, {0, 500, 0, 2000}, &paint, true, frame).error, "局部颜色帧失败");
        check(pipeline.counters().candidateNodesCopied - copied <= 2, "局部颜色帧不应记录无关节点");
    }

    void verifyOrderedSubmissions() {
        NativeScene scene;
        const NodeHandle node{1, allocateRuntimeIdentity()};
        const auto text = binding();
        MutationTransaction initial;
        initial.operations = {
            CreateNodeMutation{node.id, arrange::core::NodeType::Layout, node.generation},
            SetPropMutation{node.id, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})},
            RegisterBinding{text, ModifierChainTarget{node}},
            SlotUpdate{text, ModifierDescriptors{{test_support::text("initial"), {}}}},
        };
        scene.apply(initial);

        MutationTransaction write;
        write.operations = {SlotUpdate{text, ModifierDescriptors{{test_support::text("before retirement"), {}}}}};
        MutationTransaction retire;
        retire.operations = {RetireBinding{text}, SlotUpdate{text, ModifierDescriptors{{test_support::text("late"), {}}}}};
        MutationTransactionQueue queue;
        queue.push(std::move(write));
        queue.push(std::move(retire));
        scene.apply(*queue.take());
        check(test_support::textOf(scene.node(1)) == "before retirement" && scene.bindingCount() == 0, "merging submissions reordered a write after retirement");
        check(scene.slotCounters().rejected == 1, "late update was not rejected");

        const auto next = binding();
        MutationTransaction rebind;
        rebind.operations = {RegisterBinding{next, ModifierChainTarget{node}}};
        scene.apply(rebind);
        MutationTransaction invalidThenDelete;
        invalidThenDelete.operations = {
            SlotUpdate{next, ModifierValue{OffsetModifier{}}},
            DeleteNodeMutation{1},
        };
        bool failed = false;
        try {
            scene.apply(invalidThenDelete);
        } catch (const std::exception&) {
            failed = true;
        }
        check(failed && scene.contains(1) && scene.bindingCount() == 1, "later deletion hid an invalid earlier write");

        const auto replacement = binding();
        const NodeHandle recreated{1, allocateRuntimeIdentity()};
        MutationTransaction replace;
        replace.operations = {
            DeleteNodeMutation{1}, CreateNodeMutation{1, arrange::core::NodeType::Layout, recreated.generation}, SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, RegisterBinding{replacement, ModifierChainTarget{recreated}}, SlotUpdate{next, ModifierDescriptors{{test_support::text("stale"), {}}}}, SlotUpdate{replacement, ModifierDescriptors{{test_support::text("replacement"), {}}}},
        };
        scene.apply(replace);
        check(test_support::textOf(scene.node(1)) == "replacement" && scene.bindingCount() == 1, "ordered recreation retained the old binding");
    }

    void verifyTextModifierAndAtomicApply() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame frame;
        const NodeHandle node{1, allocateRuntimeIdentity()};
        const auto chain = binding();
        MutationTransaction mount;
        mount.operations = {CreateNodeMutation{node.id, NodeType::Layout, node.generation}, RegisterBinding{chain, ModifierChainTarget{node}}, SlotUpdate{chain, ModifierDescriptors{{test_support::text("反应式文本", 0xff112233), {}}}}};
        check(!pipeline.run(scene, 1, {0, 500, 0, 500}, &mount, true, frame).error, "文本 Modifier 挂载失败");
        const auto text = binding();
        MutationTransaction registerText;
        registerText.operations = {RegisterBinding{text, ModifierInputTarget{node, scene.node(1).modifier.elements()[0].handle}}};
        scene.apply(registerText);
        MutationTransaction recolor;
        recolor.operations = {SlotUpdate{text, ModifierValue{test_support::text("反应式文本", 0xff445566)}}};
        const auto result = pipeline.run(scene, 1, {0, 500, 0, 500}, &recolor, true, frame);
        check(result.plan.buildPaint && !result.plan.measure, "文字颜色变化不应重新测量");
        const auto paintBuilds = pipeline.counters().paintBuilds;
        const auto unchanged = pipeline.run(scene, 1, {0, 500, 0, 500}, &recolor, true, frame);
        check(!unchanged.plan.publishFrame && pipeline.counters().paintBuilds == paintBuilds && scene.slotCounters().unchanged > 0, "相等文本值不应重建帧");
        MutationTransaction invalid;
        invalid.operations = {CreateNodeMutation{2, NodeType::Layout}, InsertChildMutation{2, 2, 0}};
        bool failed = false;
        try {
            scene.apply(invalid);
        } catch (const std::exception&) {
            failed = true;
        }
        check(failed && !scene.contains(2), "失败应用不得留下半成品结构");
        MutationTransaction retire;
        retire.operations = {RetireBinding{text}, SlotUpdate{text, ModifierValue{test_support::text("迟到文字")}}};
        scene.apply(retire);
        check(test_support::textOf(scene.node(1)) == "反应式文本" && scene.bindingCount() == 1, "退休文本绑定接受了迟到更新");
    }

}

int main() {
    try {
        verifyOrderedSubmissions();
        verifyBindingsAndFailureBoundary();
        verifyTextModifierAndAtomicApply();
        verifyJournalRollback();
        std::cout << "Typed slots: lifecycle, phases, equality and atomic failure checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
