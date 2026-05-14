#include <arrange/core/EventSlot.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/InputEditing.h>
#include <arrange/core/InputIntent.h>
#include <arrange/core/Layout.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Mutation.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/NativeScene.h>
#include <arrange/core/Paint.h>
#include <arrange/core/PointerInputProcessor.h>
#include <arrange/core/PropSchema.h>
#include <arrange/core/PropValue.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/core/Scroll.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/core/Version.h>
#include <arrange/juce/AppResolver.h>
#include <arrange/juce/DevServerClient.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/FramePlanner.h>
#include <arrange/juce/HeadlessArrangeEditor.h>
#include <arrange/juce/ScenePipelineState.h>
#include <arrange/quickjs/AppScriptLoader.h>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <optional>
#include <utility>
#include <string>
#include <string_view>
#include <vector>

namespace {
    bool near(float actual, float expected, float epsilon = 0.01f) {
        return std::fabs(actual - expected) <= epsilon;
    }

    bool hasDirty(const arrange::core::ArrangeNode& node, arrange::core::DirtyFlag flag) {
        return (node.dirty & arrange::core::dirtyMask(flag)) != 0;
    }

    bool phaseRan(const std::vector<arrange::core::PhaseExecution>& phases, arrange::core::FramePhase phase) {
        for (const auto& execution : phases) {
            if (execution.phase == phase) return execution.ran;
        }
        return false;
    }

    arrange::core::PropValue object(std::vector<arrange::core::PropObjectField> fields) {
        return arrange::core::PropValue::objectValue(std::move(fields));
    }

    arrange::core::PropObjectField field(std::string key, arrange::core::PropValue value) {
        return {std::move(key), std::move(value)};
    }

    arrange::core::CompiledModifier size(float width, float height) {
        arrange::core::CompiledModifier modifier;
        arrange::core::LayoutModifierSemantics item;
        item.kind = arrange::core::LayoutModifierKind::Size;
        item.width = width;
        item.height = height;
        modifier.layout.push_back(item);
        return modifier;
    }

    arrange::core::CompiledModifier background(float width, float height, std::uint32_t color) {
        auto modifier = size(width, height);
        arrange::core::PaintStyleSemantics style;
        style.kind = arrange::core::PaintStyleKind::Background;
        style.color = color;
        style.brush = color;
        modifier.paint.chain.push_back({arrange::core::PaintChainOpKind::Style, style, {}});
        modifier.paint.styles.push_back(style);
        return modifier;
    }

    arrange::core::CompiledModifier clickableBox(float width, float height, arrange::core::EventSlotId slot) {
        auto modifier = background(width, height, 0xff3a7afeu);
        modifier.input.clickable = true;
        modifier.input.focusable = true;
        modifier.input.clickEventSlot = std::move(slot);
        return modifier;
    }

    arrange::core::CompiledModifier verticalScroll(float width, float height, float value, arrange::core::EventSlotId slot) {
        auto modifier = background(width, height, 0xff151922u);
        arrange::core::LayoutModifierSemantics scroll;
        scroll.kind = arrange::core::LayoutModifierKind::VerticalScroll;
        scroll.scrollValue = value;
        modifier.layout.push_back(scroll);
        modifier.scroll.vertical = true;
        modifier.scroll.verticalValue = value;
        modifier.scroll.verticalEventSlot = std::move(slot);
        arrange::core::PaintStyleSemantics clip;
        clip.kind = arrange::core::PaintStyleKind::Background;
        modifier.paint.chain.push_back({arrange::core::PaintChainOpKind::Clip, clip, {}});
        modifier.paint.clips.push_back(clip);
        return modifier;
    }

