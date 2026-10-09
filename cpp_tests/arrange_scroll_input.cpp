#include "JuceTestApplication.h"
#include <arrange/core/Layout.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/JucePointerInputAdapter.h>
#include <arrange/juce/PointerInputState.h>
#include <arrange/juce/RuntimeSessionState.h>
#include <arrange/juce/VBlankSource.h>
#include <arrange/juce/WheelInput.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <vector>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    bool near(float a, float b) {
        return std::abs(a - b) < 0.00001f;
    }

    LayoutModifierSemantics fixedSize(float width, float height) {
        LayoutModifierSemantics result;
        result.kind = LayoutModifierKind::Size;
        result.width = width;
        result.height = height;
        return result;
    }

    LayoutModifierSemantics scroll(bool vertical, NodeId node, float value = 0) {
        LayoutModifierSemantics result;
        result.kind = vertical ? LayoutModifierKind::VerticalScroll : LayoutModifierKind::HorizontalScroll;
        result.scrollValue = value;
        result.eventSlot = makeEventSlotId(node, vertical ? EventSlotKind::VerticalScroll : EventSlotKind::HorizontalScroll);
        return result;
    }

    SetPropMutation boxPolicy(NodeId node) {
        return {node, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Box")}})};
    }

    void makeSingleScroll(LayoutTree& tree, bool vertical, float value = 0) {
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, boxPolicy(1), CreateNodeMutation{2, NodeType::Layout}, boxPolicy(2), SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {scroll(vertical, 1, value), "scroll"}}}, SetModifierMutation{2, {{fixedSize(vertical ? 100 : 400, vertical ? 400 : 100), "content"}}}, InsertChildMutation{1, 2, 0}});
        LayoutEngine{}.layout(tree, 1, {0, 500, 0, 500});
    }

    void setSingleScrollValue(LayoutTree& tree, bool vertical, float value) {
        tree.apply({SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {scroll(vertical, 1, value), "scroll"}}}});
        LayoutEngine{}.place(tree, 1);
    }

    void verifySingleAxisRouting() {
        LayoutTree vertical;
        makeSingleScroll(vertical, true);
        arrange::juce::PointerInputState pointer;
        auto result = pointer.wheel(vertical, 1, {20, 20}, 1, -213, 1, 1);
        check(!result.horizontal && result.scroll.consumed && result.scroll.target == 1 && near(result.scroll.value, 213), "纵向精细滚动被微小横向噪声阻断");
        pointer.reset();
        result = pointer.wheel(vertical, 1, {20, 20}, -100, -2, 1, 1);
        check(!result.horizontal && result.scroll.consumed && near(result.scroll.value, 2), "只支持纵向的命中链没有回退到有效纵向分量");
        pointer.reset();
        result = pointer.wheel(vertical, 1, {20, 20}, -100, 0, 1, 1);
        check(!result.scroll.consumed, "纯横向输入被擅自转换为纵向位移");
        pointer.reset();
        result = pointer.wheel(vertical, 1, {20, 20}, 0, 0, 1, 1);
        check(!result.scroll.consumed, "零位移制造了滚动");

        LayoutTree horizontal;
        makeSingleScroll(horizontal, false);
        pointer.reset();
        result = pointer.wheel(horizontal, 1, {20, 20}, -213, 1, 1, 1);
        check(result.horizontal && result.scroll.consumed && result.scroll.target == 1 && near(result.scroll.value, 213), "横向精细滚动被微小纵向噪声阻断");
        pointer.reset();
        result = pointer.wheel(horizontal, 1, {20, 20}, -2, -100, 1, 1);
        check(result.horizontal && result.scroll.consumed && near(result.scroll.value, 2), "只支持横向的命中链没有回退到有效横向分量");
        pointer.reset();
        result = pointer.wheel(horizontal, 1, {20, 20}, 0, -100, 1, 1);
        check(!result.scroll.consumed, "纯纵向输入被擅自转换为横向位移");
    }

    void verifyPrecisionAndPublication() {
        LayoutTree tree;
        makeSingleScroll(tree, true);
        arrange::juce::PointerInputState pointer;
        const auto first = pointer.wheel(tree, 1, {20, 20}, 0, -0.125f, 1, 1);
        const auto second = pointer.wheel(tree, 1, {20, 20}, 0, -0.125f, 1, 1);
        check(first.scroll.consumed && second.scroll.consumed && near(first.scroll.value, 0.125f) && near(second.scroll.value, 0.25f), "同帧亚像素输入被取整或丢失累计量");
        check(ScrollDispatcher::verticalScrollValue(tree.node(1)) == 0 && tree.node(2).bounds.y == 0, "输入预测提前修改了已发布的滚动几何");
        setSingleScrollValue(tree, true, second.scroll.value);
        const auto next = pointer.wheel(tree, 1, {20, 20}, 0, -0.125f, 2, 1);
        check(near(next.scroll.value, 0.375f), "新发布没有从已提交滚动值继续累计");
        pointer.reset();
        check(near(pointer.wheel(tree, 1, {20, 20}, 0, -0.125f, 2, 1).scroll.value, 0.375f), "重置后复用了旧滚动预测");

        LayoutTree mouse;
        makeSingleScroll(mouse, true);
        pointer.reset();
        const auto mouseFirst = pointer.wheel(mouse, 1, {20, 20}, 0, -1, 1);
        const auto mouseSecond = pointer.wheel(mouse, 1, {20, 20}, 0, -1, 1);
        check(mouseFirst.scroll.value == 48 && mouseSecond.scroll.value == 96, "离散鼠标滚轮的步长或同帧累计行为发生变化");
        setSingleScrollValue(mouse, true, mouseSecond.scroll.value);
        check(pointer.wheel(mouse, 1, {20, 20}, 0, -1, 2).scroll.value == 144, "鼠标滚轮发布后没有从已提交值继续滚动");
    }

    void makeCrossAxisScroll(LayoutTree& tree, float horizontalValue = 0, float verticalValue = 0) {
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, boxPolicy(1), CreateNodeMutation{2, NodeType::Layout}, boxPolicy(2), CreateNodeMutation{3, NodeType::Layout}, boxPolicy(3), SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {scroll(false, 1, horizontalValue), "horizontal"}}}, SetModifierMutation{2, {{fixedSize(400, 100), "viewport"}, {scroll(true, 2, verticalValue), "vertical"}}}, SetModifierMutation{3, {{fixedSize(400, 400), "content"}}}, InsertChildMutation{1, 2, 0}, InsertChildMutation{2, 3, 0}});
        LayoutEngine{}.layout(tree, 1, {0, 500, 0, 500});
    }

    void verifyCrossAxisRoutingAndBoundaries() {
        LayoutTree tree;
        makeCrossAxisScroll(tree);
        arrange::juce::PointerInputState pointer;
        auto result = pointer.wheel(tree, 1, {20, 20}, -1, -20, 1, 1);
        check(!result.horizontal && result.scroll.consumed && result.scroll.target == 2 && near(result.scroll.value, 20), "交叉轴嵌套没有把纵向主量交给纵向子容器");
        pointer.reset();
        result = pointer.wheel(tree, 1, {20, 20}, -20, -1, 1, 1);
        check(result.horizontal && result.scroll.consumed && result.scroll.target == 1 && near(result.scroll.value, 20), "交叉轴嵌套没有把横向主量交给横向父容器");
        pointer.reset();
        result = pointer.wheel(tree, 1, {20, 20}, -10, -10, 1, 1);
        check(!result.horizontal && result.scroll.target == 2 && near(result.scroll.value, 10), "相等的双轴输入没有保持纵向优先");

        LayoutTree verticalBoundary;
        makeCrossAxisScroll(verticalBoundary, 0, 300);
        pointer.reset();
        result = pointer.wheel(verticalBoundary, 1, {20, 20}, -1, -20, 1, 1);
        check(!result.horizontal && !result.scroll.consumed && result.scroll.target == 2 && result.scroll.value == 300, "纵向子容器到边界后误将横向噪声交给父容器");
        LayoutTree horizontalBoundary;
        makeCrossAxisScroll(horizontalBoundary, 300, 0);
        pointer.reset();
        result = pointer.wheel(horizontalBoundary, 1, {20, 20}, -20, -1, 1, 1);
        check(result.horizontal && !result.scroll.consumed && result.scroll.target == 1 && result.scroll.value == 300, "横向父容器到边界后误将纵向噪声交给子容器");
    }

    void verifySameAxisBoundaryHandoff() {
        LayoutTree tree;
        auto outer = scroll(true, 1);
        auto inner = scroll(true, 1, 200);
        outer.eventSlot = makeEventSlotId(1, EventSlotKind::VerticalScroll, "outer");
        inner.eventSlot = makeEventSlotId(1, EventSlotKind::VerticalScroll, "inner");
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, boxPolicy(1), SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {outer, "outer"}, {fixedSize(100, 200), "inner-viewport"}, {inner, "inner"}, {fixedSize(100, 400), "content"}}}});
        LayoutEngine{}.layout(tree, 1, {0, 500, 0, 500});
        arrange::juce::PointerInputState pointer;
        const auto result = pointer.wheel(tree, 1, {20, 20}, 1, -40, 1, 1);
        check(!result.horizontal && result.scroll.consumed && result.scroll.eventSlot.path == "outer" && near(result.scroll.value, 40), "同向子容器完全到边界后的父容器接续行为退化");
    }

    void makeNestedScroll(LayoutTree& tree, float outerValue = 0, float innerValue = 0) {
        auto outer = scroll(true, 1, outerValue);
        auto inner = scroll(true, 1, innerValue);
        outer.eventSlot.path = "outer";
        inner.eventSlot.path = "inner";
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, boxPolicy(1), SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {outer, "outer"}, {fixedSize(100, 200), "inner-viewport"}, {inner, "inner"}, {fixedSize(100, 400), "content"}}}});
        LayoutEngine{}.layout(tree, 1, {0, 500, 0, 500});
    }

    void setTargetValue(LayoutTree& tree, const ScrollTarget& target, float value) {
        auto input = std::get<LayoutModifierSemantics>(tree.node(target.node).modifier.find(target.modifier)->descriptor.value);
        input.scrollValue = value;
        tree.setModifierInput(target.node, target.modifier, input);
        LayoutEngine{}.place(tree, 1);
    }

    arrange::juce::WheelInput sessionWheel(float deltaX, float deltaY, double timeMillis, arrange::juce::WheelPhase phase = arrange::juce::WheelPhase::None, arrange::juce::WheelPhase momentum = arrange::juce::WheelPhase::None, bool nativePhases = false) {
        arrange::juce::WheelInput input;
        input.deltaX = deltaX;
        input.deltaY = deltaY;
        input.timeMillis = timeMillis;
        input.phase = phase;
        input.momentumPhase = momentum;
        input.precise = true;
        input.inertial = momentum != arrange::juce::WheelPhase::None;
        input.nativePhases = nativePhases;
        return input;
    }

    void verifyCancelledWheelBurst() {
        using namespace arrange::juce;
        LayoutTree tree;
        makeNestedScroll(tree);
        PointerInputState pointer;
        const auto first = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -5, 0), 1);
        pointer.cancelWheel();
        for (double timestamp : {50, 100, 150, 200, 250, 310, 360}) {
            const auto remaining = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -5, timestamp), 1);
            check(!remaining.scroll.consumed && !remaining.locked && remaining.sessionId == first.sessionId, "取消后的连续拨轮在没有静默间隔时重新命中了容器");
        }
        const auto next = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -5, 661), 1);
        check(next.sessionStarted && next.locked && next.sessionId != first.sessionId, "取消后的滚轮静默间隔没有开始新会话");
    }

    void verifySceneResetCancelsGesture() {
        using namespace arrange::juce;
        LayoutTree tree;
        makeSingleScroll(tree, true);
        PointerInputState pointer;
        const auto first = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -5, 0, WheelPhase::Began, WheelPhase::None, true), 1);
        pointer.resetForSceneChange();
        const auto remainder = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -5, 100, WheelPhase::Changed, WheelPhase::None, true), 2);
        check(!remainder.locked && !remainder.scroll.consumed && remainder.sessionId == first.sessionId, "reload 后旧手势重新命中了新场景");
        const auto next = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -5, 200, WheelPhase::Began, WheelPhase::None, true), 2);
        check(next.sessionStarted && next.locked && next.scroll.value == 5, "reload 后新手势不能从新的已发布值开始");
    }

    void verifyNormalizedWheelUnits() {
        using namespace arrange::juce;
        LayoutTree tree;
        makeSingleScroll(tree, true);
        PointerInputState pointer;
        auto input = sessionWheel(0, -0.125f, 0);
        input.unitY = WheelUnit::Lines;
        const auto line = pointer.wheel(tree, 1, {20, 20}, input, 1);
        input.timeMillis = 10;
        const auto nextLine = pointer.wheel(tree, 1, {20, 20}, input, 1);
        check(near(line.scroll.value, 2) && near(nextLine.scroll.value, 4), "小轮行增量没有保留分数并按框架行距累计");
        pointer.reset();
        input.unitY = WheelUnit::Pages;
        input.deltaY = -0.5f;
        const auto page = pointer.wheel(tree, 1, {20, 20}, input, 1);
        check(near(page.scroll.value, 50), "整页滚动没有采用锁定目标的视口尺寸");
        pointer.reset();
        input.deltaY = 0;
        check(!pointer.wheel(tree, 1, {20, 20}, input, 1).scroll.consumed, "系统禁用滚轮后零位移仍产生滚动");
    }

    void verifyTargetDispatchAndHitPath() {
        LayoutTree crossed;
        makeCrossAxisScroll(crossed);
        const auto path = ScrollDispatcher::hitPath(crossed, 1, {20, 20});
        check(path.size() == 2 && path[0].node == 1 && path[0].horizontal && path[1].node == 2 && !path[1].horizontal, "初始命中路径没有按外到内保留两个轴的滚动实例");
        const auto inner = path.back();
        const auto first = ScrollDispatcher::targetWheel(crossed, inner, -0.125f, 1);
        PendingScrollValues pending{{inner.modifier.identity, first.value}};
        const auto second = ScrollDispatcher::targetWheel(crossed, inner, -0.125f, 1, &pending);
        check(first.consumed && second.consumed && near(first.value, 0.125f) && near(second.value, 0.25f), "固定目标派发没有保留亚像素预测累计");
        check(ScrollDispatcher::verticalScrollValue(crossed.node(2)) == 0, "固定目标派发提前修改了已发布树");
        auto stale = inner;
        ++stale.modifier.generation;
        check(!ScrollDispatcher::targetWheel(crossed, stale, -1, 1).target, "固定目标派发接受了退休的 Modifier 代际");
        auto wrongAxis = inner;
        wrongAxis.horizontal = true;
        check(!ScrollDispatcher::targetWheel(crossed, wrongAxis, -1, 1).target, "固定目标派发接受了不匹配的滚动轴");
        setTargetValue(crossed, inner, 300);
        const auto blocked = ScrollDispatcher::targetWheel(crossed, inner, -20, 1);
        check(!blocked.consumed && blocked.target == 2 && blocked.modifier == inner.modifier && blocked.value == 300, "固定目标到边界后丢失身份或擅自交给父容器");
        crossed.apply({SetPropMutation{1, "enabled", PropValue::booleanValue(false)}});
        check(!ScrollDispatcher::targetWheel(crossed, inner, 1, 1).target && ScrollDispatcher::hitPath(crossed, 1, {20, 20}).empty(), "固定目标没有检查祖先的 enabled");
        crossed.apply({SetPropMutation{1, "enabled", PropValue::booleanValue(true)}});
        auto disabled = std::get<LayoutModifierSemantics>(crossed.node(2).modifier.find(inner.modifier)->descriptor.value);
        disabled.enabled = false;
        crossed.setModifierInput(2, inner.modifier, disabled);
        check(!ScrollDispatcher::targetWheel(crossed, inner, 1, 1).target, "固定目标没有检查滚动 Modifier 的 enabled");
        crossed.apply({DeleteNodeMutation{2}});
        check(!ScrollDispatcher::targetWheel(crossed, inner, 1, 1).target, "已删除的固定目标仍可接收滚动");

        LayoutTree clipped;
        PaintStyleSemantics circle;
        circle.shapeType = "circle";
        clipped.apply({CreateNodeMutation{1, NodeType::Layout}, boxPolicy(1), SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {ClipModifier{circle}, "clip"}, {scroll(true, 1), "scroll"}, {fixedSize(100, 400), "content"}}}});
        LayoutEngine{}.layout(clipped, 1, {0, 500, 0, 500});
        check(ScrollDispatcher::hitPath(clipped, 1, {1, 1}).empty() && ScrollDispatcher::hitPath(clipped, 1, {50, 50}).size() == 1, "滚动初始命中路径忽略了 Modifier clip");
        TransformModifierSemantics translated;
        translated.translationX = 200;
        clipped.apply({SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {translated, "transform"}, {scroll(true, 1), "scroll"}, {fixedSize(100, 400), "content"}}}});
        LayoutEngine{}.layout(clipped, 1, {0, 500, 0, 500});
        check(ScrollDispatcher::hitPath(clipped, 1, {20, 20}).empty() && ScrollDispatcher::hitPath(clipped, 1, {220, 20}).size() == 1, "滚动初始命中路径没有沿 graphicsLayer 逆变换坐标");

        LayoutTree overlapping;
        overlapping.apply({CreateNodeMutation{1, NodeType::Layout}, boxPolicy(1), CreateNodeMutation{2, NodeType::Layout}, boxPolicy(2), CreateNodeMutation{3, NodeType::Layout}, boxPolicy(3), SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}}}, SetModifierMutation{2, {{fixedSize(100, 100), "viewport"}, {scroll(true, 2), "vertical"}, {fixedSize(100, 300), "content"}}}, SetModifierMutation{3, {{ZIndexModifier{2}, "z"}, {fixedSize(100, 100), "viewport"}, {scroll(false, 3), "horizontal"}, {fixedSize(300, 100), "content"}}}, InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}});
        LayoutEngine{}.layout(overlapping, 1, {0, 500, 0, 500});
        const auto topPath = ScrollDispatcher::hitPath(overlapping, 1, {20, 20});
        check(topPath.size() == 1 && topPath.front().node == 3 && topPath.front().horizontal, "滚动命中路径混入了被高 zIndex 分支遮挡的容器");
        overlapping.apply({SetPropMutation{3, "enabled", PropValue::booleanValue(false)}});
        const auto lowerPath = ScrollDispatcher::hitPath(overlapping, 1, {20, 20});
        check(lowerPath.size() == 1 && lowerPath.front().node == 2 && !lowerPath.front().horizontal, "禁用的上层节点阻断了有效滚动命中分支");
    }

    void verifyLockedSessionBoundaries() {
        using arrange::juce::WheelPhase;
        LayoutTree tree;
        makeNestedScroll(tree, 0, 199);
        const auto path = ScrollDispatcher::hitPath(tree, 1, {20, 20});
        check(path.size() == 2 && path[0].modifier != path[1].modifier, "同节点的两个滚动实例没有独立目标身份");
        arrange::juce::PointerInputState pointer;
        const auto first = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -5, 0, WheelPhase::Began, WheelPhase::None, true), 1);
        check(first.locked && first.sessionStarted && first.scroll.eventSlot.path == "inner" && first.scroll.value == 200, "手势没有锁定起始仍能移动的最内层实例");
        const auto boundary = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -20, 10, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(boundary.locked && boundary.sessionId == first.sessionId && !boundary.scroll.consumed && boundary.scroll.eventSlot.path == "inner", "手势中途到边界后串给了父容器");
        const auto reverse = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, 5, 20, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(reverse.scroll.eventSlot.path == "inner" && reverse.scroll.value == 195, "同一手势反向没有继续移动原目标");
        setTargetValue(tree, path.back(), 200);
        const auto newGesture = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -20, 30, WheelPhase::Began, WheelPhase::None, true), 2);
        check(newGesture.sessionStarted && newGesture.sessionId != first.sessionId && newGesture.scroll.eventSlot.path == "outer" && newGesture.scroll.value == 20, "起始已到边界没有重新选择能移动的同轴父容器");
        const auto parentReverse = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, 5, 40, WheelPhase::Changed, WheelPhase::None, true), 2);
        check(parentReverse.scroll.eventSlot.path == "outer" && parentReverse.scroll.value == 15, "父容器手势反向时被重新能动的子容器抢走");

        LayoutTree allBlocked;
        makeNestedScroll(allBlocked, 100, 200);
        pointer.reset();
        const auto blocked = pointer.wheel(allBlocked, 1, {20, 20}, sessionWheel(0, -5, 0, WheelPhase::Began, WheelPhase::None, true), 1);
        check(blocked.locked && !blocked.scroll.consumed && blocked.scroll.eventSlot.path == "outer", "全部到边界时没有锁定同轴最外层目标");
        const auto blockedReverse = pointer.wheel(allBlocked, 1, {20, 20}, sessionWheel(0, 5, 10, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(blockedReverse.scroll.eventSlot.path == "outer" && blockedReverse.scroll.value == 95, "全部到边界起手的反向滚动偷回了子容器");

        LayoutTree crossed;
        makeCrossAxisScroll(crossed);
        pointer.reset();
        const auto vertical = pointer.wheel(crossed, 1, {20, 20}, sessionWheel(-1, -20, 0, WheelPhase::Began, WheelPhase::None, true), 1);
        const auto horizontalNoise = pointer.wheel(crossed, 1, {20, 20}, sessionWheel(-100, -1, 10, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(vertical.locked && !vertical.horizontal && horizontalNoise.locked && !horizontalNoise.horizontal && horizontalNoise.scroll.target == 2 && horizontalNoise.scroll.value == 21, "同手势次轴变成主量后切换了锁定轴或目标");
    }

    void makeMovingScroll(LayoutTree& tree) {
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, boxPolicy(1), CreateNodeMutation{2, NodeType::Layout}, boxPolicy(2), CreateNodeMutation{3, NodeType::Layout}, boxPolicy(3), CreateNodeMutation{4, NodeType::Layout}, boxPolicy(4), SetModifierMutation{1, {{fixedSize(100, 100), "viewport"}, {scroll(true, 1), "outer"}}}, SetModifierMutation{2, {{fixedSize(100, 500), "content"}}}, SetModifierMutation{3, {{OffsetModifier{0, 200}, "offset"}, {fixedSize(100, 100), "viewport"}, {scroll(true, 3), "inner"}}}, SetModifierMutation{4, {{fixedSize(100, 400), "content"}}}, InsertChildMutation{1, 2, 0}, InsertChildMutation{2, 3, 0}, InsertChildMutation{3, 4, 0}});
        LayoutEngine{}.layout(tree, 1, {0, 500, 0, 500});
    }

    void verifyFrozenInitialHitAndPublishedGeometry() {
        using arrange::juce::WheelPhase;
        LayoutTree tree;
        makeMovingScroll(tree);
        const auto initial = ScrollDispatcher::hitPath(tree, 1, {20, 20});
        check(initial.size() == 1 && initial.front().node == 1, "移动目标夹具的内层容器起始不应在指针下");
        arrange::juce::PointerInputState pointer;
        const auto began = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, 0, 0, WheelPhase::Began, WheelPhase::None, true), 1);
        check(began.sessionStarted && !began.locked && !began.scroll.consumed, "零位移 began 提前选择目标或产生滚动");
        const auto first = pointer.wheel(tree, 1, {20, 250}, sessionWheel(0, -200, 10, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(first.locked && first.scroll.target == 1 && first.scroll.value == 200, "方向确认时重用了移动后的指针位置而非起始命中链");
        setTargetValue(tree, initial.front(), 200);
        const auto moved = ScrollDispatcher::hitPath(tree, 1, {20, 20});
        check(moved.size() == 2 && moved.back().node == 3, "父滚动没有把内层容器带到指针下，夹具无效");
        const auto afterPublish = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -1, 20, WheelPhase::Changed, WheelPhase::None, true), 2);
        check(afterPublish.scroll.target == 1 && afterPublish.scroll.value == 201 && afterPublish.sessionId == first.sessionId, "新发布或子容器经过指针改变了手势锁定目标");
        setTargetValue(tree, initial.front(), afterPublish.scroll.value);
        tree.setModifierInput(1, tree.node(1).modifier.elements().front().handle, fixedSize(100, 80));
        LayoutEngine{}.layout(tree, 1, {0, 500, 0, 500});
        const auto resized = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -1, 30, WheelPhase::Changed, WheelPhase::None, true), 3);
        check(resized.scroll.target == 1 && resized.scroll.value == 202 && resized.sessionId == first.sessionId, "视口 resize 重置或重新命中了手势目标");

        pointer.reset();
        const auto outside = pointer.wheel(tree, 1, {150, 20}, sessionWheel(0, 0, 40, WheelPhase::Began, WheelPhase::None, true), 3);
        const auto entered = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -10, 50, WheelPhase::Changed, WheelPhase::None, true), 3);
        check(outside.sessionStarted && !entered.scroll.target && !entered.scroll.consumed, "初始命中链为空的手势经过容器时突然被接管");

        LayoutTree vertical;
        makeSingleScroll(vertical, true);
        pointer.reset();
        const auto noise = pointer.wheel(vertical, 1, {20, 20}, sessionWheel(1, 0, 0, WheelPhase::Began, WheelPhase::None, true), 1);
        const auto directed = pointer.wheel(vertical, 1, {20, 20}, sessionWheel(1, -20, 10, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(!noise.locked && !noise.scroll.target && directed.locked && !directed.horizontal && directed.scroll.value == 20 && directed.sessionId == noise.sessionId, "起始横向噪声把纵向手势锁成了无目标");
    }

    void verifyGestureAndMomentumLifecycle() {
        using arrange::juce::WheelPhase;
        LayoutTree tree;
        makeNestedScroll(tree);
        arrange::juce::PointerInputState pointer;
        const auto first = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -20, 0, WheelPhase::Began, WheelPhase::None, true), 1);
        const auto paused = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -20, 2000, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(paused.sessionId == first.sessionId && paused.scroll.eventSlot.path == "inner" && paused.scroll.value == 40, "有真实 phase 的手势暂停超过 300ms 后被错误切组");
        const auto ended = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, 0, 2010, WheelPhase::Ended, WheelPhase::None, true), 1);
        check(ended.locked && !ended.scroll.consumed, "手指 ended 提前解除惯性将要使用的目标");
        const auto inertia = pointer.wheel(tree, 1, {20, 250}, sessionWheel(0, -20, 2020, WheelPhase::None, WheelPhase::Began, true), 1);
        check(inertia.sessionId == first.sessionId && inertia.scroll.eventSlot.path == "inner" && inertia.scroll.value == 60, "惯性没有延续原手势目标");
        const auto nextBegin = pointer.wheel(tree, 1, {20, 20}, sessionWheel(-20, 0, 2030, WheelPhase::Began, WheelPhase::None, true), 1);
        check(nextBegin.sessionStarted && nextBegin.sessionId != first.sessionId && !nextBegin.locked, "新 began 没有立即打断旧惯性");
        const auto next = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -20, 2040, WheelPhase::Changed, WheelPhase::None, true), 1);
        check(next.locked && next.scroll.eventSlot.path == "inner" && next.scroll.value == 80, "新手势没有从未发布的累计值继续移动");
        const auto momentumEnd = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, 0, 2050, WheelPhase::None, WheelPhase::Ended, true), 1);
        check(!momentumEnd.locked && !momentumEnd.scroll.consumed, "momentum ended 没有结束锁定或制造了额外惯性");

        pointer.reset();
        const auto cancelledStart = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -1, 3000, WheelPhase::Began, WheelPhase::None, true), 1);
        const auto cancelled = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, 0, 3010, WheelPhase::Cancelled, WheelPhase::None, true), 1);
        check(cancelledStart.locked && cancelled.sessionCancelled && !cancelled.locked, "原生 cancel 没有取消手势锁定");

        LayoutTree mouse;
        makeNestedScroll(mouse, 0, 199);
        pointer.reset();
        auto mouseInput = sessionWheel(0, -5, 0);
        mouseInput.precise = false;
        const auto mouseFirst = pointer.wheel(mouse, 1, {20, 20}, mouseInput, 1);
        mouseInput.timeMillis = 100;
        const auto mouseBoundary = pointer.wheel(mouse, 1, {20, 20}, mouseInput, 1);
        check(mouseBoundary.sessionId == mouseFirst.sessionId && !mouseBoundary.scroll.consumed && mouseBoundary.scroll.eventSlot.path == "inner", "无 phase 的滚轮组中途到边界串给了父容器");
        setTargetValue(mouse, ScrollDispatcher::hitPath(mouse, 1, {20, 20}).back(), 200);
        mouseInput.timeMillis = 401;
        const auto mouseGroup = pointer.wheel(mouse, 1, {20, 20}, mouseInput, 2);
        check(mouseGroup.sessionStarted && mouseGroup.sessionId != mouseFirst.sessionId && mouseGroup.scroll.eventSlot.path == "outer" && mouseGroup.scroll.value == 5, "无 phase 的滚轮空隙超过 300ms 后没有重新选择目标");
    }

    void verifyLockedTargetInvalidation() {
        using arrange::juce::WheelPhase;
        for (int change = 0; change != 3; ++change) {
            LayoutTree tree;
            makeNestedScroll(tree);
            arrange::juce::PointerInputState pointer;
            const auto first = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -1, 0, WheelPhase::Began, WheelPhase::None, true), 1);
            check(first.locked && first.scroll.eventSlot.path == "inner", "目标失效夹具没有先锁定内层容器");
            if (change == 0) {
                auto disabled = std::get<LayoutModifierSemantics>(tree.node(1).modifier.find(first.scroll.modifier)->descriptor.value);
                disabled.enabled = false;
                tree.setModifierInput(1, first.scroll.modifier, disabled);
            } else if (change == 1) {
                ModifierDescriptors descriptors;
                for (const auto& instance : tree.node(1).modifier.elements()) descriptors.push_back(instance.descriptor);
                descriptors.erase(descriptors.begin() + 3);
                tree.apply({SetModifierMutation{1, descriptors}});
            } else {
                tree.apply({DeleteNodeMutation{1}});
            }
            const auto invalid = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -10, 10, WheelPhase::Changed, WheelPhase::None, true), 2);
            check(invalid.sessionCancelled && !invalid.locked && !invalid.scroll.target && !invalid.scroll.consumed, "删除、禁用或退休目标后没有取消，而是串给了父容器");
            const auto remainder = pointer.wheel(tree, 1, {20, 20}, sessionWheel(0, -10, 20, WheelPhase::Changed, WheelPhase::None, true), 2);
            check(!remainder.scroll.target && !remainder.scroll.consumed, "已取消手势的剩余输入重新命中了父容器");
        }
    }

    void verifyAdapterCallbackAndManualFrame() {
        auto host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        const auto loaded = host->executeModule("滚动输入回归.js", R"JS(
const n = globalThis.__ARRANGE_NATIVE__
const state = {
    value: 0,
    __arrangeNativeScroll(snapshot) {
        if (state.value === snapshot.value) return
        state.value = snapshot.value
        n.setModifier(1, viewport())
        n.diagnosticsToast('i', '滚动回归', '滚动回调', [String(state.value)], false)
    }
}
function viewport() {
    return { elements: [{ type: 'size', value: { width: 100, height: 100 } }, { type: 'verticalScroll', key: 'scroll', value: { state } }] }
}
n.createNode(1, 'LayoutNode')
n.setProp(1, 'measurePolicy', { kind: 'Box' })
n.setModifier(1, viewport())
n.createNode(2, 'LayoutNode')
n.setProp(2, 'measurePolicy', { kind: 'Box' })
n.setModifier(2, { elements: [{ type: 'size', value: { width: 100, height: 400 } }, { type: 'background', value: { color: 0xff336699 } }] })
n.insertChild(1, 2, 0)
)JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        auto initial = host->takePendingTransaction();
        check(initial.has_value(), "滚动输入夹具没有创建原生初始事务");
        ApproximateTextMeasurer measurer;
        TextLayoutService text(measurer);
        arrange::juce::ArrangeRuntime runtime{SceneFramePipeline{LayoutEngine{text}}};
        runtime.enqueue(std::move(*initial));
        runtime.setScriptHost(std::move(host));
        arrange::juce::RuntimeSessionState session;
        session.resize(100, 100, runtime);
        session.markLoaded();
        arrange::juce::DiagnosticsState diagnostics;
        arrange::juce::InteractionStateOwner interaction(text);
        arrange::juce::JucePointerInputAdapter adapter;
        ::juce::Component component;
        const ::juce::MouseEvent event(::juce::Desktop::getInstance().getMainMouseSource(), {20, 20}, {}, 0, 0, 0, 0, 0, &component, &component, {}, {}, {}, 0, false);
        arrange::juce::ManualVBlankSource source;
        arrange::juce::VBlankFrameDriver driver(source);
        double time = 0;
        driver.start([&](double timestamp) {
            const auto frame = runtime.pumpFrame(1, session.constraints(), timestamp);
            if (!frame.ok) throw std::runtime_error(frame.error);
        });
        const auto tick = [&] {
            source.pulse(time += 16);
        };
        tick();
        check(runtime.scene().contains(2) && runtime.publishedFrame().content.scenePaint.fragment && ScrollDispatcher::verticalScrollValue(runtime.scene().node(1)) == 0, "滚动夹具首个授权帧没有发布完整场景");
        check(runtime.takeDiagnosticToasts().empty(), "初始范围反馈被当成实际滚动回调");

        const auto deliver = [&](const std::vector<::juce::MouseWheelDetails>& events, float expected) {
            const auto before = ScrollDispatcher::verticalScrollValue(runtime.scene().node(1));
            const auto revision = runtime.publishedFrame().revision;
            const auto snapshot = runtime.publishedFrame().content.hitTest;
            for (const auto& wheel : events) check(adapter.wheelMove(runtime, session, diagnostics, interaction, 1, event, wheel), "真实输入 adapter 未消费有效滚动");
            check(runtime.hasPendingEvents() && runtime.publishedFrame().revision == revision && runtime.publishedFrame().content.hitTest == snapshot && near(ScrollDispatcher::verticalScrollValue(runtime.scene().node(1)), before), "wheel 入队提前发布或修改了视觉几何");
            const auto semantic = runtime.semanticCheckpoint(time + 1);
            if (!semantic.ok) throw std::runtime_error(semantic.error);
            const auto callbacks = runtime.takeDiagnosticToasts();
            check(callbacks.size() == events.size() && near(std::stof(callbacks.back().content), expected), "真实 QuickJS 滚动回调丢失了精细输入或惯性累计值");
            check(!runtime.hasPendingEvents(), "语义检查点没有交付已入队的滚动事件");
            check(runtime.hasPendingIntents() && runtime.hasPendingFrameWork(), "滚动回调没有留下等待授权帧消费的提交意图");
            check(runtime.publishedFrame().revision == revision, "滚动语义回调提前发布了视觉帧");
            check(runtime.publishedFrame().content.hitTest == snapshot, "滚动语义回调提前替换了已发布命中快照");
            check(near(ScrollDispatcher::verticalScrollValue(runtime.scene().node(1)), before) && near(runtime.scene().node(2).bounds.y, -before), "滚动语义回调提前修改了已发布的内容几何");
            tick();
            check(runtime.publishedFrame().revision > revision && near(ScrollDispatcher::verticalScrollValue(runtime.scene().node(1)), expected) && near(runtime.scene().node(2).bounds.y, -expected), "滚动回调没有在手动 VBlank 中发布正确内容位置");
            const auto& regions = runtime.publishedFrame().content.hitTest->regions;
            const auto content = std::find_if(regions.begin(), regions.end(), [](const auto& region) { return region.target.node == 2; });
            check(content != regions.end() && near(content->bounds.y, -expected), "滚动后的已发布命中几何与内容位置不一致");
            check(runtime.takeDiagnosticToasts().empty() && !runtime.hasPendingFrameWork(), "布局反馈重复触发滚动或残留自主推进的帧任务");
            const auto settledRevision = runtime.publishedFrame().revision;
            tick();
            tick();
            check(runtime.publishedFrame().revision == settledRevision && near(ScrollDispatcher::verticalScrollValue(runtime.scene().node(1)), expected), "停止输入后框架自行生成了惯性或重复位移");
        };

#if JUCE_MAC
        constexpr float preciseScale = 512;
#else
        constexpr float preciseScale = 48;
#endif
        ::juce::MouseWheelDetails precise{};
        precise.deltaX = 0.03125f / preciseScale;
        precise.deltaY = -0.125f / preciseScale;
        precise.isSmooth = true;
        precise.isReversed = true;
        deliver({precise, precise}, 0.25f);
        precise.deltaX = 0;
        precise.isInertial = true;
        deliver({precise}, 0.375f);
        precise.deltaX = 1 / preciseScale;
        precise.deltaY = -213 / preciseScale;
        precise.isInertial = false;
        deliver({precise}, 213.375f);
        ::juce::MouseWheelDetails mouse{};
        mouse.deltaY = -1;
        deliver({mouse}, 261.375f);
        mouse.deltaY = 1;
        deliver({mouse}, 213.375f);
        mouse.isReversed = true;
        deliver({mouse}, 165.375f);
        ::juce::MouseWheelDetails zero{};
        zero.isSmooth = true;
        zero.isInertial = true;
        check(!adapter.wheelMove(runtime, session, diagnostics, interaction, 1, event, zero) && !runtime.hasPendingEvents(), "零惯性事件制造了新的滚动回调");
        tick();
        check(near(ScrollDispatcher::verticalScrollValue(runtime.scene().node(1)), 165.375f), "零惯性事件改变了已稳定滚动位置");
    }
}

int runScrollInput() {
    try {
        ::juce::ScopedJuceInitialiser_GUI juceInitialiser;
        verifySingleAxisRouting();
        verifyPrecisionAndPublication();
        verifyCrossAxisRoutingAndBoundaries();
        verifySameAxisBoundaryHandoff();
        verifyCancelledWheelBurst();
        verifySceneResetCancelsGesture();
        verifyNormalizedWheelUnits();
        verifyTargetDispatchAndHitPath();
        verifyLockedSessionBoundaries();
        verifyFrozenInitialHitAndPublishedGeometry();
        verifyGestureAndMomentumLifecycle();
        verifyLockedTargetInvalidation();
        verifyAdapterCallbackAndManualFrame();
        std::cout << "滚动输入：轴选择、目标锁定、手势与惯性、亚像素累计、边界、真实回调与手动帧发布通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}

using ScrollInputApplication = arrange::test::JuceTestApplication<runScrollInput>;
START_JUCE_APPLICATION(ScrollInputApplication)
