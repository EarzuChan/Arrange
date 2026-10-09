#include <arrange/core/Layout.h>
#include <arrange/core/TextLayoutService.h>

#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool value, const char* message) {
        if (!value) throw std::runtime_error(message);
    }

    bool near(float a, float b) {
        return std::abs(a - b) < 0.01f;
    }

    ModifierDescriptor size(float width, float height) {
        LayoutModifierSemantics value;
        value.kind = LayoutModifierKind::Size;
        value.width = width;
        value.height = height;
        return {value};
    }

    void children(LayoutTree& tree, int count) {
        tree.apply({CreateNodeMutation{1, NodeType::Layout}});
        for (int i = 0; i < count; ++i) tree.apply({CreateNodeMutation{static_cast<NodeId>(i + 2), NodeType::Layout}, InsertChildMutation{1, static_cast<NodeId>(i + 2), static_cast<std::uint32_t>(i)}});
    }

    void intrinsicAndBounds() {
        LayoutTree tree;
        children(tree, 2);
        tree.node(1).measurePolicy = RowMeasurePolicy{};
        tree.setModifierChain(2, {size(20, 10)});
        tree.setModifierChain(3, {size(30, 40)});
        LayoutEngine layout;
        check(layout.minIntrinsicWidth(tree, 1, 100) == 50 && layout.maxIntrinsicWidth(tree, 1, 100) == 50, "Row 四查询宽度错误");
        check(layout.minIntrinsicHeight(tree, 1, 100) == 40 && layout.maxIntrinsicHeight(tree, 1, 100) == 40, "Row 四查询高度错误");
        check(!tree.node(1).measurementValid && tree.node(1).bounds == Rect{} && layout.counters().measuredNodes == 0, "固有查询污染正式测量");
        LayoutModifierSemantics intrinsic;
        intrinsic.kind = LayoutModifierKind::IntrinsicHeight;
        tree.setModifierChain(1, {{intrinsic}});
        layout.layout(tree, 1, {0, 100, 0, 100});
        check(tree.node(1).bounds == Rect{0, 0, 50, 40}, "IntrinsicSize Modifier 没有正式约束");
        layout.layout(tree, 1, {0, 0, 0, 0});
        check(tree.node(1).bounds.width == 0 && tree.node(1).bounds.height == 0, "零约束被当成无界");
        bool rejected = false;
        try {
            layout.layout(tree, 1, {1, 0, 0, 20});
        } catch (const std::invalid_argument&) {
            rejected = true;
        }
        check(rejected, "非法约束未拒绝");
        TextModifier text;
        text.text = "wide small words";
        tree.setModifierChain(2, {{text}});
        const auto minimum = layout.minIntrinsicWidth(tree, 2, Constraints::Infinity), maximum = layout.maxIntrinsicWidth(tree, 2, Constraints::Infinity);
        check(minimum > 0 && maximum > minimum, "文本最小与最大固有宽度未区分");
        check(layout.minIntrinsicHeight(tree, 2, 0) > layout.minIntrinsicHeight(tree, 2, Constraints::Infinity), "文本零宽度与无界未区分");
        LayoutModifierSemantics padding;
        padding.padding = {3, 4, 5, 6};
        tree.setModifierChain(2, {{padding}, {text}});
        check(near(layout.maxIntrinsicWidth(tree, 2, 100), maximum + 8), "固有宽度遗漏 padding");
        LayoutModifierSemantics range;
        range.kind = LayoutModifierKind::WidthIn;
        range.minWidth = range.maxWidth = 50;
        const auto heightAt50 = layout.minIntrinsicHeight(tree, 2, 50);
        tree.setModifierChain(2, {{range}, {padding}, {text}});
        check(near(layout.minIntrinsicHeight(tree, 2, 0), heightAt50), "另一轴范围未参与固有查询");
        tree.setModifierChain(2, {{text}});
        tree.setModifierChain(3, {size(30, 40)});
        tree.setModifierChain(1, {});
        layout.layout(tree, 1, {0, 0, 0, 200});
        check(tree.node(2).bounds.width == 0 && tree.node(3).bounds.width == 0 && tree.node(2).bounds.height > layout.minIntrinsicHeight(tree, 2, Constraints::Infinity), "Row 正式测量未传真实零主轴约束");
        check(layout.minIntrinsicHeight(tree, 1, 0) >= tree.node(2).bounds.height, "Row 固有交叉尺寸遗漏主轴分配");
        LayoutModifierSemantics required;
        required.kind = LayoutModifierKind::RequiredWidth;
        required.value = 50;
        tree.setModifierChain(2, {{required}, size(20, 10)});
        tree.node(1).measurePolicy = RowMeasurePolicy{{"Start", 5}};
        tree.node(1).measurementValid = false;
        layout.layout(tree, 1, {0, 40, 0, 100});
        check(tree.node(1).bounds.width == 40 && tree.node(2).bounds.width == 35 && tree.node(3).bounds.width == 0 && tree.node(2).contentBounds.width == 50, "有界 Row 的 gap 或 required 强制尺寸处理错误");
    }

    void matchingBox() {
        LayoutTree tree;
        children(tree, 2);
        tree.node(1).measurePolicy = BoxMeasurePolicy{};
        tree.setModifierChain(2, {size(20, 10)});
        ParentDataModifierSemantics match;
        match.kind = ParentDataKind::MatchParentSize;
        tree.setModifierChain(3, {{match}, size(200, 100)});
        LayoutEngine layout;
        check(layout.maxIntrinsicWidth(tree, 1, 100) == 20 && layout.maxIntrinsicHeight(tree, 1, 100) == 10, "matchParentSize 参与了 Box 固有尺寸");
        layout.layout(tree, 1, {0, 300, 0, 200});
        check(tree.node(1).bounds == Rect{0, 0, 20, 10} && tree.node(3).bounds == Rect{0, 0, 20, 10} && layout.counters().measuredNodes == 3, "matchParentSize 未在 Box 尺寸确定后仅测量一次");
        tree.node(1).measurePolicy = RowMeasurePolicy{};
        tree.node(1).measurementValid = false;
        bool rejected = false;
        try {
            layout.layout(tree, 1, {0, 300, 0, 200});
        } catch (const std::invalid_argument&) {
            rejected = true;
        }
        check(rejected, "matchParentSize 非 Box 使用未诊断");
        ParentDataModifierSemantics alignment;
        alignment.kind = ParentDataKind::Align;
        alignment.align = "Start";
        tree.setModifierChain(3, {{alignment}, size(20, 10)});
        rejected = false;
        try {
            layout.layout(tree, 1, {0, 300, 0, 200});
        } catch (const std::invalid_argument&) {
            rejected = true;
        }
        check(rejected, "Row 水平 align 未给出方向诊断");
        tree.node(1).measurePolicy = BoxMeasurePolicy{};
        tree.node(1).measurementValid = false;
        ParentDataModifierSemantics weight;
        weight.weight = 1;
        tree.setModifierChain(3, {{weight}, size(20, 10)});
        rejected = false;
        try {
            layout.layout(tree, 1, {0, 300, 0, 200});
        } catch (const std::invalid_argument&) {
            rejected = true;
        }
        check(rejected, "Box weight 未给出 Scope 诊断");
    }

    void flow() {
        LayoutTree tree;
        children(tree, 4);
        for (NodeId id = 2; id <= 5; ++id) tree.setModifierChain(id, {size(30, 10)});
        FlowMeasurePolicy policy;
        policy.mainArrangement.spacing = 5;
        policy.crossArrangement.spacing = 7;
        tree.node(1).measurePolicy = policy;
        LayoutEngine layout;
        layout.layout(tree, 1, {0, 70, 0, 200});
        check(tree.node(1).flowLines.size() == 2 && tree.node(1).bounds.width == 65 && tree.node(1).bounds.height == 27, "FlowRow 换行/间距错误");
        check(tree.node(4).bounds.x == 0 && tree.node(4).bounds.y == 17 && layout.counters().measuredNodes == 5, "Flow 重复正式测量或放置错误");
        check(layout.minIntrinsicWidth(tree, 1, Constraints::Infinity) == 30 && near(layout.minIntrinsicWidth(tree, 1, 27), 65), "Flow 最小固有主轴错误");
        check(layout.minIntrinsicHeight(tree, 1, 70) == 27 && layout.maxIntrinsicHeight(tree, 1, 70) == 27, "Flow 固有换行未保持两查询一致");
        ParentDataModifierSemantics weight;
        weight.weight = 1;
        tree.setModifierChain(2, {{weight}, size(20, 10)});
        weight.weight = 2;
        tree.setModifierChain(3, {{weight}, size(20, 10)});
        policy.maxItems = 2;
        tree.node(1).measurePolicy = policy;
        tree.node(1).measurementValid = false;
        layout.layout(tree, 1, {0, 95, 0, 200});
        check(near(tree.node(2).bounds.width, 30) && near(tree.node(3).bounds.width, 60), "Flow weight 没有按行分配");
        weight.weightFill = false;
        weight.weight = 1;
        tree.setModifierChain(2, {{weight}, size(20, 10)});
        weight.weight = 2;
        tree.setModifierChain(3, {{weight}, size(20, 10)});
        layout.layout(tree, 1, {0, 95, 0, 200});
        check(tree.node(2).bounds.width == 20 && tree.node(3).bounds.width == 20 && tree.node(1).bounds.width == 65, "Flow weight fill=false 未保持自然尺寸");
        layout.layout(tree, 1, {0, Constraints::Infinity, 0, 200});
        check(tree.node(1).flowLines.size() == 2 && tree.node(1).bounds.width == 65, "无界 Flow 按数量换行或 weight 自然尺寸错误");
        policy.horizontal = false;
        policy.mainArrangement = {"Top", 5};
        policy.crossArrangement = {"Start", 7};
        policy.itemAlignment = "Start";
        tree.node(1).measurePolicy = policy;
        tree.node(1).measurementValid = false;
        tree.setModifierChain(2, {size(30, 10)});
        tree.setModifierChain(3, {size(30, 10)});
        layout.layout(tree, 1, {0, 200, 0, 30});
        check(tree.node(1).bounds.width == 67 && tree.node(1).bounds.height == 25 && tree.node(4).bounds.x == 37, "FlowColumn 对称布局错误");
    }

    void repeatedSize() {
        SizeAnimation animation;
        AnimationSpec spec;
        spec.kind = AnimationKind::Tween;
        spec.durationMillis = 100;
        spec.delayMillis = 20;
        spec.bezier = {0, 0, 1, 1};
        spec.iterations = 2;
        spec.reverse = true;
        animation.update({0, 0}, spec, 0);
        animation.update({10, 20}, spec, 0);
        check(near(animation.update({10, 20}, spec, 70).width, 5), "repeatable 首周期错误");
        check(near(animation.update({10, 20}, spec, 130).width, 10), "reverse delay 没有保持周期端点");
        check(near(animation.update({10, 20}, spec, 190).width, 5), "reverse 次周期错误");
        check(animation.update({10, 20}, spec, 1000) == Size{10, 20} && !animation.running, "reverse 偶数终点未抵达逻辑目标");
        spec.reverse = false;
        spec.iterations = 3;
        animation.update({30, 60}, spec, 1000);
        check(animation.update({30, 60}, spec, 2000) == Size{30, 60} && !animation.running, "restart 跳帧终点错误");
    }
}

int main() {
    try {
        intrinsicAndBounds();
        matchingBox();
        flow();
        repeatedSize();
        std::cout << "M3 固有尺寸、约束、Flow 与有限重复动画通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
