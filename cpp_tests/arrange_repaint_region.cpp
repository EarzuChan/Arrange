#include <arrange/core/SceneFramePipeline.h>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    ModifierDescriptors box(float x, std::uint32_t color, float width = 20) {
        LayoutModifierSemantics size;
        size.kind = LayoutModifierKind::Size;
        size.width = width;
        size.height = 10;
        return {{size, "尺寸"}, {OffsetModifier{x, 0}, "位置"}, {PaintStyleSemantics{PaintStyleKind::Background, color}, "背景"}};
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
            transaction.operations.emplace_back(TreeMutation{SetModifierMutation{3 + item, box(0, 0xff336699)}});
            transaction.operations.emplace_back(TreeMutation{InsertChildMutation{2, 3 + item, static_cast<std::uint32_t>(item)}});
        }
        return transaction;
    }

    struct Harness {
        NativeScene scene;
        PublishedFrame frame;
        SceneFramePipeline pipeline;
        Constraints viewport{0, 400, 0, 300};

        const RepaintRegion& apply(MutationTransaction change) {
            check(!pipeline.run(scene, 1, viewport, &change, true, frame).error, "流水线失败");
            check(frame.plan.passivePaint, "可见变化没有请求被动重绘");
            return frame.changes.repaint;
        }
    };

    bool covers(const RepaintRegion& region, Rect target) {
        for (const auto& rect : region.rects)
            if (rect.x <= target.x && rect.y <= target.y && rect.x + rect.width >= target.x + target.width && rect.y + rect.height >= target.y + target.height) return true;
        return false;
    }

    float area(const RepaintRegion& region) {
        float total = 0;
        for (const auto& rect : region.rects) total += rect.width * rect.height;
        return total;
    }

    MutationTransaction modify(NodeId id, ModifierDescriptors descriptors) {
        MutationTransaction change;
        change.operations.emplace_back(TreeMutation{SetModifierMutation{id, std::move(descriptors)}});
        return change;
    }
}

int main() {
    try {
        Harness harness;
        check(harness.apply(initialScene()).full, "首帧必须整块重绘");

        // 节点 5 位于 x=40..60；颜色变化只重绘该块
        const auto& color = harness.apply(modify(5, box(0, 0xffff0000)));
        check(!color.full && !color.rects.empty(), "单块颜色变化应局部重绘");
        check(covers(color, {40, 0, 20, 10}), "局部重绘没有覆盖变化节点");
        check(area(color) < 40 * 20, "颜色变化的重绘范围过大");

        // 节点 8 位于 x=100..120，右移 50：新旧位置都要覆盖
        const auto& moved = harness.apply(modify(8, box(50, 0xff336699)));
        check(!moved.full, "单块位移应局部重绘");
        check(covers(moved, {100, 0, 20, 10}) && covers(moved, {150, 0, 20, 10}), "位移重绘必须包含新旧位置");

        // 尺寸变化引起后续兄弟重排，仍须覆盖原尺寸与新尺寸
        const auto& resized = harness.apply(modify(10, box(0, 0xff336699, 30)));
        check(resized.full || covers(resized, {140, 0, 30, 10}), "尺寸变化没有覆盖新边界");

        // 视口变化整块重绘
        harness.viewport = {0, 500, 0, 300};
        check(harness.apply({}).full, "视口变化必须整块重绘");

        // 超过面积阈值时整块重绘
        // 30x16 视口的一半为 240，单块外扩后约 22x12=264
        harness.viewport = {0, 30, 0, 16};
        (void)harness.apply({});
        check(harness.apply(modify(3, box(0, 0xff00ff00))).full, "超过面积阈值仍局部重绘");

        RepaintDamage damage;
        damage.addRect({1.2f, 2.7f, 3.1f, 4.4f});
        const auto region = damage.finish({100, 100});
        check(region.rects.size() == 1 && region.rects[0] == Rect{0, 1, 6, 8}, "局部区域没有外扩取整");
        RepaintDamage many;
        for (int index = 0; index < 20; ++index) many.addRect({index * 40.0f, 0, 2, 2});
        check(many.finish({1000, 1000}).full, "区域数超限没有回退整块重绘");
        RepaintDamage rows;
        for (int index = 0; index < 500; ++index) rows.addRect({0, index * 2.0f, 10, 2});
        const auto merged = rows.finish({2000, 2000});
        check(!merged.full && merged.rects.size() == 1 && covers(merged, {0, 0, 10, 1000}), "大量相邻变化没有合并为一块");
        RepaintDamage scattered;
        for (int index = 0; index < 1000; ++index) scattered.addRect({(index % 40) * 50.0f, (index / 40) * 50.0f, 2, 2});
        check(scattered.full(), "大量分散变化没有在收集期回退整块重绘");
        RepaintDamage unknown;
        unknown.compareScene({}, {std::make_shared<const PaintFragment>(PaintFragment{.bounds = {{}, false, false}}), {}});
        check(unknown.finish({100, 100}).full, "未知边界没有回退整块重绘");
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
