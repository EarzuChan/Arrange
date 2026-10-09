#include "TextFixtures.h"
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

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

    void boundary() {
        arrange::quickjs::QuickJsScriptHost host;
        const auto loaded = host.executeModule("M3布局值边界.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            const reject = fn => { try { fn(); } catch { return; } throw new Error('无效布局值未拒绝'); }
            n.createNode(1, 'LayoutNode')
            n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'})
            n.createNode(2, 'LayoutNode')
            n.insertChild(1, 2, 0)
            const chain = elements => ({elements})
            const intrinsic = maximum => ({type: 'intrinsicWidth', value: {maximum}})
            reject(() => n.setModifier(2, chain([intrinsic('false')])))
            reject(() => n.setModifier(2, chain([{type: 'intrinsicWidth', value: {maximum: false, value: 10}}])))
            const spec = iterations => ({kind: 'tween', durationMillis: 100, delayMillis: 20, x1: 0, y1: 0, x2: 1, y2: 1, iterations, repeatMode: 'reverse'})
            const animation = value => ({type: 'animateContentSize', value: {animationSpec: value}})
            for (const count of [0, 1.5, Infinity, 2147483648]) reject(() => n.setModifier(2, chain([animation(spec(count))])))
            reject(() => n.setModifier(2, chain([animation({...spec(2), repeatMode: '未知'})])))
            reject(() => n.setModifier(2, chain([{type: 'matchParentSize', value: {width: 10}}])))
            n.setModifier(2, chain([intrinsic(false), animation(spec(2147483647)), {type: 'text', value: {text: 'wide small words'}}]))
        )JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        auto transaction = host.takePendingTransaction();
        check(transaction.has_value(), "typed 布局值未提交");
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto result = pipeline.run(scene, 1, {0, 300, 0, 200}, &*transaction, true, published);
        if (result.error) throw std::runtime_error(*result.error);
        host.publishScene(scene);
        check(host.completeRearrange(transaction->rearrange).ok, "typed 布局事务未完成");
        const auto& node = scene.node(2);
        check(std::get<LayoutModifierSemantics>(node.modifier.elements()[0].descriptor.value).kind == LayoutModifierKind::IntrinsicWidth && node.bounds.width > 0, "固有 Modifier 未经过 typed reader 和正式测量");
        const auto& spec = std::get<AnimateContentSizeModifier>(node.modifier.elements()[1].descriptor.value).animationSpec;
        check(spec.iterations == 2147483647 && spec.reverse && spec.kind == AnimationKind::Tween, "有限重复描述跨 native 边界丢失次数或方向");
    }

    void fixture(const char* path) {
        auto script = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        const auto loaded = arrange::quickjs::AppScriptLoader(*script).loadEntry(path);
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        arrange::juce::ArrangeRuntime runtime;
        runtime.setScriptHost(std::move(script));
        const auto tick = [&](double time) {
            const auto result = runtime.pumpFrame(1, {0, 400, 0, 600}, time);
            if (!result.ok) throw std::runtime_error(result.error);
        };
        tick(0);
        NodeId intrinsic = 0, flowing = 0, columns = 0, weighted = 0, matching = 0, animated = 0;
        EventSlotId submit;
        const auto& tree = runtime.scene().tree();
        for (auto id : tree.nodeIds()) {
            const auto& node = tree.node(id);
            if (const auto* flow = std::get_if<FlowMeasurePolicy>(&node.measurePolicy)) {
                if (!flow->horizontal)
                    columns = id;
                else if (flow->maxItems == 2)
                    weighted = id;
                else
                    flowing = id;
            }
            for (const auto& instance : node.modifier.elements()) {
                if (const auto* layout = std::get_if<LayoutModifierSemantics>(&instance.descriptor.value); layout && layout->kind == LayoutModifierKind::IntrinsicHeight) intrinsic = id;
                if (const auto* data = std::get_if<ParentDataModifierSemantics>(&instance.descriptor.value); data && data->kind == ParentDataKind::MatchParentSize) matching = id;
                if (std::holds_alternative<AnimateContentSizeModifier>(instance.descriptor.value)) animated = id;
            }
            const auto slot = test_support::event(node, EventSlotKind::InputSubmit);
            if (slot.valid()) submit = slot;
        }
        check(intrinsic && flowing && columns && weighted && matching && animated && submit.valid(), "SFA 未交付完整 M3 布局受体");
        check(tree.node(intrinsic).bounds.width == 50 && tree.node(intrinsic).bounds.height == 40, "SFA IntrinsicSize 正式布局错误");
        check(tree.node(flowing).bounds.width == 70 && tree.node(flowing).bounds.height == 27 && tree.node(flowing).flowLines.size() == 2, "SFA FlowRow 换行错误");
        check(tree.node(columns).bounds.width == 67 && tree.node(columns).bounds.height == 30, "SFA FlowColumn 布局错误");
        const auto& weights = tree.node(weighted).children;
        check(weights.size() == 3 && tree.node(weights[0]).bounds.width == 30 && tree.node(weights[1]).bounds.width == 60 && tree.node(weights[2]).bounds.width == 95, "SFA Flow weight 未逐行分配");
        check(tree.node(matching).bounds.width == 20 && tree.node(matching).bounds.height == 10, "SFA matchParentSize 贡献或丢失了父尺寸");
        runtime.enqueueStringEvent(submit, "展开");
        tick(20);
        const auto sample = [&](double time, float width, const char* text) {
            tick(time);
            check(near(runtime.scene().node(animated).bounds.width, width), "原生尺寸 repeatable 与绝对时间不符");
            bool found = false;
            for (auto id : runtime.scene().tree().nodeIds())
                if (test_support::textOf(runtime.scene().node(id)) == text) found = true;
            check(found, "真实 SFA 动画 Ref 未按同一有限重复规格交付文本槽");
        };
        sample(90, 45, "动画:5.0");
        sample(150, 60, "动画:10.0");
        sample(210, 45, "动画:5.0");
        sample(260, 60, "动画:10.0");
        check(runtime.scene().tree().activeAnimationCount() == 0, "有限重复完成后原生尺寸仍申请动画帧");
    }
}

int main(int argc, char** argv) {
    try {
        ::juce::ScopedJuceInitialiser_GUI juce;
        check(argc == 2, "需要真实 M3 布局 SFA 夹具路径");
        boundary();
        fixture(argv[1]);
        std::cout << "M3 布局 SFA/QuickJS/原生及有限重复边界通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
