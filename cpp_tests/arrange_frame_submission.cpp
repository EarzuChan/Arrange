#include "TextFixtures.h"
#include <arrange/juce/ScenePipelineState.h>
#include <arrange/juce/EditorSceneHost.h>
#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/VBlankSource.h>
#include <arrange/juce/TextInputOwner.h>
#include <arrange/juce/FramePumpDriver.h>
#include <arrange/juce/RuntimeSessionState.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/PointerInputState.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/core/ModifierGeometry.h>
#include <algorithm>
#include <cmath>

#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    class FailingTextMeasurer final : public ApproximateTextMeasurer {
       public:
        bool failing = false;

        float advance(std::string_view, char32_t, const TextStyle&) const override {
            if (failing) throw std::runtime_error("text measurement unavailable");
            return 8;
        }
    };

    LayoutModifierSemantics fixedSize(float width, float height) {
        LayoutModifierSemantics value;
        value.kind = LayoutModifierKind::Size;
        value.width = width;
        value.height = height;
        return value;
    }

    void verifyInputGeometryAndRetirement() {
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService text(measurer);
        LayoutTree tree;
        TransformModifierSemantics outer;
        outer.translationX = 30;
        outer.scaleX = outer.scaleY = 1.25f;
        outer.transformOriginX = outer.transformOriginY = 0;
        TransformModifierSemantics inner;
        inner.translationX = 10;
        inner.scaleX = inner.scaleY = 1.5f;
        inner.transformOriginX = inner.transformOriginY = 0;
        LayoutModifierSemantics padding;
        padding.kind = LayoutModifierKind::Padding;
        padding.padding.start = padding.padding.top = padding.padding.end = padding.padding.bottom = 10;
        auto field = test_support::textField("abcdef");
        field.onValueChange = makeEventSlotId(2, EventSlotKind::InputUpdate, "编辑");
        tree.apply({CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, CreateNodeMutation{2, arrange::core::NodeType::Layout}, SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, SetModifierMutation{1, {{fixedSize(400, 200), {}}, {outer, {}}, {ClipModifier{}, {}}}}, SetModifierMutation{2, {{fixedSize(220, 60), {}}, {padding, {}}, {inner, {}}, {ClipModifier{}, {}}, {field, "编辑"}}}, InsertChildMutation{1, 2, 0}});
        LayoutEngine(text).layout(tree, 1, {0, 500, 0, 400});
        const auto content = tree.node(2).contentBounds;
        const auto point = nodeContentToRoot(tree, 2, {content.x + 1, content.y + 1});
        const auto local = rootToNodeContent(tree, 2, point);
        check(std::fabs(local.x - content.x - 1) < 0.001f, "Nested content coordinate roundtrip failed");
        const auto hit = HitTester{}.hitTest(buildHitTestSnapshot(tree, 1), point);
        check(hit.hit && hit.node == 2, "Transformed input could not be hit");
        arrange::juce::TextInputOwner input(text);
        input.pointerDown(tree, hit, point.x, point.y, {});
        check(input.isTextInputActive(tree, true) && input.caretPosition(tree, true) == 0, "Input caret used node outer coordinates");
        const auto caret = input.caretRectangleForCharIndex(tree, true, 3);
        check(input.charIndexForPoint(tree, true, caret.getCentre()) == 3, "IME rectangle/point mapping disagreed");
        const auto overlay = input.buildFocusedInputOps(tree, true);
        const auto transforms = std::count_if(overlay.begin(), overlay.end(), [](const auto& op) { return op.type == DrawOpType::PushTransform; });
        const auto clips = std::count_if(overlay.begin(), overlay.end(), [](const auto& op) { return op.type == DrawOpType::PushClip; });
        check(transforms == 2 && clips >= 2, "Caret overlay escaped ancestor onion geometry");
        const auto receiver = test_support::editable(tree.node(2))->handle;

        std::vector<std::pair<EventSlotId, std::string>> edits;
        arrange::juce::TextInputCallbacks callbacks;
        callbacks.invokeStringEvent = [&](const EventSlotId& slot, const std::string& value) {
            edits.emplace_back(slot, value);
        };
        check(input.setHighlightedRegion(tree, true, {1, 3}, callbacks), "编辑受体未接受选区");
        check(input.highlightedRegion(tree, true) == ::juce::Range<int>(1, 3), "选区没有按字符索引保存");
        ::juce::Array<::juce::Range<int>> underlines;
        underlines.add({1, 3});
        check(input.setTemporaryUnderlining(tree, true, underlines, callbacks), "编辑受体未接受 IME 临时下划线");
        const auto compositionOps = input.buildFocusedInputOps(tree, true);
        check(compositionOps.size() > overlay.size(), "选区及 IME 下划线没有产生绘制操作");
        check(input.insertTextAtCaret(tree, true, ::juce::String::fromUTF8("中"), callbacks), "IME 提交未替换当前选区");
        check(edits.size() == 1 && edits[0].first == field.onValueChange && edits[0].second == "a中def", "IME 回调未使用 TextField Modifier 的字段或字符边界错误");
        check(input.caretPosition(tree, true) == 2 && test_support::textOf(tree.node(2)) == "abcdef", "IME 编辑越过回调直接修改了已发布模型");

        tree.setModifierInput(2, receiver, test_support::textField("新"));
        input.synchronizePublishedInput(tree, true);
        input.updateFocusedInputViewport(tree, true);
        check(input.totalNumChars(tree, true) == 1 && input.textInRange(tree, true, {0, 1}).toStdString() == "新", "published external model value did not replace the editing session");
        tree.setHostInput(1, HostInput::Enabled, PropValue::booleanValue(false));
        check(!HitTester{}.hitTest(buildHitTestSnapshot(tree, 1), point).hit && !input.isTextInputActive(tree, true), "Disabled ancestor retained input interest");
        tree.setHostInput(1, HostInput::Enabled, PropValue::booleanValue(true));

        const auto generation = tree.node(2).generation;
        tree.setModifierChain(2, {{fixedSize(220, 60)}, {padding}, {inner}, {ClipModifier{}}, {field, "替换编辑"}});
        check(tree.node(2).generation == generation && test_support::editable(tree.node(2))->handle != receiver, "编辑受体替换测试没有保留节点并更换 Modifier 身份");
        check(!input.isTextInputActive(tree, true), "旧编辑会话转移到了新 Modifier");
        check(!input.setHighlightedRegion(tree, true, {0, 1}, callbacks), "迟到选区修改命中了新受体");
        check(!input.setTemporaryUnderlining(tree, true, underlines, callbacks), "迟到 IME 下划线命中了新受体");
        check(!input.insertTextAtCaret(tree, true, ::juce::String::fromUTF8("迟到"), callbacks) && edits.size() == 1, "迟到 IME 提交触发了新受体回调");
        input.synchronizePublishedInput(tree, true);
        check(!input.focusedNode(), "退休 Modifier 的焦点没有清理");
        LayoutEngine(text).layout(tree, 1, {0, 500, 0, 400});
        const auto replacementHit = HitTester{}.hitTest(buildHitTestSnapshot(tree, 1), point);
        input.pointerDown(tree, replacementHit, point.x, point.y, {});
        check(input.isTextInputActive(tree, true) && input.focusedModifier() == replacementHit.modifier, "新 Modifier 未能建立独立编辑会话");

        tree.apply({DeleteNodeMutation{2}, CreateNodeMutation{2, arrange::core::NodeType::Layout}, SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, InsertChildMutation{1, 2, 0}});
        check(!input.isTextInputActive(tree, true), "Focus transferred to a reused node id");
        input.updateFocusedInputViewport(tree, true);
        check(!input.focusedNode(), "Retired focus was not cleared");
    }

    void verifyWheelAccumulation() {
        LayoutTree tree;
        LayoutModifierSemantics scroll;
        scroll.kind = LayoutModifierKind::VerticalScroll;
        scroll.enabled = true;
        tree.apply({CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Column")}})}, CreateNodeMutation{2, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, SetModifierMutation{1, {{fixedSize(100, 100), {}}, {scroll, {}}}}, SetModifierMutation{2, {{fixedSize(100, 400), {}}}}, InsertChildMutation{1, 2, 0}});
        LayoutEngine{}.layout(tree, 1, {0, 500, 0, 500});
        arrange::juce::PointerInputState pointer;
        const auto first = pointer.wheel(tree, 1, {20, 20}, 0, -1, 1);
        const auto second = pointer.wheel(tree, 1, {20, 20}, 0, -1, 1);
        check(first.scroll.value == 48 && second.scroll.value == 96, "Same-frame wheel lost accumulated delta");
        check(ScrollDispatcher::verticalScrollValue(tree.node(1)) == 0, "Wheel mutated published geometry early");
        const auto nextFrame = pointer.wheel(tree, 1, {20, 20}, 0, -1, 2);
        check(nextFrame.scroll.value == 48, "New publication retained obsolete wheel prediction");
        pointer.reset();
        check(pointer.wheel(tree, 1, {20, 20}, 0, -1, 2).scroll.value == 48, "Reset retained wheel prediction");
    }

    void verifyManualVBlankExecution() {
        auto host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        const auto loaded = host->executeModule("vblank-execution.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            n.createNode(1, 'LayoutNode')
            let ticks = 0
            const sample = () => {
                n.setModifier(1, {elements: [{type: 'text', value: {text: String(++ticks)}}]})
                requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
        )JS");
        check(loaded.ok, "manual VBlank script failed");
        arrange::juce::ArrangeRuntime runtime;
        runtime.enqueue(std::move(*host->takePendingTransaction()));
        runtime.setScriptHost(std::move(host));
        arrange::juce::ManualVBlankSource source;
        arrange::juce::VBlankFrameDriver driver(source);
        int frames = 0;
        const auto tick = [&](double timestamp) {
            ++frames;
            // 同帧重入源不会重复采样动画
            source.pulse(timestamp + 0.1);
            check(runtime.pumpFrame(1, {0, 400, 0, 300}, timestamp).ok, "manual VBlank frame failed");
        };
        driver.start(tick);
        source.pulse(100);
        check(frames == 1 && test_support::textOf(runtime.scene().node(1)) == "1", "first VBlank did not sample exactly once");
        source.pulse(100);
        source.pulse(99);
        source.pulse(std::numeric_limits<double>::quiet_NaN());
        check(frames == 1, "duplicate or invalid VBlank produced a frame");
        source.pulse(116);
        check(frames == 2 && test_support::textOf(runtime.scene().node(1)) == "2", "animation rescheduled into the same VBlank");
        driver.stop();
        source.pulse(132);
        check(frames == 2, "stopped VBlank source kept executing");
        driver.start(tick);
        source.pulse(148);
        check(frames == 3 && test_support::textOf(runtime.scene().node(1)) == "3", "VBlank source did not resume pending animation");
    }

    void verifyHostResourceFailureAndPassivePaint() {
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService text(measurer);
        arrange::juce::ArrangeRuntime runtime{SceneFramePipeline{LayoutEngine{text}}};
        arrange::juce::RuntimeSessionState session;
        arrange::juce::DiagnosticsState diagnostics;
        arrange::juce::InteractionStateOwner interaction(text);
        arrange::juce::PassivePaintRenderer paint(text);
        arrange::juce::FramePumpDriver driver;
        session.resize(400, 300, runtime);
        session.markLoaded();
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}};
        runtime.enqueue(std::move(initial));
        const auto pump = [&](double now) {
            return driver.pumpFrame(runtime, session, diagnostics, interaction, paint, 1, {}, {0, 0, 400, 300}, true, {}, now);
        };
        check(pump(0) && !diagnostics.hasError(), "production host initial frame failed");
        const auto previous = runtime.publishedFrame();
        MutationTransaction missingImage;
        missingImage.operations = {
            CreateNodeMutation{2, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, InsertChildMutation{1, 2, 0}, SetModifierMutation{2, {{fixedSize(30, 30), {}}}}, SetPropMutation{2, "src", PropValue::stringValue("missing-frame-resource.png")},
        };
        runtime.enqueue(std::move(missingImage));
        check(pump(16) && diagnostics.hasError(), "resource failure did not reach host diagnostics");
        check(!runtime.scene().contains(2) && runtime.publishedFrame().content.hitTest == previous.content.hitTest && runtime.publishedFrame().content.errorFrame && runtime.publishedFrame().revision == previous.revision + 1, "resource failure published candidate geometry or multiple frames");
        check(!runtime.hasPendingFrameWork() && !session.loaded(), "failed context continued producing visual work");
        const auto counters = runtime.frameCounters();
        const auto revision = runtime.publishedFrame().revision;
        ::juce::Image image(::juce::Image::ARGB, 400, 300, true);
        ::juce::Graphics graphics(image);
        const auto paintCount = paint.fullViewportPaints();
        paint.paint(graphics, runtime.publishedFrame());
        paint.paint(graphics, runtime.publishedFrame());
        check(paint.fullViewportPaints() == paintCount + 2 && !paint.lastFullPaintReason().empty(), "passive raster execution counters did not match actual paint calls");
        check(runtime.publishedFrame().revision == revision && runtime.frameCounters().measures == counters.measures && runtime.frameCounters().publications == counters.publications, "paint ran preparation or published state");
        session.reset(runtime, diagnostics, interaction);
        paint.clearResources();
        session.markLoaded();
        MutationTransaction reload;
        reload.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}};
        runtime.enqueue(std::move(reload));
        check(pump(32) && !diagnostics.hasError() && !runtime.publishedFrame().content.errorFrame, "reset did not recover suspended host");
        session.reset(runtime, diagnostics, interaction);
        session.markLoaded();
        const auto idleMeasures = runtime.frameCounters().measures;
        check(pump(48) && diagnostics.hasError() && !session.loaded(), "idle finalization failure escaped the host error boundary");
        check(runtime.frameCounters().measures == idleMeasures && runtime.publishedFrame().content.errorFrame, "idle failure ran a scene pipeline or lost its diagnostic publication");
    }

    void verifyReloadAtFrameBoundary() {
        // Use the real package loader and passive renderer, including script requests
        // issued in an animation callback after initial module evaluation has finished.
        ::juce::TemporaryFile temporary(".arrange-reload");
        const auto directory = temporary.getFile();
        check(directory.createDirectory().wasOk(), "reload package directory failed");
        const auto entry = directory.getChildFile("app.js");
        const auto writePackage = [&](const char* color, const char* request) {
            const auto source = std::string("const n = globalThis.__ARRANGE_NATIVE__;\n") + "void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}));\n" + "n.setModifier(1, {elements: [{type: 'size', value: {width: 100, height: 100}}," + "{type: 'background', value: {color: " + color + "}}]});\n" + request;
            check(entry.replaceWithText(source), "reload package write failed");
        };
        arrange::juce::EditorSceneHost host;
        arrange::juce::EditorConfig config;
        config.app.useDist(directory.getFullPathName().toStdString());
        config.diagnostics.badge = arrange::juce::DiagnosticVisibility::Hidden;
        config.diagnostics.toasts = arrange::juce::DiagnosticVisibility::Hidden;
        const auto pixel = [&] {
            ::juce::Image image(::juce::Image::ARGB, 100, 100, true);
            {
                ::juce::Graphics graphics(image);
                host.paint(graphics, {0, 0, 100, 100});
            }
            return image.getPixelAt(50, 50).getARGB();
        };
        double timestamp = 0;
        const auto pulse = [&] {
            (void)host.pumpFrame(timestamp += 16);
        };
        writePackage("0xffff0000", "requestAnimationFrame(() => n.reload({path: 'app.js'}));");
        host.configure(config);
        host.resized(100, 100);
        pulse();
        check(pixel() == 0xffff0000, "initial reload package did not publish");
        check(host.wantsVBlank(), "post-evaluation script reload did not retain the frame clock");
        writePackage("0xff0000ff", "");
        pulse();  // Drain script actions; the request remains pending for the next frame boundary.
        check(pixel() == 0xffff0000 && host.wantsVBlank(), "script reload escaped its frame boundary");
        pulse();
        check(pixel() == 0xff0000ff && !host.wantsVBlank(), "script reload did not load or settle");
        writePackage("0xff00ff00", "");
        host.manualReload(false);
        check(pixel() == 0xff0000ff && host.wantsVBlank(), "manual reload replaced published content before VBlank");
        pulse();
        check(pixel() == 0xff00ff00, "manual reload failed to load the new package");
        writePackage("0xffff0000", "requestAnimationFrame(() => n.diagnosticsRequestReload({}));");
        host.reloadFromDevServer();
        pulse();
        check(pixel() == 0xffff0000, "HMR request did not use the package load boundary");
        writePackage("0xff0000ff", "");
        pulse();
        pulse();
        check(pixel() == 0xff0000ff && !host.wantsVBlank(), "diagnostic reload did not share the real reload consumer");
        check(directory.deleteRecursively(), "reload fixture cleanup failed");
    }

    void verifyFinalPublication() {
        arrange::juce::ScenePipelineState state;
        const Constraints constraints{0, 400, 0, 300};
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}, SetModifierMutation{1, {{fixedSize(100, 100), {}}}}};
        state.enqueue(std::move(initial));
        check(!state.run(1, constraints, true).error, "initial finalization frame failed");
        const auto previous = state.publishedFrame();
        MutationTransaction candidate;
        candidate.operations = {CreateNodeMutation{2, arrange::core::NodeType::Layout}, SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, InsertChildMutation{1, 2, 0}};
        state.enqueue(candidate);
        const auto failed = state.run(1, constraints, true, [&](const auto& scene, auto& frame) {
            check(scene.contains(2) && !state.scene().contains(2), "finalizer did not receive isolated candidate scene");
            check(frame.content.hitTest != previous.content.hitTest, "finalizer ran before hit construction");
            frame.content.overlayDrawOps.push_back(DrawOp{});
            throw std::runtime_error("resource preparation failed");
        });
        check(failed.error && !state.scene().contains(2) && state.publishedFrame().revision == previous.revision && state.publishedFrame().content.overlayDrawOps.empty(), "finalizer failure published partial geometry or attachments");
        check(state.publishRetained([](const auto&, auto& frame) { frame.content.errorFrame = "failed"; }), "retained error did not publish");
        check(!state.scene().contains(2) && state.publishedFrame().content.hitTest == previous.content.hitTest, "error publication replayed failed structure");
        state.enqueue(std::move(candidate));
        check(!state
                   .run(1, constraints, true,
                        [](const auto&, auto& frame) {
                            frame.content.errorFrame.reset();
                            DrawOp transform;
                            transform.type = DrawOpType::PushTransform;
                            transform.translationX = 12;
                            frame.content.overlayDrawOps = {transform};
                        })
                   .error,
              "finalized retry failed");
        check(state.scene().contains(2) && !state.publishedFrame().content.errorFrame && state.publishedFrame().revision == previous.revision + 2, "scene/attachments did not share one publication");
        const auto measures = state.counters().measures;
        check(state.publishRetained([](const auto&, auto& frame) { frame.content.overlayDrawOps[0].translationX = 24; }), "transform-only overlay change was ignored");
        check(state.counters().measures == measures && state.publishedFrame().plan.passivePaint, "overlay change ran layout or missed repaint");
        check(!state.publishRetained([](const auto&, auto&) {}), "identical attachments produced a publication");
        check(state.counters().publications == state.publishedFrame().revision, "publication counter diverged from revisions");
    }

    void verifyFailedSubmissionRollback() {
        FailingTextMeasurer measurer;
        TextLayoutService text(measurer);
        arrange::juce::ScenePipelineState state{SceneFramePipeline{LayoutEngine{text}}};
        const Constraints constraints{0, 400, 0, 300};
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Column")}})}};
        state.enqueue(std::move(initial));
        check(!state.run(1, constraints, true).error, "initial publication failed");
        const auto previousFrame = state.publishedFrame();
        const NodeHandle child{2, allocateRuntimeIdentity()};
        const BindingHandle content{allocateRuntimeIdentity(), 1};
        MutationTransaction create;
        create.operations = {
            CreateNodeMutation{2, arrange::core::NodeType::Layout, child.generation}, SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, RegisterBinding{content, ModifierChainTarget{child}}, SlotUpdate{content, ModifierDescriptors{{test_support::text("first"), {}}}}, InsertChildMutation{1, 2, 0},
        };
        state.enqueue(create);
        measurer.failing = true;
        check(state.run(1, constraints, true).error.has_value(), "measurement fault did not fail the frame");
        check(!state.scene().contains(2) && state.publishedFrame().revision == previousFrame.revision && state.publishedFrame().content.hitTest == previousFrame.content.hitTest, "failed frame changed the published scene or hit geometry");
        check(!state.hasPendingTransactions() && !state.hasPendingIntents(), "failed submission spins without new work");
        measurer.failing = false;
        MutationTransaction later;
        later = create;
        later.operations.emplace_back(SlotUpdate{content, ModifierDescriptors{{test_support::text("latest"), {}}}});
        state.enqueue(std::move(later));
        check(!state.run(1, constraints, true).error, "retry did not recover");
        check(state.scene().contains(2) && test_support::textOf(state.scene().node(2)) == "latest" && state.scene().bindingCount() == 1, "重新提交完整候选未恢复结构与最终值");
        check(state.scene().slotCounters().rejected == 0, "retry rejected a valid write to the created node");
        check(state.publishedFrame().revision == previousFrame.revision + 1, "failed frame was counted as a publication");

        measurer.failing = true;
        MutationTransaction failure;
        failure.operations = {SlotUpdate{content, ModifierDescriptors{{test_support::text("unpublished"), {}}}}};
        state.enqueue(std::move(failure));
        check(state.run(1, constraints, true).error.has_value(), "second fault did not fail");
        state.reset();
        measurer.failing = false;
        MutationTransaction fresh;
        fresh.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})}};
        state.enqueue(std::move(fresh));
        check(!state.run(1, constraints, true).error && !state.scene().contains(2) && state.scene().bindingCount() == 0, "reset replayed the failed previous context");
    }
}  // namespace

int main() {
    try {
        ::juce::ScopedJuceInitialiser_GUI juceInitialiser;
        verifyInputGeometryAndRetirement();
        verifyWheelAccumulation();
        verifyManualVBlankExecution();
        verifyFailedSubmissionRollback();
        verifyFinalPublication();
        verifyHostResourceFailureAndPassivePaint();
        verifyReloadAtFrameBoundary();
        std::cout << "帧提交：失败的测量。候选撤销、显式重新提交与上下文重置通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
