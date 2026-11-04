#include <arrange/core/DiagnosticsOverlay.h>
#include <arrange/core/SceneFramePipeline.h>

#include <algorithm>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    ModifierDescriptors box(std::uint32_t color) {
        LayoutModifierSemantics size;
        size.kind = LayoutModifierKind::Size;
        size.width = 20;
        size.height = 10;
        return {{size, "尺寸"}, {PaintStyleSemantics{PaintStyleKind::Background, color}, "背景"}};
    }

    // 根下一行 8 个 20x10 色块，节点 3..10
    MutationTransaction initialScene() {
        MutationTransaction transaction;
        transaction.operations.emplace_back(TreeMutation{CreateNodeMutation{1, NodeType::Root}});
        transaction.operations.emplace_back(TreeMutation{CreateNodeMutation{2, NodeType::Layout}});
        transaction.operations.emplace_back(TreeMutation{SetPropMutation{2, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Row")}})}});
        transaction.operations.emplace_back(TreeMutation{InsertChildMutation{1, 2, 0}});
        for (NodeId item = 0; item < 8; ++item) {
            transaction.operations.emplace_back(TreeMutation{CreateNodeMutation{3 + item, NodeType::Layout}});
            transaction.operations.emplace_back(TreeMutation{SetModifierMutation{3 + item, box(0xff336699)}});
            transaction.operations.emplace_back(TreeMutation{InsertChildMutation{2, 3 + item, static_cast<std::uint32_t>(item)}});
        }
        return transaction;
    }

    MutationTransaction modify(NodeId id, ModifierDescriptors descriptors) {
        MutationTransaction change;
        change.operations.emplace_back(TreeMutation{SetModifierMutation{id, std::move(descriptors)}});
        return change;
    }

    ModifierDescriptors drawn(std::uint64_t revision) {
        auto descriptors = box(0xff336699);
        descriptors.push_back({DrawModifier{DrawModifierKind::Behind, {}, revision}, "绘制"});
        return descriptors;
    }

    struct Harness {
        NativeScene scene;
        PublishedFrame frame;
        SceneFramePipeline pipeline;
        Constraints viewport{0, 400, 0, 300};
        FramePreparation prepare;

        void apply(MutationTransaction change) {
            const auto result = pipeline.run(scene, 1, viewport, &change, true, frame, {}, 0, prepare);
            if (result.error) throw std::runtime_error(*result.error);
        }

        void idle() {
            const auto result = pipeline.run(scene, 1, viewport, nullptr, false, frame, {}, 0, prepare);
            if (result.error) throw std::runtime_error(*result.error);
        }
    };

    bool contains(Rect outer, Rect inner) {
        return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
    }

    bool covers(const RepaintRegion& region, Rect target) {
        if (region.full) return true;
        return std::any_of(region.rects.begin(), region.rects.end(), [&](Rect rect) { return contains(rect, target); });
    }

    bool hasOp(const std::vector<DrawOp>& ops, DrawOpType type, Rect rect) {
        return std::any_of(ops.begin(), ops.end(), [&](const DrawOp& op) { return op.type == type && op.rect == rect; });
    }

    void verifyTimeline() {
        Harness harness;
        // 关闭时不记录
        harness.apply(initialScene());
        check(harness.pipeline.timeline().empty() && harness.pipeline.timeline().recorded() == 0, "时间线关闭时仍有记录");

        harness.pipeline.timeline().setEnabled(true);
        harness.apply(modify(5, box(0xffff0000)));
        const auto* colored = harness.pipeline.timeline().latest();
        check(colored && colored->revision == harness.frame.revision, "发布帧没有记入时间线");
        check(colored->nodes == harness.scene.tree().size() && colored->nodes == 10, "节点数记录错误");
        check(!colored->repaint.full && covers(colored->repaint, {40, 0, 20, 10}), "记录的场景脏区与发布帧不一致");
        check(colored->repaint == harness.frame.changes.repaint, "记录的脏区不是发布帧的场景脏区");
        check(colored->fragmentsReused > 0 && colored->fragmentsBuilt > 0, "片段复用计数没有记录");
        check(colored->millis.total >= colored->millis.paintBuild && (colored->phases & (1u << static_cast<std::uint32_t>(FramePhase::BuildPaint))) != 0, "阶段耗时或阶段位记录错误");
        check(colored->drawRecords == 0, "没有绘制修饰器时记录了重录");

        // 未发布的空帧不记录
        const auto recorded = harness.pipeline.timeline().recorded();
        harness.idle();
        check(harness.pipeline.timeline().recorded() == recorded, "未发布的帧被记入时间线");

        // 绘制修饰器每重录一次计一次
        harness.prepare.draw = [](NativeScene& scene) {
            for (auto& instance : scene.tree().mutableNode(6).modifier.elements())
                if (std::holds_alternative<DrawModifier>(instance.descriptor.value)) {
                    instance.preparedDraw = std::make_shared<const DrawCommands>(DrawCommands{{.kind = DrawCommandKind::Rectangle, .rect = {2, 2, 6, 6}, .color = 0xff00ff00}, {.kind = DrawCommandKind::Content}});
                    scene.noteDrawPrepared();
                }
        };
        harness.apply(modify(6, drawn(1)));
        check(harness.pipeline.timeline().latest()->drawRecords == 1, "绘制修饰器重录次数记录错误");
        harness.prepare.draw = {};

        // 宿主重放耗时补记到同修订的最新记录
        harness.pipeline.timeline().notePaint(harness.frame.revision, 1.5);
        harness.pipeline.timeline().notePaint(harness.frame.revision + 1, 9);
        check(harness.pipeline.timeline().latest()->millis.paint == 1.5, "重放耗时补记错误");

        // 环形容量只保留最近若干帧，序号连续
        harness.pipeline.timeline().setCapacity(3);
        for (std::uint32_t index = 0; index < 5; ++index) harness.apply(modify(5, box(0xff000000u + index)));
        const auto& timeline = harness.pipeline.timeline();
        check(timeline.size() == 3 && timeline.at(2).sequence == timeline.recorded() && timeline.at(0).sequence + 2 == timeline.at(2).sequence, "环形时间线淘汰顺序错误");
        check(timeline.snapshot().back().revision == harness.frame.revision, "时间线快照顺序错误");

        // 关闭即丢弃记录
        harness.pipeline.timeline().setEnabled(false);
        harness.apply(modify(5, box(0xff123456)));
        check(harness.pipeline.timeline().empty(), "关闭后时间线仍保留或继续记录");
    }

    void verifyOverlay() {
        Harness harness;
        harness.pipeline.timeline().setEnabled(true);
        harness.apply(initialScene());
        DiagnosticsOverlay overlay;
        auto& tree = harness.scene.tree();

        // 关闭时不产生命令与重绘
        check(overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 0).empty() && overlay.ops().empty(), "关闭的叠加层产生了绘制");

        overlay.setEnabled(true);
        const auto shown = overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 0);
        check(!overlay.ops().empty() && !shown.empty(), "开启后没有绘制叠加层");
        check(covers(shown, {8, 8, 220, 10}), "叠加层重绘没有覆盖帧时间面板");
        check(std::any_of(overlay.ops().begin(), overlay.ops().end(), [](const DrawOp& op) { return op.type == DrawOpType::DrawText && op.text.starts_with("frame "); }), "缺少帧时间读数");
        check(std::any_of(overlay.ops().begin(), overlay.ops().end(), [](const DrawOp& op) { return op.type == DrawOpType::DrawText && op.text.starts_with("rev "); }), "缺少状态读数");
        // 开启前已记录的脏区不闪烁
        check(!overlay.animating(), "开启前的场景脏区被当作新脏区闪烁");
        check(overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 1001).empty(), "没有变化时叠加层仍请求重绘");

        // 场景变化：闪烁覆盖场景脏区，叠加层自己的重绘不回写场景脏区
        harness.apply(modify(10, box(0xffff0000)));
        const auto scene = harness.frame.changes.repaint;
        check(!scene.full && !covers(scene, {8, 8, 220, 10}), "场景脏区包含了叠加层");
        const auto flashed = overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 2000);
        check(overlay.animating() && hasOp(overlay.ops(), DrawOpType::FillRect, scene.rects.front()), "脏区闪烁没有画在场景脏区上");
        check(covers(flashed, scene.rects.front()), "叠加层重绘没有覆盖闪烁");
        check(harness.pipeline.timeline().latest()->repaint == scene, "叠加层改动了时间线中的场景脏区");
        // 同一区域再次重绘只重新计时，不叠加第二层闪烁
        harness.apply(modify(10, box(0xff00ff00)));
        (void)overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 2100);
        check(std::count_if(overlay.ops().begin(), overlay.ops().end(), [&](const DrawOp& op) { return op.type == DrawOpType::FillRect && op.rect == scene.rects.front(); }) == 1, "同一区域连续重绘叠加了多层闪烁");
        const auto faded = overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 2100 + DiagnosticsOverlay::flashMillis);
        check(!overlay.animating() && covers(faded, scene.rects.front()), "闪烁褪尽后没有重绘原处");

        // bounds 描边与命中高亮
        overlay.setLayers({.frameTime = false, .status = false, .dirtyFlash = false, .bounds = true, .hit = true});
        overlay.setPointer(Point{45, 5});
        const auto outlined = overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 3000);
        const auto outlines = collectNodeOutlines(tree, 1);
        check(outlines.size() == 10 && outlines.front().node == 1, "节点外包盒收集错误");
        check(hasOp(overlay.ops(), DrawOpType::StrokeRect, {40, 0, 20, 10}), "缺少节点 bounds 描边");
        const auto highlighted = std::count_if(overlay.ops().begin(), overlay.ops().end(), [](const DrawOp& op) { return op.rect == Rect{40, 0, 20, 10}; });
        check(highlighted == 3, "命中高亮没有落在指针下的节点");
        check(!std::any_of(overlay.ops().begin(), overlay.ops().end(), [](const DrawOp& op) { return op.type == DrawOpType::DrawText; }), "关闭的面板仍在绘制");
        check(covers(outlined, {40, 0, 20, 10}), "描边重绘范围错误");
        overlay.setPointer(Point{65, 5});
        const auto moved = overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 3001);
        check(covers(moved, {40, 0, 20, 10}) && covers(moved, {60, 0, 20, 10}) && !moved.full && moved.rects.size() <= 2, "命中高亮移动应只重绘新旧节点");

        // 关闭后清除并重绘原处
        overlay.setEnabled(false);
        const auto hidden = overlay.update(harness.pipeline.timeline(), harness.frame, tree, 1, 3002);
        check(overlay.ops().empty() && covers(hidden, {40, 0, 20, 10}), "关闭叠加层没有清除绘制");
    }
}

int main() {
    try {
        verifyTimeline();
        verifyOverlay();
        std::cout << "arrange_diagnostics_overlay 通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
