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
        const auto tick = [&] { source.pulse(time += 16); };
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
        verifyAdapterCallbackAndManualFrame();
        std::cout << "滚动输入：轴选择、亚像素累计、边界、真实回调与手动帧发布通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}

using ScrollInputApplication = arrange::test::JuceTestApplication<runScrollInput>;
START_JUCE_APPLICATION(ScrollInputApplication)
