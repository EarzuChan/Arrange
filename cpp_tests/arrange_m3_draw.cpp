#include <arrange/core/SceneFramePipeline.h>
#include <arrange/core/ModifierGeometry.h>
#include <arrange/quickjs/QuickJsScriptHost.h>
#include <arrange/juce/JuceDrawOpsPainter.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/TextInputOwner.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/TextInputMutationSink.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include "TextFixtures.h"
#include <algorithm>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    LayoutModifierSemantics size(float width, float height) {
        LayoutModifierSemantics result;
        result.kind = LayoutModifierKind::Size;
        result.width = width;
        result.height = height;
        return result;
    }

    PaintStyleSemantics background(std::uint32_t color) {
        PaintStyleSemantics result;
        result.color = color;
        return result;
    }

    InputModifierSemantics click(NodeId node) {
        InputModifierSemantics result;
        result.eventSlot = makeEventSlotId(node, EventSlotKind::Click);
        return result;
    }

    SetPropMutation policy(NodeId node, const char* kind) {
        return {node, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue(kind)}})};
    }

    ::juce::Image render(const PublishedFrame& frame, bool culling = true, bool flattened = false) {
        ::juce::Image image(::juce::Image::ARGB, 180, 140, true);
        ::juce::Graphics graphics(image);
        arrange::juce::JuceDrawOpsPainter painter;
        painter.setCullingEnabled(culling);
        if (flattened)
            painter.paint(graphics, exportDrawOps(frame.content.scenePaint), frame.content.focusedInputModifier, frame.content.focusedInputViewportX, frame.content.overlayDrawOps);
        else
            painter.paint(graphics, frame.content.scenePaint, frame.content.focusedInputModifier, frame.content.focusedInputViewportX, frame.content.overlayDrawOps);
        return image;
    }

    void compare(const PublishedFrame& frame) {
        const auto normal = render(frame), all = render(frame, false), flattened = render(frame, false, true);
        for (int y = 0; y < normal.getHeight(); ++y)
            for (int x = 0; x < normal.getWidth(); ++x) check(normal.getPixelAt(x, y) == all.getPixelAt(x, y) && normal.getPixelAt(x, y) == flattened.getPixelAt(x, y), "共享片段、诊断导出与保守剔除的像素不一致");
    }

    void script(arrange::quickjs::QuickJsScriptHost& host, const char* name, const char* source) {
        const auto result = host.executeModule(name, source);
        if (!result.ok) throw std::runtime_error(result.error);
    }

    void verifyDrawPreparation() {
        arrange::quickjs::QuickJsScriptHost host;
        NativeScene scene;
        PublishedFrame published;
        SceneFramePipeline pipeline;
        FramePreparation preparation;
        preparation.draw = [&](NativeScene& candidate) {
            const auto result = host.prepareDrawModifiers(candidate);
            if (!result.ok) throw std::runtime_error(result.error);
        };
        const auto frame = [&](const FrameFinalizer& finalize = {}) {
            auto transaction = host.takePendingTransaction();
            const auto result = pipeline.run(scene, 1, {0, 180, 0, 140}, transaction ? &*transaction : nullptr, true, published, finalize, 0, preparation);
            const auto complete = host.completeRearrange(transaction ? transaction->rearrange : nullptr, result.error.value_or(""));
            if (!complete.ok) throw std::runtime_error(complete.error);
            host.publishScene(scene);
            return result;
        };
        script(host, "m3-draw-initial.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            globalThis.prepares = 0
            globalThis.fail = false
            globalThis.hidden = false
            globalThis.record = (width, height) => {
                globalThis.prepares++
                globalThis.lastSize = [width, height]
                if (globalThis.fail) throw new Error('绘制候选失败')
                if (globalThis.hidden) return []
                return [
                    {kind:'rect',x:0,y:0,width,height,color:0xff445566,strokeWidth:0},
                    {kind:'clip',shape:'rectangle',x:0,y:0,width:50,height:60,radius:0},
                    {kind:'content'},
                    {kind:'transform',width,height,translationX:40,translationY:0,scaleX:1,scaleY:1,rotationZ:0,originX:0,originY:0},
                    {kind:'content'}, {kind:'popTransform'}, {kind:'popClip'},
                    {kind:'oval',x:70,y:50,width:20,height:20,color:0xffffff00,strokeWidth:0},
                    {kind:'line',x:70,y:20,endX:90,endY:20,color:0xff00ff00,strokeWidth:2}
                ]
            }
            globalThis.chain = (width,height,revision) => ({elements:[
                {type:'size',value:{width,height}},
                {type:'drawWithContent',key:'drawing',value:{prepare:globalThis.record,revision}},
                {type:'clickable',key:'control',value:{onClick:globalThis.command}}
            ]})
            globalThis.command = command => {
                if(command==='passive') {
                    if(globalThis.prepares!==1) throw new Error('被动paint或稳定帧重新执行JS，次数：'+globalThis.prepares)
                    return
                }
                if(command==='size-proof') {
                    if(globalThis.lastSize[0]!==120||globalThis.lastSize[1]!==90)throw new Error('准备尺寸落后')
                    return
                }
                n.beginRearrange()
                if(command==='child') n.setModifier(2,{elements:[{type:'size',value:{width:30,height:20}},{type:'background',value:{color:0xff00ff00}}]})
                if(command==='resize') n.setModifier(1,globalThis.chain(120,90,0))
                if(command==='failure') {globalThis.fail=true;n.setModifier(1,globalThis.chain(130,95,1))}
                if(command==='hidden') {globalThis.fail=false;globalThis.hidden=true;n.setModifier(1,globalThis.chain(120,90,1))}
                if(command==='retire') n.setModifier(1,{elements:[{type:'size',value:{width:120,height:90}}]})
                n.submitRearrange(()=>{})
            }
            n.beginRearrange()
            n.createNode(1,'LayoutNode')
            n.updateBinding(n.registerBinding(1,'measurePolicy'),{kind:'Box'})
            n.setModifier(1,globalThis.chain(100,80,0))
            n.createNode(2,'LayoutNode')
            n.updateBinding(n.registerBinding(2,'measurePolicy'),{kind:'MinSize'})
            n.setModifier(2,{elements:[{type:'size',value:{width:30,height:20}},{type:'background',value:{color:0xffff0000}}]})
            n.insertChild(1,2,0)
            n.submitRearrange(error => { globalThis.lastError = error })
        )JS");
        check(!frame().error, "首次绘制准备没有发布");
        const auto control = test_support::event(scene.node(1), EventSlotKind::Click);
        check(control.valid(), "raw 绘制测试缺少存活的控制回调");
        const auto command = [&](const char* value) {
            const auto result = host.invokeEventSlot(control, {.hasStringArgument = true, .stringArgument = value});
            if (!result.ok) throw std::runtime_error(result.error);
        };
        const auto draw = scene.node(1).modifier.elements()[1].preparedDraw;
        check(draw && draw->size() == 9 && scene.node(1).modifier.elements()[1].preparedDrawSize == Size{100, 80}, "首次准备没有取得同帧层尺寸");
        compare(published);
        auto image = render(published);
        check(image.getPixelAt(5, 5).getARGB() == 0xffff0000 && image.getPixelAt(45, 5).getARGB() == 0xffff0000, "多次 drawContent 没有重放同一内容");
        check(image.getPixelAt(55, 5).getARGB() == 0xff445566 && image.getPixelAt(80, 60).getARGB() == 0xffffff00, "内容标记间 clip/transform 状态没有正确恢复");
        for (int repeat = 0; repeat < 4; ++repeat) (void)render(published);
        check(!frame().error && scene.node(1).modifier.elements()[1].preparedDraw == draw, "稳定绘制没有保留准备结果");
        command("passive");
        command("child");
        check(!frame().error && scene.node(1).modifier.elements()[1].preparedDraw == draw, "后续内容更新重新录制了稳定用户绘制");
        command("passive");
        const auto source = scene.node(2).paintCache;
        image = render(published);
        check(image.getPixelAt(5, 5).getARGB() == 0xff00ff00 && image.getPixelAt(45, 5).getARGB() == 0xff00ff00, "共享 drawContent 没有读取更新后的内容片段");
        compare(published);
        const auto before = pipeline.counters();
        command("resize");
        check(!frame().error && scene.node(1).modifier.elements()[1].preparedDrawSize == Size{120, 90}, "resize 绘制使用了上一帧尺寸");
        check(scene.node(2).paintCache == source, "多次内容引用没有保留稳定子片段");
        command("size-proof");
        const auto revision = published.revision;
        const auto retained = published;
        command("failure");
        check(frame().error.has_value() && published.revision == revision && scene.node(1).bounds.width == 120, "失败绘制候选污染已发布尺寸或图像");
        compare(retained);
        command("hidden");
        const auto beforeHidden = pipeline.counters();
        check(!frame().error && exportDrawOps(published.content.scenePaint).empty(), "零次 drawContent 没有隐藏后续绘制");
        check(pipeline.counters().measures == beforeHidden.measures && pipeline.counters().hitBuilds == beforeHidden.hitBuilds, "纯绘制输入失效了布局或命中");
        const auto oldSlot = std::get<DrawModifier>(scene.node(1).modifier.elements()[1].descriptor.value).prepare;
        command("retire");
        check(!frame().error && host.eventSlotCount() == 0 && !scene.hasEventSlot(oldSlot), "绘制受体退休保留旧 JS callback");
        check(!host.invokeEventSlot(oldSlot).ok, "旧绘制回调仍有调用资格");
        compare(retained);
        check(pipeline.counters().measures > before.measures, "尺寸更新没有走正式测量");
    }

    void verifyTransformsAndZOrder() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, {{size(160, 120), {}}}}, CreateNodeMutation{2, NodeType::Layout}, policy(2, "Box"), SetModifierMutation{2, {{size(100, 100), {}}, {background(0xffff0000), {}}, {click(2), {}}, {ZIndexModifier{-1}, {}}}}, CreateNodeMutation{3, NodeType::Layout}, policy(3, "Box"), SetModifierMutation{3, {{size(100, 100), {}}, {background(0xff0000ff), {}}, {click(3), {}}, {ZIndexModifier{2}, {}}}}, InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}};
        const auto run = [&](MutationTransaction* transaction) {
            const auto result = pipeline.run(scene, 1, {0, 180, 0, 140}, transaction, true, published);
            check(!result.error, "几何/排序场景失败");
            compare(published);
        };
        run(&initial);
        check(render(published).getPixelAt(10, 10).getARGB() == 0xff0000ff && HitTester{}.hitTestClickable(*published.content.hitTest, {10, 10}).node == 3, "负 zIndex 的绘制命中不一致");
        MutationTransaction reorder;
        reorder.operations = {SetModifierMutation{2, {{size(100, 100), {}}, {background(0xffff0000), {}}, {click(2), {}}, {ZIndexModifier{1}, {}}, {ZIndexModifier{2}, {}}}}};
        run(&reorder);
        check(render(published).getPixelAt(10, 10).getARGB() == 0xffff0000 && HitTester{}.hitTestClickable(*published.content.hitTest, {10, 10}).node == 2, "重复 zIndex 没有累加到同一绘制/命中排序");
        const auto before = pipeline.counters();
        reorder.operations = {SetModifierMutation{3, {{size(100, 100), {}}, {background(0xff0000ff), {}}, {click(3), {}}, {ZIndexModifier{3}, {}}}}};
        run(&reorder);
        check(pipeline.counters().measures == before.measures && render(published).getPixelAt(10, 10).getARGB() == 0xff0000ff && HitTester{}.hitTestClickable(*published.content.hitTest, {10, 10}).node == 3, "平值或动态 zIndex 失效行为错误");
        TransformModifierSemantics transform;
        transform.scaleX = -1;
        transform.rotationZ = 90;
        transform.translationX = 100;
        transform.translationY = 50;
        transform.transformOriginX = transform.transformOriginY = 0;
        reorder.operations = {SetModifierMutation{3, {{size(30, 20), {}}, {transform, {}}, {background(0xff0000ff), {}}, {click(3), {}}, {ZIndexModifier{3}, {}}}}};
        run(&reorder);
        check(scene.node(3).bounds.width == 30 && render(published).getPixelAt(93, 45).getARGB() == 0xff0000ff && HitTester{}.hitTestClickable(*published.content.hitTest, {93, 45}).node == 3, "镜像与旋转图像/逆命中不一致");
        transform.scaleX = 0;
        reorder.operations = {SetModifierMutation{3, {{size(30, 20), {}}, {transform, {}}, {background(0xff0000ff), {}}, {click(3), {}}, {ZIndexModifier{3}, {}}}}};
        run(&reorder);
        check(HitTester{}.hitTestClickable(*published.content.hitTest, {93, 45}).node != 3, "不可逆零缩放仍可命中");
        TransformModifierSemantics identity;
        identity.alpha = 0.5f;
        reorder.operations = {SetModifierMutation{3, {{size(100, 100), {}}, {identity, {}}, {background(0xff0000ff), {}}, {background(0xff0000ff), {}}, {click(3), {}}, {ZIndexModifier{3}, {}}}}};
        run(&reorder);
        const auto pixel = render(published).getPixelAt(10, 10);
        check(pixel.getBlue() > 180 && pixel.getRed() < 80, "既有逐操作 alpha 被改为整层合成");
    }

    void verifyFocusedInputPaintOrder() {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        NativeScene scene;
        SceneFramePipeline pipeline{LayoutEngine{service}};
        PublishedFrame published;
        arrange::juce::TextInputOwner input(service);
        auto field = test_support::textField("", "", 0xffffffff, 14);
        field.presentation.singleLine = true;
        field.presentation.style.lineHeight = 20;
        const OffsetModifier offset{15, 10};
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, {{size(160, 80)}}}, CreateNodeMutation{2, NodeType::Layout}, policy(2, "MinSize"), SetModifierMutation{2, {{offset}, {size(40, 20)}, {field, "field"}, {ZIndexModifier{-1}}}}, CreateNodeMutation{3, NodeType::Layout}, policy(3, "MinSize"), SetModifierMutation{3, {{offset}, {size(40, 20)}, {background(0xffff0000)}, {ZIndexModifier{1}}}}, InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}};
        std::shared_ptr<const DrawCommands> commands;
        FramePreparation preparation;
        preparation.draw = [&](NativeScene& candidate) {
            for (auto& instance : candidate.node(1).modifier.elements())
                if (std::holds_alternative<DrawModifier>(instance.descriptor.value)) instance.preparedDraw = commands;
        };
        const auto finalize = [&](const NativeScene& candidate, PublishedFrame& frame) {
            const auto* receiver = test_support::editable(candidate.node(2));
            input.focus(candidate.tree(), 2, receiver->handle, {});
            frame.content.focusedInputNode = 2;
            frame.content.focusedInputModifier = receiver->handle;
            frame.content.overlayDrawOps = input.buildFocusedInputOps(candidate.tree(), true);
        };
        const auto pass = [&](MutationTransaction* transaction) {
            const auto result = pipeline.run(scene, 1, {0, 180, 0, 140}, transaction, true, published, finalize, 0, preparation);
            if (result.error) throw std::runtime_error(*result.error);
            compare(published);
        };
        pass(&initial);
        check(render(published).getPixelAt(15, 15).getARGB() == 0xffff0000, "聚焦 Input 光标穿透了高 zIndex 兄弟");
        arrange::juce::PassivePaintRenderer production(service);
        ::juce::Image actual(::juce::Image::ARGB, 180, 140, true);
        {
            ::juce::Graphics graphics(actual);
            production.paint(graphics, published);
        }
        check(actual.getPixelAt(15, 15).getARGB() == 0xffff0000, "生产 painter 在 scene 之后重复绘制了 Input");
        MutationTransaction update;
        update.operations = {RemoveChildMutation{1, 3}, DeleteNodeMutation{3}};
        pass(&update);
        check(render(published).getPixelAt(15, 15).getAlpha() > 0, "TextField 局部 replacement 没有回到原绘制位置");
        DrawModifier draw;
        draw.kind = DrawModifierKind::WithContent;
        const DrawCommand content{.kind = DrawCommandKind::Content};
        const DrawCommand foreground{.kind = DrawCommandKind::Rectangle, .rect = {0, 0, 80, 40}, .color = 0xff00ff00};
        commands = std::make_shared<const DrawCommands>(DrawCommands{content, foreground});
        update.operations = {SetModifierMutation{1, {{size(160, 80)}, {draw, "draw"}}}};
        pass(&update);
        check(render(published).getPixelAt(15, 15).getARGB() == 0xff00ff00, "聚焦 Input 穿透了 drawWithContent 后置前景");
        commands = std::make_shared<const DrawCommands>();
        draw.revision++;
        update.operations = {SetModifierMutation{1, {{size(160, 80)}, {draw, "draw"}}}};
        pass(&update);
        check(render(published).getPixelAt(15, 15).getAlpha() == 0, "零次 drawContent 仍显示聚焦 Input");
        const DrawCommand translation{.kind = DrawCommandKind::PushTransform, .translationX = 50};
        const DrawCommand pop{.kind = DrawCommandKind::PopTransform};
        commands = std::make_shared<const DrawCommands>(DrawCommands{content, translation, content, pop});
        draw.revision++;
        update.operations = {SetModifierMutation{1, {{size(160, 80)}, {draw, "draw"}}}};
        pass(&update);
        const auto repeated = render(published);
        check(repeated.getPixelAt(15, 15).getAlpha() > 0 && repeated.getPixelAt(65, 15).getAlpha() > 0 && repeated.getPixelAt(115, 15).getAlpha() == 0, "Input replacement 没有随重复 drawContent 共用内容片段");
        TransformModifierSemantics layer;
        layer.translationX = 20;
        layer.alpha = 0.5f;
        ClipModifier clip;
        update.operations = {SetModifierMutation{2, {{offset}, {size(40, 20)}, {layer}, {clip}, {field, "field"}}}};
        pass(&update);
        const auto transformed = render(published);
        check(transformed.getPixelAt(15, 15).getAlpha() == 0 && transformed.getPixelAt(35, 15).getAlpha() > 0 && transformed.getPixelAt(35, 15).getAlpha() < 200, "Input replacement 没有继承所在片段的变换、裁剪与 alpha");
    }

    void verifySfaDraw(const char* path) {
        auto scriptHost = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        auto* host = scriptHost.get();
        const auto loaded = arrange::quickjs::AppScriptLoader(*host).loadEntry(path);
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService textService(backend);
        arrange::juce::ArrangeRuntime runtime{SceneFramePipeline{LayoutEngine{textService}}};
        runtime.setScriptHost(std::move(scriptHost));
        double time = 0;
        const auto tick = [&](const FrameFinalizer& finalize = {}) {
            time += 20;
            return runtime.pumpFrame(1, {0, 180, 0, 140}, time, finalize);
        };
        const auto pass = [&] {
            const auto result = tick();
            if (!result.ok) throw std::runtime_error(result.error);
        };
        pass();
        NodeId drawing = 0;
        EventSlotId submit, drawSlot;
        for (const auto id : runtime.scene().tree().nodeIds()) {
            const auto& node = runtime.scene().node(id);
            const auto input = test_support::event(node, EventSlotKind::InputSubmit);
            if (input.valid()) submit = input;
            for (const auto& instance : node.modifier.elements())
                if (const auto* draw = std::get_if<DrawModifier>(&instance.descriptor.value)) {
                    drawing = id;
                    drawSlot = draw->prepare;
                }
        }
        check(drawing && submit.valid() && drawSlot.valid(), "真实 SFA 没有建立绘制缓存与输入受体");
        const auto command = [&](const char* value) {
            runtime.enqueueStringEvent(submit, value);
            pass();
        };
        command("校验首次");
        compare(runtime.publishedFrame());
        check(render(runtime.publishedFrame()).getPixelAt(5, 5).getARGB() == 0xffff0000, "SFA drawContent 未重放后续内容");
        const auto beforeColor = runtime.frameCounters();
        command("颜色");
        command("校验颜色");
        check(runtime.frameCounters().measures == beforeColor.measures && runtime.frameCounters().hitBuilds == beforeColor.hitBuilds, "SFA 绘制依赖错误唤醒布局或命中");
        check(render(runtime.publishedFrame()).getPixelAt(50, 25).getARGB() == 0xff667788, "SFA 绘制依赖没有发布新颜色");
        runtime.requestFramePipelineRun();
        pass();
        for (int repeat = 0; repeat < 3; ++repeat) (void)render(runtime.publishedFrame());
        command("校验稳定");
        command("尺寸");
        command("校验尺寸");
        const auto retained = runtime.publishedFrame();
        const auto retainedDraw = runtime.scene().node(drawing).modifier.elements()[1].preparedDraw;
        runtime.enqueueStringEvent(submit, "失败候选");
        const auto failed = tick([](const NativeScene&, PublishedFrame&) { throw std::runtime_error("绘制准备后失败"); });
        check(!failed.ok && runtime.publishedFrame().revision == retained.revision && runtime.scene().node(drawing).bounds.width == 140 && runtime.scene().node(drawing).modifier.elements()[1].preparedDraw == retainedDraw, "失败 SFA 绘制候选污染已发布缓存或尺寸");
        compare(retained);
        command("恢复");
        command("校验恢复");
        command("移除");
        check(!runtime.scene().hasEventSlot(drawSlot), "SFA 移除 draw 元素没有退休回调");
        command("退休依赖");
        command("校验退休");
        compare(retained);
        NodeId button = 0;
        for (const auto id : runtime.scene().tree().nodeIds())
            if (test_support::event(runtime.scene().node(id), EventSlotKind::Click).valid()) button = id;
        check(button != 0, "SFA焦点点击夹具缺少按钮");
        const auto buttonBounds = runtime.scene().node(button).bounds;
        const Point point{buttonBounds.x + buttonBounds.width * 0.5f, buttonBounds.y + buttonBounds.height * 0.5f};
        const auto beforeDown = HitTester{}.hitTestClickable(*runtime.publishedFrame().content.hitTest, point);
        check(beforeDown.hit && beforeDown.node == button, "SFA按钮未在已发布命中范围内");
        arrange::juce::InteractionStateOwner interaction(textService);
        interaction.pointerDown(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, point.x, point.y, arrange::juce::TextInputMutationSink{}.callbacks(runtime));
        pass();
        const auto afterFocus = HitTester{}.hitTestClickable(*runtime.publishedFrame().content.hitTest, point);
        check(afterFocus.modifier == beforeDown.modifier && afterFocus.eventSlot != beforeDown.eventSlot && !runtime.scene().hasEventSlot(beforeDown.eventSlot), "SFA焦点通知没有保留受体并退休旧callback");
        const auto clicked = interaction.pointerUp(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, point.x, point.y);
        check(clicked.clickTriggered && clicked.eventSlot == afterFocus.eventSlot, "SFA焦点通知更新闭包吞掉了同受体点击");
        runtime.enqueueEvent(clicked.eventSlot);
        pass();
        command("校验焦点点击");
    }
}

int main(int argc, char** argv) {
    try {
        check(argc == 2, "需要真实 M3 绘制 SFA 夹具路径");
        ::juce::ScopedJuceInitialiser_GUI initializer;
        verifyDrawPreparation();
        verifyTransformsAndZOrder();
        verifyFocusedInputPaintOrder();
        verifySfaDraw(argv[1]);
        std::cout << "M3 绘制准备、共享内容、变换和排序验收通过\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
