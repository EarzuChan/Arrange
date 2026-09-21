#include <arrange/core/SceneFramePipeline.h>
#include <chrono>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
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

    void run(const char* label, int mode) {
        NativeScene scene;
        PublishedFrame frame;
        SceneFramePipeline pipeline;
        const auto initial = initialScene();
        check(!pipeline.run(scene, 1, {0, 1000, 0, 1000}, &initial, true, frame).error, "初始场景失败");
        const auto before = pipeline.counters();
        std::uint64_t accesses = 0;
        double millis = 0;
        for (int iteration = 0; iteration < 20; ++iteration) {
            MutationTransaction change;
            if (mode == 3)
                change.operations.emplace_back(TreeMutation{InsertChildMutation{2, iteration % 2 ? 3u : 4u, 0}});
            else
                change.operations.emplace_back(TreeMutation{SetModifierMutation{3, description(mode == 2 ? 13 + iteration % 2 : 12, mode == 1 ? iteration % 2 + 1 : 0, mode == 0 ? 0xff112233 + iteration : 0xff336699)}});
            scene.tree().resetNodeAccesses();
            const auto started = std::chrono::steady_clock::now();
            const auto result = pipeline.run(scene, 1, {0, 1000, 0, 1000}, &change, true, frame);
            millis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
            accesses += scene.tree().nodeAccesses();
            check(!result.error, "局部更新失败");
            verifyScene(scene, frame);
        }
        const auto after = pipeline.counters();
        std::cout << label << " 访问=" << accesses << " 测量=" << after.layoutWork.measuredNodes - before.layoutWork.measuredNodes << " 放置=" << after.layoutWork.placedNodes - before.layoutWork.placedNodes << " 绘制节点=" << after.paintWork.nodesBuilt - before.paintWork.nodesBuilt << " 绘制层=" << after.paintWork.layersBuilt - before.paintWork.layersBuilt << " 命中构建=" << after.hitWork.nodesBuilt - before.hitWork.nodesBuilt << " 命中区域复制=" << after.hitWork.emittedRegions - before.hitWork.emittedRegions << " 候选复制=" << after.candidateNodesCopied - before.candidateNodesCopied << " 总毫秒=" << millis << '\n';
    }
}  // namespace

int main() {
    try {
        run("颜色", 0);
        run("位置", 1);
        run("尺寸", 2);
        run("局部结构", 3);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