    arrange::core::MutationTransaction initialTreeTransaction() {
        using namespace arrange::core;
        MutationTransaction transaction;
        transaction.treeMutations = {
            CreateNodeMutation{1, NodeType::Column},
            SetModifierMutation{1, background(320.0f, 180.0f, 0xff000000u)},
            SetPropMutation{1, "verticalArrangement", object({field("kind", PropValue::stringValue("spacedBy")), field("space", PropValue::numberValue(8.0))})},
            CreateNodeMutation{2, NodeType::Text},
            SetTextMutation{2, "Hello typed transaction"},
            SetPropMutation{2, "textStyle", object({field("fontSize", PropValue::numberValue(20.0)), field("color", PropValue::numberValue(0xffe8eaedu))})},
            SetModifierMutation{2, background(220.0f, 32.0f, 0xff3a7afeu)},
            InsertChildMutation{1, 2, 0},
            CreateNodeMutation{3, NodeType::Box},
            SetModifierMutation{3, clickableBox(80.0f, 40.0f, makeEventSlotId(3, EventSlotKind::Click))},
            InsertChildMutation{1, 3, 1},
            CreateNodeMutation{4, NodeType::Column},
            SetModifierMutation{4, verticalScroll(100.0f, 40.0f, 0.0f, makeEventSlotId(4, EventSlotKind::VerticalScroll))},
            InsertChildMutation{1, 4, 2},
            CreateNodeMutation{5, NodeType::Box},
            SetModifierMutation{5, background(100.0f, 80.0f, 0xffffb020u)},
            InsertChildMutation{4, 5, 0},
            CreateNodeMutation{6, NodeType::Input},
            SetPropMutation{6, "modelValue", PropValue::stringValue("Gain")},
            SetPropMutation{6, "placeholder", PropValue::stringValue("Search preset")},
            SetPropMutation{6, "selectAllOnFocus", PropValue::booleanValue(true)},
            SetEventSlotMutation{6, EventSlotKind::InputSubmit, makeEventSlotId(6, EventSlotKind::InputSubmit)},
            SetPropMutation{6, "textStyle", object({field("fontSize", PropValue::numberValue(16.0)), field("color", PropValue::numberValue(0xffffffffu))})},
            SetModifierMutation{6, background(160.0f, 28.0f, 0xff151922u)},
            InsertChildMutation{1, 6, 3},
        };
        transaction.eventSlotUpdates = {
            makeEventSlotId(3, EventSlotKind::Click),
            makeEventSlotId(4, EventSlotKind::VerticalScroll),
            makeEventSlotId(6, EventSlotKind::InputSubmit),
        };
        return transaction;
    }

