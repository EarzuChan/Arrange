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
#include <arrange/juce/NativePainters.h>
#include <arrange/juce/PainterResources.h>
#include "TextFixtures.h"
#include <algorithm>
#include <array>
#include <functional>
#include <iostream>
#include <optional>
#include <string>
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
                if (globalThis.hidden) return {ops:new Float64Array(0),refs:[]}
                // 操作码：1 矩形、3 椭圆、4 线、5 裁剪、6 退出裁剪、7 变换、8 退出变换、9 内容
                return {ops:Float64Array.of(
                    1, 0,0,width,height, 0xff445566, 0,
                    5, 0, 0,0,50,60, 0,
                    9,
                    7, width,height, 40,0, 1,1, 0, 0,0,
                    9, 8, 6,
                    3, 70,50,20,20, 0xffffff00, 0,
                    4, 70,20,90,20, 0xff00ff00, 2
                ),refs:[]}
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

    // Gallery 椭圆：图层变换后点击区随变换走；clickable 在 padding 之后只覆盖内边距以内
    void verifyTransformedClickArea() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        PaintStyleSemantics circle;
        circle.shapeType = ShapeKind::Circle;
        LayoutModifierSemantics padding;
        padding.kind = LayoutModifierKind::Padding;
        padding.padding.start = padding.padding.top = padding.padding.end = padding.padding.bottom = 18;
        const auto chain = [&](float rotation, bool clickInsidePadding) {
            TransformModifierSemantics layer;
            layer.rotationZ = rotation;
            ModifierDescriptors result{{size(76, 58), {}}, {layer, {}}, {ClipModifier{circle}, {}}, {background(0xff61d6bb), {}}};
            if (clickInsidePadding) result.push_back({padding, {}});
            result.push_back({click(2), {}});
            if (!clickInsidePadding) result.push_back({padding, {}});
            return result;
        };
        const auto run = [&](MutationTransaction&& transaction) {
            check(!pipeline.run(scene, 1, {0, 180, 0, 140}, &transaction, true, published).error, "变换点击场景失败");
        };
        const auto hit = [&](float x, float y) {
            return HitTester{}.hitTestClickable(*published.content.hitTest, {x, y}).node == 2;
        };
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, {{size(160, 120), {}}}}, CreateNodeMutation{2, NodeType::Layout}, policy(2, "Box"), SetModifierMutation{2, chain(0, true)}, InsertChildMutation{1, 2, 0}};
        run(std::move(initial));
        check(hit(38, 29) && !hit(10, 29), "padding 之后的点击区没有限于内边距以内");
        MutationTransaction rotate;
        rotate.operations = {SetModifierMutation{2, chain(90, true)}};
        run(std::move(rotate));
        check(hit(38, 12) && !hit(20, 29), "旋转后点击区没有跟随变换");
        MutationTransaction whole;
        whole.operations = {SetModifierMutation{2, chain(90, false)}};
        run(std::move(whole));
        check(hit(38, -4) && hit(38, 62) && !hit(12, 0), "padding 之前的点击区没有覆盖整个变换后的椭圆");
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
            for (auto& instance : candidate.tree().mutableNode(1).modifier.elements())
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

    // M5：渐变画笔、路径、路径裁剪与文字经数值流解码、求界并重放
    std::string drawScript(const char* refs, const char* ops) {
        return std::string(R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            globalThis.record = () => ({ops:Float64Array.of()JS") +
               ops + "),refs:[" + refs + R"JS(]})
            n.beginRearrange()
            n.createNode(1,'LayoutNode')
            n.updateBinding(n.registerBinding(1,'measurePolicy'),{kind:'Box'})
            n.setModifier(1,{elements:[{type:'size',value:{width:120,height:100}},{type:'drawBehind',value:{prepare:globalThis.record,revision:0}}]})
            n.submitRearrange(()=>{})
        )JS";
    }

    struct DrawFixture {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service{backend};
        arrange::quickjs::QuickJsScriptHost host;
        NativeScene scene;
        PublishedFrame published;
        SceneFramePipeline pipeline{LayoutEngine{service}};

        std::optional<std::string> run(const std::string& source) {
            script(host, "m5-draw.js", source.c_str());
            FramePreparation preparation;
            preparation.draw = [&](NativeScene& candidate) {
                const auto result = host.prepareDrawModifiers(candidate);
                if (!result.ok) throw std::runtime_error(result.error);
            };
            auto transaction = host.takePendingTransaction();
            const auto result = pipeline.run(scene, 1, {0, 180, 0, 140}, transaction ? &*transaction : nullptr, true, published, {}, 0, preparation);
            (void)host.completeRearrange(transaction ? transaction->rearrange : nullptr, result.error.value_or(""));
            return result.error;
        }
    };

    void verifyM5DrawCommands() {
        DrawFixture fixture;
        // 操作码：1 矩形、5 裁剪、6 退出裁剪、9 内容、10 路径、11 文字、13 路径裁剪；画笔 -1 指向 refs[0]
        const auto error = fixture.run(drawScript("{type:'linearGradient',colors:[0xff000000,0xffffffff],stops:[0,1],start:{x:0,y:0},end:{x:0,y:1}}, '刻'",
                                                  R"(
            1, 0,0,40,40, -1, 0,
            10, 0xffff0000, 0, 0, 0, 0, 4, 0, 50,0, 1, 90,0, 1, 50,40, 5,
            13, 0, 4, 0, 0,60, 1, 100,60, 1, 0,100, 5,
            1, 0,60,120,40, 0xff00ff00, 0,
            6,
            11, 1, 100,0, 0, 0xff0000ff, 14, 0, 0, 0, 2, -1, 400, 0, 1,
            9)"));
        if (error) throw std::runtime_error(*error);
        const auto& instance = fixture.scene.node(1).modifier.elements()[1];
        const auto& commands = *instance.preparedDraw;
        check(commands.size() == 7 && commands[0].gradient && commands[0].gradient->stops.size() == 2 && commands[0].gradient->end == Point{0, 1}, "渐变画笔没有从引用表解码");
        check(commands[1].kind == DrawCommandKind::Path && commands[1].path && commands[1].path->bounds == Rect{50, 0, 40, 40} && commands[1].path->verbs.size() == 4, "路径动词或外包盒解码错误");
        check(commands[2].kind == DrawCommandKind::PushClip && commands[2].shape == DrawCommandShape::Path && commands[4].kind == DrawCommandKind::PopClip, "路径裁剪没有与退出裁剪配对");
        check(commands[5].kind == DrawCommandKind::Text && commands[5].text == "刻" && commands[5].overflow == TextOverflow::Visible && commands[5].rect.width == 0, "绘制文字解码错误");
        const auto bounds = fixture.scene.node(1).paintCache->bounds;
        check(bounds.known && !bounds.empty, "含路径与文字的自定义绘制边界未知");
        compare(fixture.published);
        const auto image = render(fixture.published);
        check(image.getPixelAt(20, 2).getRed() < 40 && image.getPixelAt(20, 37).getRed() > 210, "线性渐变没有沿外包盒纵向过渡");
        check(image.getPixelAt(60, 5).getARGB() == 0xffff0000 && image.getPixelAt(85, 35).getAlpha() == 0, "路径填充范围错误");
        check(image.getPixelAt(5, 95).getARGB() == 0xff00ff00 && image.getPixelAt(110, 95).getAlpha() == 0, "路径裁剪没有限制后续绘制");
        auto ink = false;
        for (int y = 0; y < 20; ++y)
            for (int x = 100; x < 120; ++x) ink = ink || image.getPixelAt(x, y).getBlue() > 0;
        check(ink, "绘制文字没有经排版重放");

        // 描边路径的线帽线接与扫描渐变
        DrawFixture stroke;
        const auto strokeError = stroke.run(drawScript("{type:'sweepGradient',colors:[0xffff0000,0xff0000ff],stops:[0,1],center:{x:0.5,y:0.5},startAngle:0}",
                                                       R"(
            1, 0,0,100,100, -1, 0,
            10, 0xff00ff00, 6, 1, 1, 0, 2, 0, 110,10, 1, 110,90,
            9)"));
        if (strokeError) throw std::runtime_error(*strokeError);
        const auto sweep = render(stroke.published);
        // 起始角 0 在右侧：右侧略下方接近首色，右侧略上方接近末色
        check(sweep.getPixelAt(95, 52).getRed() > 200 && sweep.getPixelAt(95, 47).getBlue() > 200, "扫描渐变的起始角或方向错误");
        check(sweep.getPixelAt(110, 8).getGreen() > 200 && sweep.getPixelAt(110, 4).getAlpha() == 0, "圆线帽没有越过端点半个线宽");
        // 描边外沿超出形状矩形，扫描渐变也要铺到外沿
        DrawFixture ring;
        if (const auto ringError = ring.run(drawScript("{type:'sweepGradient',colors:[0xffff0000,0xff0000ff],stops:[0,1],center:{x:0.5,y:0.5},startAngle:0}", "3, 20,20,60,60, -1, 10, 9"))) throw std::runtime_error(*ringError);
        const auto ringImage = render(ring.published);
        check(ringImage.getPixelAt(16, 50).getAlpha() > 200 && ringImage.getPixelAt(50, 16).getAlpha() > 200 && ringImage.getPixelAt(50, 50).getAlpha() == 0, "扫描渐变描边被裁到形状矩形内");
        const auto strokeBounds = stroke.scene.node(1).paintCache->bounds;
        check(strokeBounds.known && strokeBounds.rect.x + strokeBounds.rect.width >= 113 && strokeBounds.rect.y <= 7, "描边路径边界没有计入线宽");

        // 非法输入在解码时拒绝，不发布
        const auto rejects = [](const char* refs, const char* ops, const char* expected) {
            DrawFixture invalid;
            const auto result = invalid.run(drawScript(refs, ops));
            if (!result || result->find(expected) == std::string::npos) throw std::runtime_error(std::string("非法绘制命令没有按预期拒绝：") + expected + "，实际：" + result.value_or("通过"));
        };
        rejects("{type:'solidColor',color:1,extra:2}", "1, 0,0,1,1, -1, 0", "extra");
        rejects("", "1, 0,0,1,1, -1, 0", "画笔引用");
        rejects("", "10, 0xff000000, 0, 0, 0, 0, 2, 0, 1,1", "截断");
        rejects("", "10, 0xff000000, 0, 0, 0, 0, 1, 4, 0,0,-1,4,0,90,0", "弧");
        rejects("", "10, 0xff000000, 0, 3, 0, 0, 0", "线帽");
        rejects("", "11, 0, 0,0,0, 0xff000000, 14,0,0,0,0, -1, 400, 0, 1", "引用");
        rejects("{}", "12, 0, 0,0,10,10, 1, -1, 0, 5", "painter");
        rejects("", "13, 0, 0", "没有退出");
    }

    // 渐变背景与分角圆角：绘制与命中一致
    void verifyGradientCorners() {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        PaintStyleSemantics style;
        style.shapeType = ShapeKind::Rounded;
        style.corners = {40, 0, 10, 0};
        Gradient gradient;
        gradient.start = {0, 0};
        gradient.end = {1, 0};
        gradient.stops = {{0, 0xffff0000}, {1, 0xff0000ff}};
        style.gradient = GradientRef(gradient);
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, {{size(100, 60), {}}, {ClipModifier{style}, {}}, {style, {}}, {click(1), {}}}}};
        check(!pipeline.run(scene, 1, {0, 180, 0, 140}, &initial, true, published).error, "渐变圆角场景失败");
        compare(published);
        const auto image = render(published);
        check(image.getPixelAt(2, 2).getAlpha() == 0 && image.getPixelAt(97, 2).getAlpha() == 255 && image.getPixelAt(2, 57).getAlpha() == 255, "分角圆角只应裁掉 topStart 与 bottomEnd");
        check(image.getPixelAt(10, 30).getRed() > image.getPixelAt(10, 30).getBlue() && image.getPixelAt(90, 30).getBlue() > image.getPixelAt(90, 30).getRed(), "背景渐变没有沿水平方向过渡");
        const auto hit = [&](float x, float y) {
            return HitTester{}.hitTestClickable(*published.content.hitTest, {x, y}).node == 1;
        };
        check(!hit(3, 3) && hit(97, 2) && hit(2, 57) && !hit(98, 58) && hit(50, 30), "分角圆角的命中与绘制不一致");
        check(containsShape({0, 0, 10, 10}, style, {3, 3}), "两角之和超过边长时没有等比缩小半径");
    }

    EffectModifier effect(EffectKind kind, float radius, std::uint32_t color = 0, Point offset = {}) {
        EffectModifier result;
        result.kind = kind;
        result.radius = radius;
        result.color = color;
        result.offset = offset;
        return result;
    }

    // 单节点：四周留 40，内部 60x40 的白块，效果夹在留白与白块之间
    PublishedFrame effectScene(NativeScene& scene, SceneFramePipeline& pipeline, ModifierDescriptors inner) {
        LayoutModifierSemantics padding;
        padding.kind = LayoutModifierKind::Padding;
        padding.padding.start = padding.padding.top = padding.padding.end = padding.padding.bottom = 40;
        ModifierDescriptors chain{{padding, {}}};
        chain.insert(chain.end(), inner.begin(), inner.end());
        chain.push_back({size(60, 40), {}});
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, chain}};
        PublishedFrame published;
        check(!pipeline.run(scene, 1, {0, 180, 0, 140}, &initial, true, published).error, "效果场景失败");
        return published;
    }

    void verifyEffects() {
        {
            NativeScene scene;
            SceneFramePipeline pipeline;
            const auto published = effectScene(scene, pipeline, {{effect(EffectKind::DropShadow, 12, 0xff000000, {0, 10}), {}}, {background(0xffffffff), {}}});
            ::juce::Image image(::juce::Image::ARGB, 180, 140, true);
            arrange::juce::JuceDrawOpsPainter painter;
            {
                ::juce::Graphics graphics(image);
                painter.paint(graphics, published.content.scenePaint);
            }
            check(image.getPixelAt(70, 60) == ::juce::Colours::white, "外阴影盖住了内容");
            check(image.getPixelAt(70, 88).getAlpha() > 40 && image.getPixelAt(70, 88).getBrightness() < 0.1f, "外阴影没有画在形状下方偏移处");
            check(image.getPixelAt(70, 33).getAlpha() < image.getPixelAt(70, 88).getAlpha(), "外阴影偏移方向错误");
            check(image.getPixelAt(5, 5).getAlpha() == 0, "外阴影超出模糊范围");
            const auto first = painter.bitmapCache().counters();
            {
                ::juce::Graphics graphics(image);
                painter.paint(graphics, published.content.scenePaint);
            }
            const auto second = painter.bitmapCache().counters();
            check(first.builds == 1 && second.builds == 1 && second.hits == first.hits + 1 && second.retainedBytes > 0 && second.entries == 1, "未变化的阴影没有复用位图缓存");
            painter.bitmapCache().setBudget(16);
            check(painter.bitmapCache().counters().entries == 0 && painter.bitmapCache().counters().evictions == 1, "位图缓存没有按预算淘汰");
        }
        {
            NativeScene scene;
            SceneFramePipeline pipeline;
            const auto published = effectScene(scene, pipeline, {{background(0xffffffff), {}}, {effect(EffectKind::InnerShadow, 10, 0xff000000), {}}});
            const auto image = render(published);
            check(image.getPixelAt(41, 60).getBrightness() < image.getPixelAt(70, 60).getBrightness() - 0.2f, "内阴影没有压暗形状边缘");
            check(image.getPixelAt(70, 60).getBrightness() > 0.9f, "内阴影侵入了形状中心");
            check(image.getPixelAt(36, 60).getAlpha() == 0, "内阴影画到了形状之外");
        }
        {
            NativeScene scene;
            SceneFramePipeline pipeline;
            const auto published = effectScene(scene, pipeline, {{effect(EffectKind::Blur, 4), {}}, {background(0xffff0000), {}}});
            const auto image = render(published);
            check(image.getPixelAt(37, 60).getAlpha() > 0 && image.getPixelAt(37, 60).getAlpha() < 160, "内容模糊没有把边缘向外柔化");
            check(image.getPixelAt(42, 60).getAlpha() < 255 && image.getPixelAt(70, 60).getAlpha() > 250, "内容模糊的柔化范围错误");
            check(image.getPixelAt(20, 60).getAlpha() == 0, "内容模糊超出三倍标准差");

            // 焦点在模糊子树之外时照常命中缓存
            arrange::juce::JuceDrawOpsPainter painter;
            ::juce::Image again(::juce::Image::ARGB, 180, 140, true);
            const ModifierHandle elsewhere{77, 1};
            for (int pass = 0; pass < 2; ++pass) {
                ::juce::Graphics graphics(again);
                painter.paint(graphics, published.content.scenePaint, elsewhere);
            }
            check(painter.bitmapCache().counters().builds == 1 && painter.bitmapCache().counters().hits == 1, "焦点不在模糊子树里时没有复用模糊缓存");
        }
        {
            // 先画的内容模糊在截取背景时整块可见，截取途中也应命中缓存
            NativeScene scene;
            SceneFramePipeline pipeline;
            PublishedFrame published;
            MutationTransaction initial;
            initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, {{size(180, 140), {}}}}, CreateNodeMutation{2, NodeType::Layout}, policy(2, "Box"), SetModifierMutation{2, {{size(90, 140), {}}, {effect(EffectKind::Blur, 4), {}}, {background(0xffff0000), {}}}}, CreateNodeMutation{3, NodeType::Layout}, policy(3, "Box"), SetModifierMutation{3, {{size(180, 140), {}}, {effect(EffectKind::BackdropBlur, 6), {}}}}, InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}};
            check(!pipeline.run(scene, 1, {0, 180, 0, 140}, &initial, true, published).error, "模糊加背景模糊场景失败");
            ::juce::Image image(::juce::Image::ARGB, 180, 140, true);
            arrange::juce::JuceDrawOpsPainter painter;
            {
                ::juce::Graphics graphics(image);
                painter.paint(graphics, published.content.scenePaint);
            }
            const auto before = painter.bitmapCache().counters();
            {
                ::juce::Graphics graphics(image);
                painter.paint(graphics, published.content.scenePaint);
            }
            const auto after = painter.bitmapCache().counters();
            // 第二帧：内容模糊在正常绘制与截取背景中各命中一次，背景模糊按像素摘要命中一次
            check(after.builds == before.builds && after.hits == before.hits + 3, "截取背景途中没有复用子树外的内容模糊");
        }
        {
            // 左半黑块之上叠一层全幅背景模糊：边界两侧被抹匀，远处保持原样
            NativeScene scene;
            SceneFramePipeline pipeline;
            PublishedFrame published;
            MutationTransaction initial;
            initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, {{size(180, 140), {}}}}, CreateNodeMutation{2, NodeType::Layout}, policy(2, "Box"), SetModifierMutation{2, {{size(90, 140), {}}, {background(0xff000000), {}}}}, CreateNodeMutation{3, NodeType::Layout}, policy(3, "Box"), SetModifierMutation{3, {{size(180, 140), {}}, {effect(EffectKind::BackdropBlur, 6), {}}}}, InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}};
            check(!pipeline.run(scene, 1, {0, 180, 0, 140}, &initial, true, published).error, "背景模糊场景失败");
            ::juce::Image image(::juce::Image::ARGB, 180, 140, true);
            arrange::juce::JuceDrawOpsPainter painter;
            {
                ::juce::Graphics graphics(image);
                painter.paint(graphics, published.content.scenePaint);
            }
            check(image.getPixelAt(30, 70).getAlpha() == 255 && image.getPixelAt(30, 70).getBrightness() < 0.05f, "背景模糊改变了远离边界的内容");
            check(image.getPixelAt(93, 70).getAlpha() > 20, "背景模糊没有把黑块抹到边界之外");
            check(image.getPixelAt(170, 70).getAlpha() == 0, "背景模糊在远处凭空出现内容");
            const auto before = painter.bitmapCache().counters();
            {
                ::juce::Graphics graphics(image);
                painter.paint(graphics, published.content.scenePaint);
            }
            check(painter.bitmapCache().counters().hits > before.hits, "背景像素未变时没有复用模糊结果");
        }
    }

    std::shared_ptr<const arrange::juce::JucePainterContent> imageContent(int width, int height, const std::function<std::uint32_t(int, int)>& color) {
        auto content = std::make_shared<arrange::juce::JucePainterContent>();
        content->image = ::juce::Image(::juce::Image::ARGB, width, height, true);
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x) content->image.setPixelAt(x, y, ::juce::Colour(color(x, y)));
        content->intrinsicSize = Size{static_cast<float>(width), static_cast<float>(height)};
        return content;
    }

    bool rejectedValue(const ModifierValue& value) {
        try {
            validateModifierValue(value);
        } catch (const std::invalid_argument&) {
            return true;
        }
        return false;
    }

    ::juce::Image paintScene(PaintModifier paint, float width, float height) {
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        paint.sizeToIntrinsics = false;
        paint.contentScale = ContentScale::FillBounds;
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, policy(1, "Box"), SetModifierMutation{1, {{size(width, height), {}}, {paint, {}}}}};
        check(!pipeline.run(scene, 1, {0, 180, 0, 140}, &initial, true, published).error, "图片铺放场景失败");
        return render(published);
    }

    void verifyImages() {
        constexpr std::uint32_t red = 0xffff0000, green = 0xff00ff00, blue = 0xff0000ff, white = 0xffffffff;
        {
            // 竖向四帧 filmstrip，选第 3 帧；固有尺寸为单帧
            PaintModifier paint;
            paint.painter.content = imageContent(10, 40, [&](int, int y) { return std::array{red, green, blue, white}[static_cast<std::size_t>(y / 10)]; });
            paint.painter.frames = 4;
            paint.painter.frame = 2;
            check(painterIntrinsicSize(paint.painter) == Size{10, 10}, "filmstrip 固有尺寸没有取单帧");
            const auto image = paintScene(paint, 20, 20);
            check(image.getPixelAt(10, 10).getARGB() == blue && image.getPixelAt(1, 1).getARGB() == blue, "filmstrip 没有只画所选帧");
            paint.painter.frame = 4;
            check(rejectedValue(paint), "filmstrip 帧下标越界没有拒绝");
        }
        {
            // 4x4 左红右蓝平铺进 16x8：按固有尺寸重复
            PaintModifier paint;
            paint.painter.content = imageContent(4, 4, [&](int x, int) { return x < 2 ? red : blue; });
            paint.repeat = ImageRepeat::Tile;
            const auto image = paintScene(paint, 16, 8);
            check(image.getPixelAt(0, 1).getARGB() == red && image.getPixelAt(3, 1).getARGB() == blue && image.getPixelAt(4, 5).getARGB() == red && image.getPixelAt(15, 6).getARGB() == blue && image.getPixelAt(17, 1).getAlpha() == 0, "平铺没有按固有尺寸重复或越出范围");
        }
        {
            // 9x9 四角 3x3 为红、其余为蓝，九宫格放大到 60x30：四角保持 3x3
            PaintModifier paint;
            paint.painter.content = imageContent(9, 9, [&](int x, int y) { return (x < 3 || x >= 6) && (y < 3 || y >= 6) ? red : blue; });
            paint.repeat = ImageRepeat::NinePatch;
            paint.slices = {3, 3, 3, 3};
            const auto image = paintScene(paint, 60, 30);
            check(image.getPixelAt(1, 1).getRed() > 200 && image.getPixelAt(58, 28).getRed() > 200, "九宫格四角没有保持源图");
            check(image.getPixelAt(30, 1).getBlue() > 200 && image.getPixelAt(6, 15).getBlue() > 200 && image.getPixelAt(30, 15).getBlue() > 200, "九宫格边与中心没有拉伸");
            paint.slices = {6, 0, 6, 0};
            check(rejectedValue(paint), "九宫格切分超过固有尺寸没有拒绝");
        }
        {
            // 像素缓冲与 filmstrip 视图经 QuickJS 进入绘制命令：2x1 红蓝像素平滑放大
            DrawFixture fixture;
            const auto error = fixture.run(R"JS(
                const n = globalThis.__ARRANGE_NATIVE__
                const buffer = n.createPixelBuffer(2, 1)
                const version = n.commitPixelBuffer(buffer, Uint32Array.of(0xffff0000, 0xff0000ff))
                const whole = {...buffer, contentVersion: version}
                const frame = {...whole, frames: 2, frame: 1, horizontal: true}
                globalThis.record = () => ({ops: Float64Array.of(12, 0, 0,0,80,20, 1, -1, 2, 5, 0, 0,0,0,0, 12, 1, 0,40,20,20, 1, -1, 2, 5, 0, 0,0,0,0), refs: [whole, frame]})
                n.beginRearrange()
                n.createNode(1,'LayoutNode')
                n.updateBinding(n.registerBinding(1,'measurePolicy'),{kind:'Box'})
                n.setModifier(1,{elements:[{type:'size',value:{width:120,height:100}},{type:'drawBehind',value:{prepare:globalThis.record,revision:0}}]})
                n.submitRearrange(()=>{})
            )JS");
            if (error) throw std::runtime_error(*error);
            const auto& commands = *fixture.scene.node(1).modifier.elements()[1].preparedDraw;
            check(commands.size() == 2 && commands[0].painter.contentVersion == 2 && commands[1].painter.frames == 2 && commands[1].painter.frame == 1 && commands[1].painter.horizontal, "像素缓冲或 filmstrip 视图没有解码");
            const auto image = render(fixture.published);
            check(image.getPixelAt(4, 10).getRed() > 200 && image.getPixelAt(75, 10).getBlue() > 200, "像素缓冲没有按像素绘制");
            check(image.getPixelAt(40, 10).getRed() > 40 && image.getPixelAt(40, 10).getBlue() > 40, "像素缓冲没有平滑缩放");
            check(image.getPixelAt(10, 50).getARGB() == blue, "像素缓冲的 filmstrip 视图没有取第二帧");
            const auto rejected = [&](const char* source, const char* expected) {
                const auto result = arrange::quickjs::QuickJsScriptHost().executeModule("pixels.js", source);
                if (result.ok || result.error.find(expected) == std::string::npos) throw std::runtime_error(std::string("像素缓冲非法输入没有拒绝：") + expected + "，实际：" + result.error);
            };
            rejected("globalThis.__ARRANGE_NATIVE__.createPixelBuffer(0, 4)", "边长");
            rejected("const n = globalThis.__ARRANGE_NATIVE__; n.commitPixelBuffer(n.createPixelBuffer(2, 2), Uint32Array.of(1))", "长度");
        }
    }

    std::string nativeScript(const char* name, const char* params) {
        return std::string(R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            globalThis.record = () => ({ops: Float64Array.of(14, 0, 10,10,60,40, 1, 0, 9), refs: [')JS") +
               name + "', " + params + R"JS(]})
            n.beginRearrange()
            n.createNode(1,'LayoutNode')
            n.updateBinding(n.registerBinding(1,'measurePolicy'),{kind:'Box'})
            n.setModifier(1,{elements:[{type:'size',value:{width:120,height:100}},{type:'drawBehind',value:{prepare:globalThis.record,revision:0}}]})
            n.submitRearrange(()=>{})
        )JS";
    }

    void verifyNativePainters() {
        using arrange::core::NativeParamKind;
        std::string seenSource;
        arrange::juce::registerNativePainter("测试填充", {{"color", NativeParamKind::Color}, {"inset", NativeParamKind::Number}, {"outline", NativeParamKind::Boolean}, {"source", NativeParamKind::Source}}, [&](::juce::Graphics& g, ::juce::Rectangle<float> area, const NativePainterParams& params) {
            seenSource = std::string(params.source("source"));
            g.setColour(::juce::Colour(params.color("color")));
            // 故意越界绘制，重放应裁到目标矩形
            g.fillRect(area.expanded(20.0f).reduced(static_cast<float>(params.number("inset"))));
            if (params.boolean("outline")) g.drawRect(area, 1.0f);
        });
        DrawFixture fixture;
        const auto error = fixture.run(nativeScript("测试填充", "{color: 0xffff0000, inset: 0, outline: false, source: 'meter.out'}"));
        if (error) throw std::runtime_error(*error);
        const auto& command = fixture.scene.node(1).modifier.elements()[1].preparedDraw->front();
        check(command.kind == DrawCommandKind::Native && command.native && command.native->name == "测试填充" && command.nativeParams->number("inset") == 0 && command.nativeParams->source("source") == "meter.out", "原生 painter 命令解码错误");
        const auto bounds = fixture.scene.node(1).paintCache->bounds;
        check(bounds.known && bounds.rect.x >= 8 && bounds.rect.x + bounds.rect.width <= 72, "原生 painter 的边界不是目标矩形");
        const auto image = render(fixture.published);
        check(image.getPixelAt(40, 30).getARGB() == 0xffff0000 && image.getPixelAt(5, 30).getAlpha() == 0 && image.getPixelAt(75, 30).getAlpha() == 0, "原生 painter 没有裁到目标矩形");
        check(seenSource == "meter.out", "原生 painter 没有收到数据源名");

        // 同名重新注册即重新绑定，热更新后按名称取新实现
        arrange::juce::registerNativePainter("测试填充", {{"color", NativeParamKind::Color}, {"inset", NativeParamKind::Number}, {"outline", NativeParamKind::Boolean}, {"source", NativeParamKind::Source}}, [](::juce::Graphics& g, ::juce::Rectangle<float> area, const NativePainterParams&) {
            g.setColour(::juce::Colours::blue);
            g.fillRect(area);
        });
        DrawFixture rebound;
        if (const auto reboundError = rebound.run(nativeScript("测试填充", "{color: 0, inset: 0, outline: false, source: ''}"))) throw std::runtime_error(*reboundError);
        check(render(rebound.published).getPixelAt(40, 30).getARGB() == 0xff0000ff, "重新注册后没有按名称绑定新实现");

        const auto rejects = [](const char* name, const char* params, const char* expected) {
            DrawFixture invalid;
            const auto result = invalid.run(nativeScript(name, params));
            if (!result || result->find(expected) == std::string::npos) throw std::runtime_error(std::string("原生 painter 非法输入没有拒绝：") + expected + "，实际：" + result.value_or("通过"));
        };
        rejects("不存在", "{}", "未注册");
        rejects("测试填充", "{color: 0, inset: 0, outline: false}", "缺少参数 'source'");
        rejects("测试填充", "{color: 0, inset: 0, outline: false, source: '', extra: 1}", "不接受参数 'extra'");
        rejects("测试填充", "{color: -1, inset: 0, outline: false, source: ''}", "uint32 颜色");
        rejects("测试填充", "{color: 0, inset: 0, outline: 1, source: ''}", "布尔值");
        rejects("测试填充", "{color: 0, inset: 'a', outline: false, source: ''}", "有限数值");
        arrange::juce::unregisterNativePainter("测试填充");
        rejects("测试填充", "{color: 0, inset: 0, outline: false, source: ''}", "未注册");
    }

    // 只提供 painter 注册表的宿主，其余能力一律为空
    class PainterOnlyHost final : public arrange::core::InteropHost {
       public:
        arrange::core::NativePainterRegistry painters;

        void attach(arrange::core::InteropSessionSink&) override {}

        void detach(arrange::core::InteropSessionSink&) noexcept override {}

        const std::vector<arrange::core::InteropParameter>& parameters() const override {
            return parameters_;
        }

        float parameterValue(std::size_t) const override {
            return 0;
        }

        void takeParameterChanges(std::vector<std::size_t>&) override {}

        double toPlain(std::size_t, float normalized) const override {
            return normalized;
        }

        float toNormalized(std::size_t, double plain) const override {
            return static_cast<float>(plain);
        }

        std::string text(std::size_t, float) const override {
            return {};
        }

        std::optional<float> parse(std::size_t, std::string_view) const override {
            return std::nullopt;
        }

        void beginGesture(std::size_t) override {}

        void setParameter(std::size_t, float) override {}

        void endGesture(std::size_t) override {}

        arrange::core::InteropHostInfo hostInfo() const override {
            return {};
        }

        arrange::core::InteropTransport transport() const override {
            return {};
        }

        bool hasMeter(std::string_view) const override {
            return false;
        }

        float takeMeter(std::string_view) override {
            return 0;
        }

        std::optional<std::size_t> waveformCapacity(std::string_view) const override {
            return std::nullopt;
        }

        std::uint64_t readWaveform(std::string_view, std::span<float>) const override {
            return 0;
        }

        std::optional<std::size_t> spectrumSize(std::string_view) const override {
            return std::nullopt;
        }

        bool readSpectrum(std::string_view, std::span<float>) override {
            return false;
        }

        void invoke(std::string_view, const arrange::core::InteropValue&, arrange::core::InteropReply reply) override {
            reply.reject("无");
        }

        const arrange::core::NativePainterRegistry* nativePainters() const noexcept override {
            return &painters;
        }

       private:
        std::vector<arrange::core::InteropParameter> parameters_;
    };

    // 实例注册表先于进程级注册表：两个实例同名各画各的，实例里没有的名称回落到进程级
    void verifyInstanceNativePainters() {
        using arrange::core::NativeParamKind;
        const auto solid = [](std::uint32_t color) {
            return std::make_shared<const arrange::juce::NativePaint>([color](::juce::Graphics& g, ::juce::Rectangle<float> area, const NativePainterParams&) {
                g.setColour(::juce::Colour(color));
                g.fillRect(area);
            });
        };
        const std::vector<arrange::core::NativeParamSpec> params{{"source", NativeParamKind::Source}};
        arrange::juce::registerNativePainter("实例填充", params, *solid(0xff00ff00));
        arrange::juce::registerNativePainter("进程填充", params, *solid(0xffffff00));
        const auto colorOf = [&](PainterOnlyHost* instance, const char* name) {
            DrawFixture fixture;
            if (instance) fixture.host.setInteropHost(instance);
            if (const auto error = fixture.run(nativeScript(name, "{source: 'out'}"))) throw std::runtime_error(*error);
            return render(fixture.published).getPixelAt(40, 30).getARGB();
        };
        PainterOnlyHost first, second;
        first.painters.add({"实例填充", params, solid(0xffff0000)});
        second.painters.add({"实例填充", params, solid(0xff0000ff)});
        check(colorOf(&first, "实例填充") == 0xffff0000 && colorOf(&second, "实例填充") == 0xff0000ff, "两个实例的同名 painter 没有各画各的");
        check(colorOf(nullptr, "实例填充") == 0xff00ff00, "没有实例宿主时没有使用进程级注册项");
        check(colorOf(&first, "进程填充") == 0xffffff00, "实例里没有的名称没有回落到进程级注册表");
        arrange::juce::unregisterNativePainter("实例填充");
        arrange::juce::unregisterNativePainter("进程填充");
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
        verifyTransformedClickArea();
        verifyFocusedInputPaintOrder();
        verifyM5DrawCommands();
        verifyGradientCorners();
        verifyEffects();
        verifyImages();
        verifyNativePainters();
        verifyInstanceNativePainters();
        verifySfaDraw(argv[1]);
        std::cout << "M3 绘制准备、共享内容、变换和排序验收通过\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
