#include <arrange/core/SceneFramePipeline.h>
#include "AllocationProbe.h"
#include <chrono>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    constexpr int iterations = 20;

    struct WorkSample {
        FrameExecutionCounters phases;
        arrange::test::AllocationStats allocations;
        std::uint64_t accesses = 0;
        double millis = 0;
    };

    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    ModifierDescriptors description(float width = 12, float x = 0, std::uint32_t color = 0xff336699) {
        LayoutModifierSemantics size;
        size.kind = LayoutModifierKind::Size;
        size.width = width;
        size.height = 10;
        return {{size, "尺寸"}, {OffsetModifier{x, 0}, "位置"}, {PaintStyleSemantics{PaintStyleKind::Background, color}, "背景"}};
    }

    MutationTransaction initialScene() {
        MutationTransaction transaction;
        auto add = [&](TreeMutation mutation) {
            transaction.operations.emplace_back(std::move(mutation));
        };
        add(CreateNodeMutation{1, NodeType::Root});
        for (NodeId group = 0; group < 24; ++group) {
            const auto parent = 2 + group * 17;
            add(CreateNodeMutation{parent, NodeType::Layout});
            add(SetPropMutation{parent, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Row")}})});
            add(InsertChildMutation{1, parent, static_cast<std::size_t>(group)});
            for (NodeId item = 1; item <= 16; ++item) {
                const auto id = parent + item;
                add(CreateNodeMutation{id, NodeType::Layout});
                add(SetModifierMutation{id, description()});
                add(InsertChildMutation{parent, id, static_cast<std::size_t>(item - 1)});
            }
        }
        return transaction;
    }

    void verifyScene(const NativeScene& local, const PublishedFrame& frame) {
        auto full = local.tree();
        for (const auto id : full.nodeIds()) {
            full.node(id).measurementValid = false;
            full.node(id).placementValid = false;
            full.markInputDirty(id, dirtyMask(DirtyFlag::Structure));
        }
        full.recordSceneInvalidation(DirtyFlag::Structure, InvalidationSource::NativeState, "验收", "完整计算对照");
        LayoutEngine{}.layout(full, 1, {0, 1000, 0, 1000});
        check(exportDrawOps(frame.content.scenePaint) == DrawOpsBuilder{}.exportScene(full, 1), "局部绘制结果与完整计算不同");

        const auto reference = buildHitTestSnapshot(full, 1);
        HitTester tester;
        for (float x = -2; x <= 230; x += 2) {
            const auto actual = tester.hitTest(*frame.content.hitTest, {x, 5});
            const auto expected = tester.hitTest(reference, {x, 5});
            check(actual.hit == expected.hit && actual.node == expected.node && actual.modifier == expected.modifier, "局部命中结果与完整计算不同");
        }
        for (NodeId id = 1; id <= 409; ++id) {
            if (!full.contains(id)) continue;
            check(local.node(id).bounds == full.node(id).bounds && local.node(id).contentBounds == full.node(id).contentBounds, "局部测量放置结果与完整计算不同");
        }
    }

    // 完整计算仍使用同一生产流水线，只清除缓存与局部失效信息
    void invalidateAll(NativeScene& scene) {
        auto& tree = scene.tree();
        for (const auto id : tree.nodeIds()) {
            auto& node = tree.node(id);
            node.measurementValid = false;
            node.placementValid = false;
            node.paintCache.reset();
            node.contentFragment.reset();
            node.hitCache.reset();
            for (auto& instance : node.modifier.elements()) instance.paintCache.reset();
            tree.markInputDirty(id, dirtyMask(DirtyFlag::Structure));
        }
        tree.requestFullFallback("固定场景的完整计算对照");
    }

    WorkSample run(const char* label, int mode, bool full) {
        NativeScene scene;
        PublishedFrame frame;
        SceneFramePipeline pipeline;
        const auto initial = initialScene();
        check(!pipeline.run(scene, 1, {0, 1000, 0, 1000}, &initial, true, frame).error, "初始场景失败");
        const auto before = pipeline.counters();
        WorkSample sample;
        for (int iteration = 0; iteration < iterations; ++iteration) {
            MutationTransaction change;
            if (mode == 3)
                change.operations.emplace_back(TreeMutation{InsertChildMutation{2, iteration % 2 ? 3u : 4u, 0}});
            else
                change.operations.emplace_back(TreeMutation{SetModifierMutation{3, description(mode == 2 ? 13 + iteration % 2 : 12, mode == 1 ? iteration % 2 + 1 : 0, mode == 0 ? 0xff112233 + iteration : 0xff336699)}});
            if (full) invalidateAll(scene);
            scene.tree().resetNodeAccesses();
            arrange::test::beginAllocationProbe();
            const auto started = std::chrono::steady_clock::now();
            const auto result = pipeline.run(scene, 1, {0, 1000, 0, 1000}, &change, true, frame);
            sample.millis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
            const auto allocated = arrange::test::endAllocationProbe();
            sample.allocations.count += allocated.count;
            sample.allocations.bytes += allocated.bytes;
            sample.accesses += scene.tree().nodeAccesses();
            check(!result.error, "局部更新失败");
            verifyScene(scene, frame);
        }
        const auto after = pipeline.counters();
        auto& work = sample.phases;
        work.measures = after.measures - before.measures;
        work.placements = after.placements - before.placements;
        work.paintBuilds = after.paintBuilds - before.paintBuilds;
        work.hitBuilds = after.hitBuilds - before.hitBuilds;
        work.layoutWork.measuredNodes = after.layoutWork.measuredNodes - before.layoutWork.measuredNodes;
        work.layoutWork.placedNodes = after.layoutWork.placedNodes - before.layoutWork.placedNodes;
        work.paintWork.nodesBuilt = after.paintWork.nodesBuilt - before.paintWork.nodesBuilt;
        work.paintWork.layersBuilt = after.paintWork.layersBuilt - before.paintWork.layersBuilt;
        work.hitWork.nodesBuilt = after.hitWork.nodesBuilt - before.hitWork.nodesBuilt;
        work.hitWork.emittedRegions = after.hitWork.emittedRegions - before.hitWork.emittedRegions;
        work.candidateNodesCopied = after.candidateNodesCopied - before.candidateNodesCopied;
        work.measureMillis = after.measureMillis - before.measureMillis;
        work.placeMillis = after.placeMillis - before.placeMillis;
        work.paintBuildMillis = after.paintBuildMillis - before.paintBuildMillis;
        work.hitBuildMillis = after.hitBuildMillis - before.hitBuildMillis;
        std::cout << label << (full ? " 完整" : " 局部") << " 帧数=" << iterations << " 访问=" << sample.accesses << " 测量阶段=" << work.measures << " 放置阶段=" << work.placements << " 绘制阶段=" << work.paintBuilds << " 命中阶段=" << work.hitBuilds << " 测量=" << work.layoutWork.measuredNodes << " 放置=" << work.layoutWork.placedNodes << " 绘制节点=" << work.paintWork.nodesBuilt << " 绘制层=" << work.paintWork.layersBuilt << " 命中构建=" << work.hitWork.nodesBuilt << " 命中区域复制=" << work.hitWork.emittedRegions << " 候选复制=" << work.candidateNodesCopied << " new次数=" << sample.allocations.count << " new字节=" << sample.allocations.bytes << " 测量毫秒=" << work.measureMillis << " 放置毫秒=" << work.placeMillis << " 绘制毫秒=" << work.paintBuildMillis << " 命中毫秒=" << work.hitBuildMillis << " 总毫秒=" << sample.millis << '\n';
        return sample;
    }

    void compare(const char* label, int mode) {
        const auto local = run(label, mode, false);
        const auto full = run(label, mode, true);
        check(local.accesses < full.accesses, "局部更新没有减少节点访问");
        check(local.phases.paintWork.nodesBuilt < full.phases.paintWork.nodesBuilt, "局部更新没有减少绘制节点");
        check(local.phases.hitWork.nodesBuilt < full.phases.hitWork.nodesBuilt, "局部更新没有减少命中构建");
        check(local.allocations.count < full.allocations.count, "局部更新没有减少原生 new 分配");
        check(local.phases.layoutWork.measuredNodes < full.phases.layoutWork.measuredNodes, "局部更新没有减少测量工作");
        if (mode <= 1) check(local.phases.measures == 0, "颜色或位置更新执行了测量阶段");
        if (mode == 0) check(local.phases.placements == 0 && local.phases.hitBuilds == 0, "颜色更新执行了放置或命中阶段");
        if (mode == 1) check(local.phases.placements == iterations && local.phases.hitBuilds == iterations, "位置更新没有执行必要放置或命中阶段");
        if (mode >= 2) check(local.phases.measures > 0 && local.phases.placements > 0, "尺寸或结构更新遗漏必要布局阶段");
    }
}

int main() {
    try {
        compare("颜色", 0);
        compare("位置", 1);
        compare("尺寸", 2);
        compare("局部结构", 3);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