    int verifyTypedLayoutTreePipeline() {
        arrange::core::LayoutTree tree;
        auto transaction = initialTreeTransaction();
        tree.apply(transaction.treeMutations);
        if (!tree.contains(1) || tree.node(1).children.size() != 4) return 1;
        if (tree.node(2).text != "Hello typed transaction") return 2;
        if (tree.node(6).props.at("modelValue").stringOr() != "Gain") return 3;
        if (!hasDirty(tree.node(1), arrange::core::DirtyFlag::Structure)) return 4;

        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 320.0f, 0.0f, 240.0f});
        if (!near(tree.node(1).bounds.width, 320.0f) || !near(tree.node(1).bounds.height, 180.0f)) return 5;
        if (!near(tree.node(2).bounds.x, 0.0f) || !near(tree.node(2).bounds.y, 0.0f)) return 6;
        if (!near(tree.node(3).bounds.y, 40.0f)) return 7;

        const auto ops = arrange::core::DrawOpsBuilder{}.collect(tree, 1);
        bool sawRoot = false;
        bool sawBlue = false;
        bool sawText = false;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff000000u) sawRoot = true;
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff3a7afeu) sawBlue = true;
            if (op.type == arrange::core::DrawOpType::DrawText && op.text == "Hello typed transaction") sawText = true;
        }
        if (!sawRoot || !sawBlue || !sawText) return 8;
        return 0;
    }

    int verifyTypedDirtyPrecision() {
        arrange::core::LayoutTree tree;
        auto transaction = initialTreeTransaction();
        tree.apply(transaction.treeMutations);
        tree.clearDirty();
        (void)tree.takeInvalidation();

        tree.apply(std::vector<arrange::core::TreeMutation>{
            arrange::core::SetModifierMutation{3, clickableBox(80.0f, 40.0f, arrange::core::makeEventSlotId(3, arrange::core::EventSlotKind::Click, "updated"))},
        });
        auto snapshot = tree.invalidationSnapshot();
        if (!snapshot.affects(arrange::core::DirtyFlag::EventSlot)) return 11;
        if (snapshot.affects(arrange::core::DirtyFlag::Layout)) return 12;
        if (snapshot.affects(arrange::core::DirtyFlag::Paint)) return 13;

        tree.clearDirty();
        (void)tree.takeInvalidation();
        tree.apply(std::vector<arrange::core::TreeMutation>{
            arrange::core::SetModifierMutation{3, background(80.0f, 40.0f, 0xff00ff00u)},
        });
        snapshot = tree.invalidationSnapshot();
        if (!snapshot.affects(arrange::core::DirtyFlag::Paint)) return 14;
        if (snapshot.affects(arrange::core::DirtyFlag::Layout)) return 15;

        tree.clearDirty();
        (void)tree.takeInvalidation();
        tree.apply(std::vector<arrange::core::TreeMutation>{
            arrange::core::SetModifierMutation{3, background(90.0f, 44.0f, 0xff00ff00u)},
        });
        snapshot = tree.invalidationSnapshot();
        if (!snapshot.affects(arrange::core::DirtyFlag::Layout)) return 16;
        if (!snapshot.affects(arrange::core::DirtyFlag::Paint)) return 17;
        return 0;
    }

    int verifyEventPropIsNotCoreEventSlot() {
        arrange::core::LayoutTree tree;
        tree.apply(std::vector<arrange::core::TreeMutation>{
            arrange::core::CreateNodeMutation{1, arrange::core::NodeType::Input},
        });
        tree.clearDirty();
        (void)tree.takeInvalidation();

        try {
            tree.apply(std::vector<arrange::core::TreeMutation>{
                arrange::core::SetPropMutation{1, "onSubmit", arrange::core::PropValue::stringValue("not an event slot")},
            });
            return 20;
        } catch (const std::runtime_error&) {
        }
        const auto snapshot = tree.invalidationSnapshot();
        if (snapshot.affects(arrange::core::DirtyFlag::EventSlot)) return 18;
        if (!tree.node(1).eventSlots.empty()) return 19;
        return 0;
    }

    int verifyPropSchema() {
        using namespace arrange::core;
        std::string error;
        if (!validateSetPropMutation(NodeType::Text, "textStyle", object({field("fontSize", PropValue::numberValue(12.0)), field("color", PropValue::numberValue(0xff000000u))}), error)) return 101;
        if (validateSetPropMutation(NodeType::Text, "textStyle", object({field("fontSize", PropValue::stringValue("12"))}), error)) return 102;
        if (validateSetPropMutation(NodeType::Column, "verticalArrangement", object({field("kind", PropValue::stringValue("spacedBy"))}), error)) return 103;
        if (validateSetPropMutation(NodeType::Text, "unknownProp", PropValue::stringValue("bad"), error)) return 104;
        if (validateSetPropMutation(NodeType::Image, "tint", PropValue::numberValue(0xff000000u), error)) return 105;
        if (validateSetPropMutation(NodeType::Text, "testTag", PropValue::stringValue("tag"), error)) return 106;
        if (!validateSetPropMutation(NodeType::Icon, "source", object({field("path", PropValue::stringValue("icons/play.svg"))}), error)) return 107;
        if (validateSetPropMutation(NodeType::Icon, "source", object({field("path", PropValue::stringValue("icons/play.svg")), field("url", PropValue::stringValue("https://example.invalid/play.svg"))}), error)) return 108;
        return 0;
    }

    int verifyNativeSceneAndFramePipeline() {
        arrange::core::NativeScene scene;
        arrange::core::PublishedFrame published;
        arrange::core::SceneFramePipeline pipeline;
        auto transaction = initialTreeTransaction();
        auto result = pipeline.run(scene, 1, {0.0f, 320.0f, 0.0f, 240.0f}, &transaction, true, published);
        if (result.error || !result.ran) return 21;
        if (!scene.contains(1) || !scene.hasEventSlot(arrange::core::makeEventSlotId(3, arrange::core::EventSlotKind::Click))) return 22;
        if (!phaseRan(published.phases, arrange::core::FramePhase::ApplyMutations)) return 23;
        if (!phaseRan(published.phases, arrange::core::FramePhase::Measure)) return 24;
        if (!phaseRan(published.phases, arrange::core::FramePhase::BuildPaint)) return 25;
        if (published.content.drawOps.empty()) return 26;

        arrange::core::MutationTransaction eventOnly;
        eventOnly.eventSlotUpdates.push_back(arrange::core::makeEventSlotId(3, arrange::core::EventSlotKind::Click, "updated"));
        result = pipeline.run(scene, 1, {0.0f, 320.0f, 0.0f, 240.0f}, &eventOnly, false, published);
        if (result.error) return 27;
        if (phaseRan(published.phases, arrange::core::FramePhase::Measure)) return 28;
        if (phaseRan(published.phases, arrange::core::FramePhase::BuildPaint)) return 29;

        arrange::core::MutationTransaction nativeInvalidation;
        nativeInvalidation.treeMutations.push_back(arrange::core::NativeInvalidationMutation{6, arrange::core::DirtyFlag::Paint, "nativeInputPaint", "caret blink"});
        result = pipeline.run(scene, 1, {0.0f, 320.0f, 0.0f, 240.0f}, &nativeInvalidation, false, published);
        if (result.error) return 30;
        if (phaseRan(published.phases, arrange::core::FramePhase::Measure)) return 31;
        if (!phaseRan(published.phases, arrange::core::FramePhase::BuildPaint)) return 32;
        return 0;
    }

    int verifyPointerScrollAndHitTest() {
        arrange::core::LayoutTree tree;
        auto transaction = initialTreeTransaction();
        tree.apply(transaction.treeMutations);
        arrange::core::LayoutEngine{}.layout(tree, 1, {0.0f, 320.0f, 0.0f, 240.0f});

        arrange::core::PointerInputProcessor pointer;
        const auto down = pointer.pointerDown(tree, 1, {10.0f, 48.0f}, 1);
        const auto up = pointer.pointerUp(tree, 1, {10.0f, 48.0f}, 1);
        if (!down.consumed || !up.clickTriggered || up.eventSlot.kind != arrange::core::EventSlotKind::Click) return 41;

        const auto scroll = arrange::core::ScrollDispatcher{}.verticalWheel(tree, 1, {10.0f, 100.0f}, -1.0f, 24.0f);
        if (!scroll.consumed || scroll.target != 4 || !near(scroll.value, 24.0f)) return 42;

        tree.apply(std::vector<arrange::core::TreeMutation>{
            arrange::core::SetModifierMutation{4, verticalScroll(100.0f, 40.0f, scroll.value, arrange::core::makeEventSlotId(4, arrange::core::EventSlotKind::VerticalScroll))},
        });
        if (!near(tree.node(4).modifier.scroll.verticalValue, 24.0f)) return 43;
        return 0;
    }

    int verifyPropValueAndTextInput() {
        auto value = object({
            field("text", arrange::core::PropValue::stringValue("hello")),
            field("count", arrange::core::PropValue::numberValue(12.0)),
            field("enabled", arrange::core::PropValue::booleanValue(true)),
        });
        arrange::core::PropObject objectValue(&value);
        if (objectValue.string("text") != "hello") return 51;
        if (objectValue.integer("count") != 12) return 52;
        if (!objectValue.boolean("enabled")) return 53;

        arrange::core::TextInputState input;
        input.begin("Preset A", true);
        if (!input.hasSelection()) return 54;
        const auto replace = input.replaceSelectionWithText("B");
        if (!replace.consumed || !replace.textChanged || input.text() != "B") return 55;
        input.insertCodepoint(U'好');
        if (input.text() != "B好") return 56;
        if (!input.undo().textChanged || input.text() != "B") return 57;
        if (!input.redo().textChanged || input.text() != "B好") return 58;
        if (!input.submit().submitRequested) return 59;
        return 0;
    }

    class ExactTextMeasurer final : public arrange::core::TextMeasurer {
    public:
        float advance(std::string_view, char32_t, const arrange::core::TextStyle& style) const override {
            return style.fontSize * 0.5f;
        }
    };

    int verifyTextLayoutAndOverlay() {
        ExactTextMeasurer measurer;
        arrange::core::TextLayoutService service(measurer);
        const auto layout = service.layout("abcd\nef", {10.0f, 12.0f}, {0, 0.0f, false});
        if (layout.lines.size() != 2 || !near(layout.width, 20.0f) || !near(layout.height, 24.0f)) return 61;
        const auto caret = service.caretRect(layout, 2, {4.0f, 5.0f});
        if (!near(caret.x, 14.0f) || !near(caret.y, 5.0f)) return 62;

        arrange::core::ArrangeNode inputNode;
        inputNode.id = 9;
        inputNode.type = arrange::core::NodeType::Input;
        inputNode.bounds = {0.0f, 0.0f, 120.0f, 28.0f};
        inputNode.props["modelValue"] = arrange::core::PropValue::stringValue("abcd");
        arrange::core::TextInputOverlayState state;
        state.text = "abcd";
        state.cursorIndex = 2;
        state.selectionStart = 1;
        state.selectionEnd = 3;
        state.temporaryUnderlines.push_back({0, 1});
        const auto ops = arrange::core::TextInputOverlayBuilder{}.build(inputNode, state, service);
        bool sawCaret = false;
        bool sawSelection = false;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::DrawLine) sawCaret = true;
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0x663a7afeu) sawSelection = true;
        }
        if (!sawCaret || !sawSelection) return 63;
        return 0;
    }

    int verifyClippingAndOverflowOps() {
        using namespace arrange::core;
        LayoutTree tree;
        tree.apply(std::vector<TreeMutation>{
            CreateNodeMutation{1, NodeType::Box},
            SetModifierMutation{1, size(80.0f, 40.0f)},
            CreateNodeMutation{2, NodeType::Box},
            SetModifierMutation{2, background(120.0f, 20.0f, 0xffabcdefu)},
            InsertChildMutation{1, 2, 0},
        });
        LayoutEngine{}.layout(tree, 1, {0.0f, 80.0f, 0.0f, 40.0f});
        const auto unclipped = DrawOpsBuilder{}.collect(tree, 1);
        for (const auto& op : unclipped) {
            if (op.type == DrawOpType::PushClip) return 111;
        }

        tree.apply(std::vector<TreeMutation>{
            SetModifierMutation{1, verticalScroll(80.0f, 40.0f, 0.0f, makeEventSlotId(1, EventSlotKind::VerticalScroll))},
        });
        LayoutEngine{}.layout(tree, 1, {0.0f, 80.0f, 0.0f, 40.0f});
        const auto scrollOps = DrawOpsBuilder{}.collect(tree, 1);
        bool sawClip = false;
        for (const auto& op : scrollOps) {
            if (op.type == DrawOpType::PushClip && near(op.rect.width, 80.0f) && near(op.rect.height, 40.0f)) sawClip = true;
        }
        if (!sawClip) return 112;

        tree = {};
        tree.apply(std::vector<TreeMutation>{
            CreateNodeMutation{1, NodeType::Text},
            SetTextMutation{1, "overflow text"},
            SetPropMutation{1, "overflow", PropValue::stringValue("visible")},
            SetModifierMutation{1, size(40.0f, 12.0f)},
        });
        LayoutEngine{}.layout(tree, 1, {0.0f, 40.0f, 0.0f, 12.0f});
        const auto visibleOps = DrawOpsBuilder{}.collect(tree, 1);
        for (const auto& op : visibleOps) {
            if (op.type == DrawOpType::PushClip) return 113;
        }
        tree.apply(std::vector<TreeMutation>{
            SetPropMutation{1, "overflow", PropValue::stringValue("clip")},
        });
        LayoutEngine{}.layout(tree, 1, {0.0f, 40.0f, 0.0f, 12.0f});
        const auto clipOps = DrawOpsBuilder{}.collect(tree, 1);
        sawClip = false;
        for (const auto& op : clipOps) {
            if (op.type == DrawOpType::PushClip) sawClip = true;
        }
        if (!sawClip) return 114;

        tree = {};
        tree.apply(std::vector<TreeMutation>{
            CreateNodeMutation{1, NodeType::Icon},
            SetPropMutation{1, "source", object({field("path", PropValue::stringValue("icons/play.svg"))})},
            SetPropMutation{1, "tint", PropValue::numberValue(0xff000000u)},
            SetModifierMutation{1, size(24.0f, 24.0f)},
        });
        LayoutEngine{}.layout(tree, 1, {0.0f, 24.0f, 0.0f, 24.0f});
        const auto iconOps = DrawOpsBuilder{}.collect(tree, 1);
        bool sawResourceObjectIcon = false;
        for (const auto& op : iconOps) {
            if (op.type == DrawOpType::DrawIcon && op.resource == "icons/play.svg") sawResourceObjectIcon = true;
        }
        if (!sawResourceObjectIcon) return 115;
        return 0;
    }

    class MockScriptHost final : public arrange::quickjs::ScriptHost {
    public:
        arrange::quickjs::ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) override {
            lastModulePath = modulePath;
            lastSource = std::string(source);
            if (source.find("throw") != std::string_view::npos) return {false, "mock script exception"};
            return {true, {}};
        }

        std::filesystem::path lastModulePath;
        std::string lastSource;
    };

    arrange::App appWithDist(const std::filesystem::path& path) {
        arrange::App app;
        app.useDist(path);
        return app;
    }

    int verifyAppResolverAndHeadlessLoader() {
        const auto base = std::filesystem::absolute("build/native-smoke/app-resolver").lexically_normal();
        const auto okDir = base / "ok-ui";
        const auto badDir = base / "bad-ui";
        const auto missingDir = base / "missing-entry";
        std::filesystem::remove_all(base);
        std::filesystem::create_directories(okDir);
        std::filesystem::create_directories(badDir);
        std::filesystem::create_directories(missingDir);
        {
            std::ofstream(okDir / "app.js") << "export default {};\n";
            std::ofstream(badDir / "app.js") << "throw new Error('boom');\n";
        }

        arrange::AppResolver resolver;
        const auto resolved = resolver.resolveRelease(appWithDist(okDir));
        if (!resolved.ok || resolved.entryPath.filename() != "app.js") return 71;
        if (resolver.resolveRelease(appWithDist(missingDir)).ok) return 72;
        if (arrange::resolvePackageResource(okDir, "../escape.png").ok) return 73;
        {
            std::ofstream(okDir / "logo.png") << "png";
        }
        if (!arrange::resolvePackageResource(okDir, "logo.png").ok) return 74;

        MockScriptHost host;
        arrange::HeadlessArrangeEditor editor(appWithDist(okDir), host);
        if (!editor.loadRelease() || editor.state() != arrange::HeadlessEditorState::Loaded) return 75;
        MockScriptHost badHost;
        arrange::HeadlessArrangeEditor badEditor(appWithDist(badDir), badHost);
        if (badEditor.loadRelease() || badEditor.error().source != arrange::ErrorSource::ScriptRuntime) return 76;
        return 0;
    }

    int verifyDevServerAndFramePlanner() {
        const auto endpoint = arrange::parseDevServerUrl("http://127.0.0.1:9178");
        if (!endpoint.ok || endpoint.host != "127.0.0.1" || endpoint.port != 9178) return 81;
        if (arrange::devBundleHttpUrl("http://127.0.0.1:9178") != "http://127.0.0.1:9178/@arrange/app.js") return 82;
        const auto reload = arrange::parseViteHmrReloadMessage(R"({"type":"custom","event":"arrange:reload","data":{"path":"src/App.vue","timestamp":1}})");
        if (!reload || reload->path != "src/App.vue" || reload->payloadJson.find("timestamp") == std::string::npos) return 83;

        arrange::juce::FramePlanner planner;
        if (planner.planTick({}).hasTickWork) return 84;
        planner.requestFramePipelineRun();
        if (!planner.planTick({}).runPipeline || !planner.hasPendingFrameWork({})) return 85;
        planner.clearFramePipelineRunRequest();
        if (!planner.planTick({true, false, false, false}).runEvents) return 86;
        if (!planner.planTick({false, false, true, false}).applyMutations) return 87;
        return 0;
    }

    int verifyScenePipelineStateIntentContract() {
        arrange::juce::ScenePipelineState pipelineState;
        pipelineState.enqueueIntent(arrange::core::InputIntent::packageLoad(initialTreeTransaction()));
        auto result = pipelineState.run(1, {0.0f, 320.0f, 0.0f, 240.0f}, true);
        if (result.error || !pipelineState.scene().contains(1)) return 91;

        pipelineState.enqueueIntent(arrange::core::InputIntent::textInput("native input paint", 6));
        result = pipelineState.run(1, {0.0f, 320.0f, 0.0f, 240.0f}, false);
        if (result.error) return 92;
        if (!pipelineState.publishedFrame().invalidation.affects(arrange::core::DirtyFlag::Paint)) return 93;
        if (pipelineState.publishedFrame().invalidation.affects(arrange::core::DirtyFlag::EventSlot)) return 96;

        pipelineState.enqueueIntent(arrange::core::InputIntent::resize({0.0f, 640.0f, 0.0f, 480.0f}));
        result = pipelineState.run(1, {0.0f, 640.0f, 0.0f, 480.0f}, false);
        if (result.error) return 94;
        if (!pipelineState.publishedFrame().invalidation.affects(arrange::core::DirtyFlag::Layout)) return 95;

        pipelineState.enqueueIntent(arrange::core::InputIntent::pointer("pointer hit test", 3));
        result = pipelineState.run(1, {0.0f, 640.0f, 0.0f, 480.0f}, false);
        if (result.error) return 97;
        if (!pipelineState.publishedFrame().invalidation.affects(arrange::core::DirtyFlag::HitTest)) return 98;
        return 0;
    }
}

int main() {
#define RUN_SMOKE(name) do { if (const auto result = name(); result != 0) return result; } while (false)
    RUN_SMOKE(verifyTypedLayoutTreePipeline);
    RUN_SMOKE(verifyTypedDirtyPrecision);
    RUN_SMOKE(verifyEventPropIsNotCoreEventSlot);
    RUN_SMOKE(verifyPropSchema);
    RUN_SMOKE(verifyNativeSceneAndFramePipeline);
    RUN_SMOKE(verifyPointerScrollAndHitTest);
    RUN_SMOKE(verifyPropValueAndTextInput);
    RUN_SMOKE(verifyTextLayoutAndOverlay);
    RUN_SMOKE(verifyClippingAndOverflowOps);
    RUN_SMOKE(verifyAppResolverAndHeadlessLoader);
    RUN_SMOKE(verifyDevServerAndFramePlanner);
    RUN_SMOKE(verifyScenePipelineStateIntentContract);
#undef RUN_SMOKE
    if (arrange::core::RuntimeVersion == 0) return 99;
    return 0;
}
