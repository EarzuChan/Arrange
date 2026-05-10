#include <arrange/core/Bridge.h>
#include <arrange/core/Layout.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/InputEditing.h>
#include <arrange/core/PointerInputProcessor.h>
#include <arrange/core/Paint.h>
#include <arrange/core/PropValue.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/NativeScene.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/core/LayoutTree.h>
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
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <iterator>
#include <span>
#include <string>
#include <string_view>
#include <vector>
#include <stdexcept>

namespace {
    using Bytes = std::vector<std::byte>;

    class MockScriptHost final : public arrange::quickjs::ScriptHost {
    public:
        arrange::quickjs::ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) override {
            ++executeCount;
            lastModulePath = modulePath;
            lastSource = std::string(source);
            if (source.find("throw") != std::string_view::npos || source.find("ARRANGE_THROW") != std::string_view::npos) return {false, "Mock QuickJS captured script exception"};
            return {true, {}};
        }

        int executeCount = 0;
        std::filesystem::path lastModulePath;
        std::string lastSource;
    };

    bool near(float actual, float expected, float epsilon = 0.01f) { return std::fabs(actual - expected) <= epsilon; }
    bool hasDirty(const arrange::core::ArrangeNode& node, arrange::core::DirtyFlag flag) { return (node.dirty & arrange::core::dirtyMask(flag)) != 0; }
    bool phaseRan(const std::vector<arrange::core::PhaseExecution>& phases, arrange::core::FramePhase phase) {
        for (const auto& execution : phases) {
            if (execution.phase == phase) return execution.ran;
        }
        throw std::runtime_error("missing frame phase execution record");
    }

    void clearDirty(arrange::core::LayoutTree& tree, std::initializer_list<arrange::core::NodeId> ids) { for (auto id : ids) { if (tree.contains(id)) tree.node(id).dirty = 0; } }

    void setEnvValue(const char* name, const char* value) {
#if defined(_WIN32)
        _putenv_s(name, value);
#else
        setenv(name, value, 1);
#endif
    }

    void clearEnvValue(const char* name) {
#if defined(_WIN32)
        _putenv_s(name, "");
#else
        unsetenv(name);
#endif
    }

    std::string encodedNumber(float value) { return "f:" + std::to_string(value); }

    void addTypedProp(std::vector<arrange::core::BridgeOp>& ops, arrange::core::NodeId id, std::string key, std::string value) { ops.push_back({arrange::core::BridgeOpcode::SetProp, id, 0, 0, 0, {}, std::move(key), std::move(value)}); }

    void applySmokeBatch(arrange::core::LayoutTree& tree, const arrange::core::BridgeBatch& batch);

    void applyTypedProp(arrange::core::LayoutTree& tree, arrange::core::NodeId id, std::string key, std::string value) {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        addTypedProp(batch.ops, id, std::move(key), std::move(value));
        applySmokeBatch(tree, batch);
    }

    void applySmokeBatch(arrange::core::LayoutTree& tree, const arrange::core::BridgeBatch& batch) {
        tree.apply(batch);
    }

    void pushU32(Bytes& bytes, std::uint32_t value) {
        bytes.push_back(static_cast<std::byte>(value & 0xffu));
        bytes.push_back(static_cast<std::byte>((value >> 8u) & 0xffu));
        bytes.push_back(static_cast<std::byte>((value >> 16u) & 0xffu));
        bytes.push_back(static_cast<std::byte>((value >> 24u) & 0xffu));
    }

    void pushString(Bytes& bytes, std::string_view value) {
        pushU32(bytes, static_cast<std::uint32_t>(value.size()));
        for (char ch : value) bytes.push_back(static_cast<std::byte>(static_cast<unsigned char>(ch)));
        while (bytes.size() % 4u != 0u) bytes.push_back(std::byte{0});
    }

    Bytes readFile(const char* path) {
        std::ifstream stream(path, std::ios::binary);
        if (!stream) return {};

        const std::vector chars((std::istreambuf_iterator(stream)), std::istreambuf_iterator<char>());
        Bytes bytes;
        bytes.reserve(chars.size());

        for (char ch : chars) bytes.push_back(static_cast<std::byte>(static_cast<unsigned char>(ch)));
        return bytes;
    }

    Bytes makeFallbackBridgeFixture() {
        const std::vector<std::string> strings = {"Column", "o:[{\"type\":\"padding\",\"start\":8,\"top\":8,\"end\":8,\"bottom\":8}]", "Text", "Hello from JS fixture"};
        const std::vector<std::uint32_t> words = {1, 1, 0, 6, 1, 1, 1, 2, 2, 7, 2, 3, 3, 1, 2, 0};
        Bytes bytes;
        pushU32(bytes, arrange::core::BridgeMagic);
        pushU32(bytes, arrange::core::BridgeVersion);
        pushU32(bytes, 0);
        pushU32(bytes, 5);
        pushU32(bytes, static_cast<std::uint32_t>(strings.size()));
        for (const auto& value : strings) pushString(bytes, value);
        pushU32(bytes, static_cast<std::uint32_t>(words.size()));
        for (auto word : words) pushU32(bytes, word);
        return bytes;
    }

    int verifyBridgeTreeAndLayout(int argc, char** argv) {
        Bytes bytes = argc > 1 ? readFile(argv[1]) : Bytes{};
        if (bytes.empty()) bytes = makeFallbackBridgeFixture();
        const auto batch = arrange::core::decodeBridgeBatch(std::as_bytes(std::span(bytes)));
        if (batch.header.magic != arrange::core::BridgeMagic) return 1;
        if (batch.ops.size() < 5) return 2;
        if (batch.ops[0].nodeType != "Column") return 3;

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        if (tree.size() < 2) return 4;
        if (tree.node(1).type != arrange::core::NodeType::Column) return 5;
        if (tree.node(1).children.empty() || tree.node(1).children[0] != 2) return 6;
        if (tree.node(2).text != "Hello from JS fixture") return 7;
        if ((tree.node(1).dirty & arrange::core::dirtyMask(arrange::core::DirtyFlag::Structure)) == 0) return 8;
        if ((tree.node(2).dirty & arrange::core::dirtyMask(arrange::core::DirtyFlag::Layout)) == 0) return 9;

        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 300.0f, 0.0f, 100.0f});
        if (!near(tree.node(1).bounds.x, 0.0f) || !near(tree.node(1).bounds.y, 0.0f)) return 10;
        if (!near(tree.node(2).bounds.x, 8.0f) || !near(tree.node(2).bounds.y, 8.0f)) return 11;
        if (!near(tree.node(2).bounds.width, 226.8f)) return 12;
        if (tree.contains(3) && (!near(tree.node(3).bounds.width, 16.0f) || !near(tree.node(3).bounds.height, 8.0f))) return 13;
        if (tree.node(1).bounds.width < tree.node(2).bounds.width + 16.0f) return 14;

        arrange::core::DrawOpsBuilder paint;
        const auto drawOps = paint.collect(tree, 1);
        bool sawText = false;
        bool sawBoxBackground = false;
        for (const auto& op : drawOps) {
            if (op.type == arrange::core::DrawOpType::DrawText && op.text == "Hello from JS fixture" && op.color == 0xffe8eaedu && near(op.fontSize, 18.0f)) sawText = true;
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff112233u) sawBoxBackground = true;
        }
        if (!sawText || !sawBoxBackground) return 44;

        arrange::core::HitTester hitTester;
        const auto textHit = hitTester.hitTest(tree, 1, {10.0f, 10.0f});
        if (!textHit.hit || textHit.node != 2 || textHit.clickable) return 15;
        const auto boxHit = hitTester.hitTest(tree, 1, {10.0f, 32.0f});
        if (!boxHit.hit || boxHit.node != 3 || !boxHit.clickable) return 16;
        const auto clickable = hitTester.hitTestClickable(tree, 1, {10.0f, 32.0f});
        if (!clickable.hit || clickable.node != 3 || !clickable.clickable) return 17;
        const auto noClickable = hitTester.hitTestClickable(tree, 1, {10.0f, 10.0f});
        if (noClickable.hit) return 18;
        arrange::core::PointerInputProcessor dispatcher;
        const auto down = dispatcher.pointerDown(tree, 1, {10.0f, 32.0f}, 1);
        if (!down.consumed || down.clickTriggered || down.target != 3 || down.eventSlot.toString() != "3:click:click") return 19;
        const auto up = dispatcher.pointerUp(tree, 1, {10.0f, 32.0f}, 1);
        if (!up.consumed || !up.clickTriggered || up.target != 3 || up.eventSlot.toString() != "3:click:click") return 37;
        const auto dragDown = dispatcher.pointerDown(tree, 1, {10.0f, 32.0f}, 2);
        if (!dragDown.consumed) return 38;
        const auto dragOut = dispatcher.pointerUp(tree, 1, {10.0f, 10.0f}, 2);
        if (!dragOut.consumed || dragOut.clickTriggered) return 39;
        const auto cancelDown = dispatcher.pointerDown(tree, 1, {10.0f, 32.0f}, 3);
        if (!cancelDown.consumed) return 40;
        const auto cancel = dispatcher.pointerCancel(3);
        if (!cancel.consumed || cancel.clickTriggered || cancel.target != 3 || cancel.eventSlot.toString() != "3:click:click") return 41;
        return 0;
    }

    int verifyNativeArrangementAndWeightLayout() {
        arrange::core::BridgeBatch rowBatch;
        rowBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 9};
        rowBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Row"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":300,\"height\":40}]"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "horizontalArrangement", "o:{\"kind\":\"spacedBy\",\"space\":10}"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"width\",\"value\":100},{\"type\":\"fillMaxHeight\",\"fraction\":1}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"weight\",\"weight\":1,\"fill\":true},{\"type\":\"fillMaxHeight\",\"fraction\":1}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::LayoutTree rowTree;
        applySmokeBatch(rowTree, rowBatch);
        arrange::core::LayoutEngine layout;
        layout.layout(rowTree, 1, {0.0f, 300.0f, 0.0f, 40.0f});
        if (!near(rowTree.node(2).bounds.x, 0.0f) || !near(rowTree.node(2).bounds.width, 100.0f)) return 55;
        if (!near(rowTree.node(3).bounds.x, 110.0f) || !near(rowTree.node(3).bounds.width, 190.0f)) return 56;
        if (!near(rowTree.node(3).bounds.height, 40.0f)) return 57;

        arrange::core::BridgeBatch columnBatch;
        columnBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 9};
        columnBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":80,\"height\":100}]"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "verticalArrangement", "o:{\"kind\":\"spacedBy\",\"space\":6}"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":20},{\"type\":\"fillMaxWidth\",\"fraction\":1}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"weight\",\"weight\":1,\"fill\":true},{\"type\":\"fillMaxWidth\",\"fraction\":1}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::LayoutTree columnTree;
        applySmokeBatch(columnTree, columnBatch);
        layout.layout(columnTree, 1, {0.0f, 80.0f, 0.0f, 100.0f});
        if (!near(columnTree.node(2).bounds.y, 0.0f) || !near(columnTree.node(2).bounds.height, 20.0f)) return 58;
        if (!near(columnTree.node(3).bounds.y, 26.0f) || !near(columnTree.node(3).bounds.height, 74.0f)) return 59;
        if (!near(columnTree.node(3).bounds.width, 80.0f)) return 60;
        return 0;
    }

    int verifyNativeTypedModifierPayloadWithoutExpandedProps() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 2};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, R"json(o:[{"type":"size","width":80,"height":40},{"type":"background","brush":4279312947},{"type":"padding","start":10,"top":6,"end":10,"bottom":6},{"type":"clip","shape":{"type":"rounded","radius":4}}])json"},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 200.0f, 0.0f, 200.0f});
        if (!near(tree.node(1).bounds.width, 80.0f) || !near(tree.node(1).bounds.height, 40.0f)) return 218;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        bool sawBackground = false;
        bool sawClip = false;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff112233u && near(op.rect.width, 80.0f) && near(op.rect.height, 40.0f)) sawBackground = true;
            if (op.type == arrange::core::DrawOpType::PushClip && op.shape == arrange::core::DrawShapeType::Rounded && near(op.cornerRadius, 4.0f) && near(op.rect.x, 10.0f) && near(op.rect.y, 6.0f) && near(op.rect.width, 60.0f) && near(op.rect.height, 28.0f)) sawClip = true;
        }
        if (!sawBackground || !sawClip) return 220;
        return 0;
    }

    int verifyNativeModifierOrderFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 7};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"padding\",\"start\":10,\"top\":10,\"end\":10,\"bottom\":10},{\"type\":\"background\",\"brush\":4279308561}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"padding\",\"start\":10,\"top\":10,\"end\":10,\"bottom\":10},{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"background\",\"brush\":4280427042}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 400.0f, 0.0f, 400.0f});

        if (!near(tree.node(2).bounds.x, 0.0f) || !near(tree.node(2).bounds.y, 0.0f) || !near(tree.node(2).bounds.width, 100.0f) || !near(tree.node(2).bounds.height, 40.0f)) return 82;
        if (!near(tree.node(3).bounds.x, 0.0f) || !near(tree.node(3).bounds.y, 40.0f) || !near(tree.node(3).bounds.width, 120.0f) || !near(tree.node(3).bounds.height, 60.0f)) return 83;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        bool sawSizeThenPaddingInnerBackground = false;
        bool sawPaddingThenSizeInnerBackground = false;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff111111u && near(op.rect.x, 10.0f) && near(op.rect.y, 10.0f) && near(op.rect.width, 80.0f) && near(op.rect.height, 20.0f)) { sawSizeThenPaddingInnerBackground = true; }
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff222222u && near(op.rect.x, 10.0f) && near(op.rect.y, 50.0f) && near(op.rect.width, 100.0f) && near(op.rect.height, 40.0f)) { sawPaddingThenSizeInnerBackground = true; }
        }
        if (!sawSizeThenPaddingInnerBackground || !sawPaddingThenSizeInnerBackground) return 84;

        arrange::core::BridgeBatch alphaBatch;
        alphaBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 2};
        alphaBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {
                arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {},
                "o:[{\"type\":\"size\",\"width\":20,\"height\":10},{\"type\":\"offset\",\"x\":4,\"y\":3},{\"type\":\"background\",\"brush\":4279312947},{\"type\":\"alpha\",\"value\":0.5},{\"type\":\"border\",\"width\":1,\"brush\":4282668390},{\"type\":\"dropShadow\",\"color\":2147483648,\"offsetX\":3,\"offsetY\":2}]"
            },
        };
        arrange::core::LayoutTree alphaTree;
        applySmokeBatch(alphaTree, alphaBatch);
        layout.layout(alphaTree, 1, {0.0f, 100.0f, 0.0f, 100.0f});
        if (!near(alphaTree.node(1).bounds.x, 4.0f) || !near(alphaTree.node(1).bounds.y, 3.0f)) return 94;
        const auto alphaOps = paint.collect(alphaTree, 1);
        bool sawOpaqueBackground = false;
        bool sawHalfBorder = false;
        bool sawHalfShadow = false;
        for (const auto& op : alphaOps) {
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff112233u && near(op.rect.x, 4.0f) && near(op.rect.y, 3.0f)) sawOpaqueBackground = true;
            if (op.type == arrange::core::DrawOpType::StrokeRect && op.color == 0x80445566u) sawHalfBorder = true;
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0x40000000u && near(op.rect.x, 7.0f) && near(op.rect.y, 5.0f)) sawHalfShadow = true;
        }
        if (!sawOpaqueBackground || !sawHalfBorder || !sawHalfShadow) return 95;

        arrange::core::BridgeBatch shapeBatch;
        shapeBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 2};
        shapeBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {
                arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {},
                "o:[{\"type\":\"size\",\"width\":40,\"height\":24},{\"type\":\"dropShadow\",\"color\":1711276032,\"offset\":{\"x\":2,\"y\":3},\"shape\":{\"type\":\"rounded\",\"radius\":6}},{\"type\":\"background\",\"brush\":4280431428,\"shape\":{\"type\":\"rounded\",\"radius\":6}},{\"type\":\"border\",\"width\":2,\"brush\":4284905352,\"shape\":{\"type\":\"rounded\",\"radius\":6}},{\"type\":\"clip\",\"shape\":{\"type\":\"circle\"}}]"
            },
        };
        arrange::core::LayoutTree shapeTree;
        applySmokeBatch(shapeTree, shapeBatch);
        layout.layout(shapeTree, 1, {0.0f, 100.0f, 0.0f, 100.0f});
        const auto shapeOps = paint.collect(shapeTree, 1);
        bool sawRoundedShadow = false;
        bool sawRoundedBackground = false;
        bool sawRoundedBorder = false;
        bool sawCircleClip = false;
        for (const auto& op : shapeOps) {
            if (op.type == arrange::core::DrawOpType::FillRect && op.shape == arrange::core::DrawShapeType::Rounded && op.color == 0x66000000u && near(op.cornerRadius, 6.0f)) sawRoundedShadow = true;
            if (op.type == arrange::core::DrawOpType::FillRect && op.shape == arrange::core::DrawShapeType::Rounded && op.color == 0xff223344u && near(op.cornerRadius, 6.0f)) sawRoundedBackground = true;
            if (op.type == arrange::core::DrawOpType::StrokeRect && op.shape == arrange::core::DrawShapeType::Rounded && op.color == 0xff667788u && near(op.strokeWidth, 2.0f)) sawRoundedBorder = true;
            if (op.type == arrange::core::DrawOpType::PushClip && op.shape == arrange::core::DrawShapeType::Circle) sawCircleClip = true;
        }
        if (!sawRoundedShadow || !sawRoundedBackground || !sawRoundedBorder || !sawCircleClip) return 96;
        return 0;
    }

    int verifyNativeTextFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 5};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Text"},
            {arrange::core::BridgeOpcode::SetText, 1, 0, 0, 0, {}, {}, {}, "Short\nLongest line\nHidden"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "textStyle", "o:{\"fontSize\":10,\"lineHeight\":14}"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "textAlign", "s:center"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "maxLines", "f:2"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "overflow", "s:ellipsis"},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 400.0f, 0.0f, 400.0f});
        if (!near(tree.node(1).bounds.width, 72.0f) || !near(tree.node(1).bounds.height, 28.0f)) return 97;
        if (!near(tree.node(1).baseline, 11.2f)) return 98;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        if (ops.size() != 1) return 99;
        const auto& op = ops[0];
        if (op.type != arrange::core::DrawOpType::DrawText || op.textAlign != "center" || op.overflow != "ellipsis" || op.maxLines != 2) return 100;

        arrange::core::BridgeBatch cjkBatch;
        cjkBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 3};
        cjkBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 10, 0, 0, 0, "Text"},
            {
                arrange::core::BridgeOpcode::SetText,
                10,
                0,
                0,
                0,
                {},
                {},
                {},
                std::string("\xe7\x8c\xab\xe7\x8c\xab") + "\nab",
            },
            {
                arrange::core::BridgeOpcode::SetProp,
                10,
                0,
                0,
                0,
                {},
                "textStyle",
                "o:{\"fontSize\":10,\"lineHeight\":12}",
            },
        };
        arrange::core::LayoutTree cjkTree;
        applySmokeBatch(cjkTree, cjkBatch);
        layout.layout(cjkTree, 10, {0.0f, 400.0f, 0.0f, 400.0f});
        if (!near(cjkTree.node(10).bounds.width, 20.0f) ||
            !near(cjkTree.node(10).bounds.height, 24.0f))
            return 197;
        return 0;
    }

    int verifyLayoutTreeInsertChildKeepsParentReferenceStable() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 60};
        batch.ops.push_back({arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"});
        for (arrange::core::NodeId id = 2; id < 22; ++id) {
            batch.ops.push_back({arrange::core::BridgeOpcode::CreateNode, id, 0, 0, 0, "Box"});
            batch.ops.push_back({arrange::core::BridgeOpcode::InsertChild, 0, 1, id, id - 2});
        }

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        if (tree.node(1).children.size() != 20) return 101;
        for (std::size_t index = 0; index < tree.node(1).children.size(); ++index) { if (tree.node(1).children[index] != static_cast<arrange::core::NodeId>(index + 2)) return 102; }
        return 0;
    }

    int verifyLayoutTreeRejectsCyclesAndDeduplicatesChildren() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 5};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 1},
            {arrange::core::BridgeOpcode::InsertChild, 0, 2, 1, 0},
        };

        arrange::core::LayoutTree tree;
        bool rejectedCycle = false;
        try { applySmokeBatch(tree, batch); }
        catch (const std::runtime_error&) { rejectedCycle = true; }
        if (!rejectedCycle) return 119;
        if (tree.node(1).children.size() != 1 || tree.node(1).children[0] != 2) return 120;

        arrange::core::HitTester hitTester;
        const auto hit = hitTester.hitTest(tree, 1, {0.0f, 0.0f});
        if (hit.hit) return 121;
        return 0;
    }

    int verifyLayoutTreeDirtyPropagationFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 5};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Text"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::InsertChild, 0, 2, 3, 0},
            {arrange::core::BridgeOpcode::SetText, 3, 0, 0, 0, {}, {}, {}, "Initial"},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        clearDirty(tree, {1, 2, 3});

        arrange::core::BridgeBatch textChange;
        textChange.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        textChange.ops = {{arrange::core::BridgeOpcode::SetText, 3, 0, 0, 0, {}, {}, {}, "Changed"}};
        applySmokeBatch(tree, textChange);
        if (!hasDirty(tree.node(3), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(3), arrange::core::DirtyFlag::Paint)) return 122;
        if (!hasDirty(tree.node(2), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Layout)) return 123;
        if (hasDirty(tree.node(1), arrange::core::DirtyFlag::Structure) || hasDirty(tree.node(2), arrange::core::DirtyFlag::Structure)) return 124;

        clearDirty(tree, {1, 2, 3});
        arrange::core::BridgeBatch modifierChange;
        modifierChange.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        modifierChange.ops = {{arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"offset\",\"x\":8,\"y\":4},{\"type\":\"clickable\",\"onClick\":{\"eventSlot\":\"3:click:click\"}}]"}};
        applySmokeBatch(tree, modifierChange);
        if (!hasDirty(tree.node(3), arrange::core::DirtyFlag::Transform) || !hasDirty(tree.node(3), arrange::core::DirtyFlag::HitTest) || !hasDirty(tree.node(3), arrange::core::DirtyFlag::Paint)) return 125;
        if (!hasDirty(tree.node(2), arrange::core::DirtyFlag::HitTest) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::HitTest)) return 126;
        if (hasDirty(tree.node(2), arrange::core::DirtyFlag::Layout) || hasDirty(tree.node(1), arrange::core::DirtyFlag::Layout)) return 127;

        clearDirty(tree, {1, 2, 3});
        arrange::core::BridgeBatch resourceChange;
        resourceChange.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        resourceChange.ops = {{arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "source", "s:logo.png"}};
        applySmokeBatch(tree, resourceChange);
        if (!hasDirty(tree.node(3), arrange::core::DirtyFlag::Resource)) return 128;
        if (hasDirty(tree.node(2), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Paint)) return 129;

        clearDirty(tree, {1, 2, 3});
        arrange::core::BridgeBatch deleteSubtree;
        deleteSubtree.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        deleteSubtree.ops = {{arrange::core::BridgeOpcode::DeleteNode, 2}};
        applySmokeBatch(tree, deleteSubtree);
        if (tree.contains(2) || tree.contains(3)) return 130;
        if (!tree.node(1).children.empty()) return 131;
        if (!hasDirty(tree.node(1), arrange::core::DirtyFlag::Structure) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::HitTest)) return 132;

        return 0;
    }

    int verifyLayoutTreeDirtySnapshotAndClearFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 8};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Row"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":60,\"height\":20}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 60.0f, 0.0f, 20.0f});
        tree.clearDirty();
        if (tree.dirtySnapshot().nodeCount != 0) return 143;

        arrange::core::markDirty(tree.node(2), arrange::core::DirtyFlag::Paint);
        arrange::core::markDirty(tree.node(3), arrange::core::DirtyFlag::Layout);
        const auto paintOrLayout = arrange::core::dirtyMask(arrange::core::DirtyFlag::Paint) | arrange::core::dirtyMask(arrange::core::DirtyFlag::Layout);
        const auto snapshot = tree.dirtySnapshot(paintOrLayout);
        if (snapshot.nodeCount != 2 || (snapshot.combinedDirty & paintOrLayout) != paintOrLayout || !snapshot.hasRepaintBounds) return 144;
        if (!near(snapshot.repaintBounds.x, 0.0f) || !near(snapshot.repaintBounds.y, 0.0f) || !near(snapshot.repaintBounds.width, 40.0f) || !near(snapshot.repaintBounds.height, 20.0f)) return 145;

        const auto paintOnly = tree.dirtySnapshot(arrange::core::dirtyMask(arrange::core::DirtyFlag::Paint));
        if (paintOnly.nodeCount != 1 || !near(paintOnly.repaintBounds.width, 20.0f)) return 146;
        tree.clearDirty();
        if (tree.dirtySnapshot().nodeCount != 0 || tree.node(2).dirty != 0 || tree.node(3).dirty != 0) return 147;
        return 0;
    }

    int verifyNativeGraphicsLayerTranslationHitTestFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 6};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":50}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":10},{\"type\":\"graphicsLayer\",\"translationX\":30,\"translationY\":5},{\"type\":\"background\",\"brush\":4281549909},{\"type\":\"clickable\",\"onClick\":{\"eventSlot\":\"2:click:click\"}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 50.0f});
        if (!near(tree.node(2).bounds.x, 30.0f) || !near(tree.node(2).bounds.y, 5.0f) || !near(tree.node(2).bounds.width, 20.0f)) return 137;

        arrange::core::HitTester hitTester;
        const auto originalPoint = hitTester.hitTestClickable(tree, 1, {4.0f, 4.0f});
        if (originalPoint.hit) return 138;
        const auto translatedPoint = hitTester.hitTestClickable(tree, 1, {35.0f, 8.0f});
        if (!translatedPoint.hit || translatedPoint.node != 2 || !translatedPoint.clickable) return 139;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        bool sawTranslatedPaint = false;
        for (const auto& op : ops) { if (op.type == arrange::core::DrawOpType::FillRect && near(op.rect.x, 30.0f) && near(op.rect.y, 5.0f) && op.color == 0xff334455u) sawTranslatedPaint = true; }
        if (!sawTranslatedPaint) return 140;
        return 0;
    }

    int verifyNativeGraphicsLayerScaleRotationHitTestFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 8};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":80}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"graphicsLayer\",\"scaleX\":2,\"scaleY\":2},{\"type\":\"background\",\"brush\":4279312947},{\"type\":\"clickable\",\"onClick\":{\"eventSlot\":\"2:click:click\"}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {
                arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {},
                "o:[{\"type\":\"size\",\"width\":20,\"height\":10},{\"type\":\"offset\",\"x\":40,\"y\":20},{\"type\":\"graphicsLayer\",\"rotationZ\":90},{\"type\":\"background\",\"brush\":4280427042},{\"type\":\"clickable\",\"onClick\":{\"eventSlot\":\"3:click:click\"}}]"
            },
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 80.0f});

        arrange::core::HitTester hitTester;
        const auto scaledOutsideOriginal = hitTester.hitTestClickable(tree, 1, {25.0f, 10.0f});
        if (!scaledOutsideOriginal.hit || scaledOutsideOriginal.node != 2 || !scaledOutsideOriginal.clickable) return 160;

        const auto scaledOutsideVisual = hitTester.hitTestClickable(tree, 1, {35.0f, 10.0f});
        if (scaledOutsideVisual.hit && scaledOutsideVisual.node == 2) return 161;

        const auto rotatedOutsideOriginal = hitTester.hitTestClickable(tree, 1, {50.0f, 34.0f});
        if (!rotatedOutsideOriginal.hit || rotatedOutsideOriginal.node != 3 || !rotatedOutsideOriginal.clickable) return 162;

        const auto rotatedOutsideVisual = hitTester.hitTestClickable(tree, 1, {58.0f, 34.0f});
        if (rotatedOutsideVisual.hit && rotatedOutsideVisual.node == 3) return 163;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        bool sawScaleTransform = false;
        bool sawRotationTransform = false;
        int transformPops = 0;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::PushTransform && near(op.scaleX, 2.0f) && near(op.scaleY, 2.0f) && near(op.rotationZ, 0.0f) && near(op.transformOriginX, 0.5f) && near(op.transformOriginY, 0.5f)) sawScaleTransform = true;
            if (op.type == arrange::core::DrawOpType::PushTransform && near(op.scaleX, 1.0f) && near(op.scaleY, 1.0f) && near(op.rotationZ, 90.0f) && near(op.transformOriginX, 0.5f) && near(op.transformOriginY, 0.5f)) sawRotationTransform = true;
            if (op.type == arrange::core::DrawOpType::PopTransform) ++transformPops;
        }
        if (!sawScaleTransform || !sawRotationTransform || transformPops != 2) return 177;

        return 0;
    }

    int verifyNativeNestedTransformClipFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 6};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":60},{\"type\":\"graphicsLayer\",\"scaleX\":2,\"scaleY\":2,\"transformOrigin\":\"TopStart\"},{\"type\":\"clip\",\"shape\":{\"type\":\"rounded\",\"radius\":4}}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"offset\",\"x\":70,\"y\":5},{\"type\":\"background\",\"brush\":4279312947},{\"type\":\"clickable\",\"onClick\":{\"eventSlot\":\"2:click:click\"}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 60.0f});

        arrange::core::HitTester hitTester;
        const auto hit = hitTester.hitTestClickable(tree, 1, {150.0f, 20.0f});
        if (!hit.hit || hit.node != 2 || !hit.clickable) return 178;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        int pushTransform = -1;
        int pushClip = -1;
        int childFill = -1;
        int popClip = -1;
        int popTransform = -1;
        for (int i = 0; i < static_cast<int>(ops.size()); ++i) {
            const auto& op = ops[static_cast<std::size_t>(i)];
            if (op.type == arrange::core::DrawOpType::PushTransform && near(op.scaleX, 2.0f) && near(op.scaleY, 2.0f) && near(op.transformOriginX, 0.0f) && near(op.transformOriginY, 0.0f)) pushTransform = i;
            if (op.type == arrange::core::DrawOpType::PushClip && op.shape == arrange::core::DrawShapeType::Rounded && near(op.cornerRadius, 4.0f)) pushClip = i;
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff112233u) childFill = i;
            if (op.type == arrange::core::DrawOpType::PopClip) popClip = i;
            if (op.type == arrange::core::DrawOpType::PopTransform) popTransform = i;
        }
        if (!(pushTransform >= 0 && pushClip > pushTransform && childFill > pushClip && popClip > childFill && popTransform > popClip)) return 179;
        return 0;
    }

    int verifyNativeZIndexPaintAndHitTestFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 8};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":40,\"height\":40}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"zIndex\",\"value\":10},{\"type\":\"background\",\"brush\":4278190335},{\"type\":\"clickable\",\"onClick\":{\"eventSlot\":\"2:click:click\"}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"zIndex\",\"value\":0},{\"type\":\"background\",\"brush\":4294901760},{\"type\":\"clickable\",\"onClick\":{\"eventSlot\":\"3:click:click\"}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 40.0f, 0.0f, 40.0f});

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        std::vector<std::uint32_t> fills;
        for (const auto& op : ops) { if (op.type == arrange::core::DrawOpType::FillRect) fills.push_back(op.color); }
        if (fills.size() != 2 || fills[0] != 0xffff0000u || fills[1] != 0xff0000ffu) return 141;

        arrange::core::HitTester hitTester;
        const auto hit = hitTester.hitTestClickable(tree, 1, {4.0f, 4.0f});
        if (!hit.hit || hit.node != 2 || !hit.clickable) return 142;
        return 0;
    }

    int verifyNativeInputFirstSlice() {
        arrange::core::BridgeBatch inputBatch;
        inputBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 5};
        inputBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Input"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "placeholder", "s:Search preset"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "modelValue", "s:Gain"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "textStyle", "o:{\"fontSize\":16,\"color\":4294967295}"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"background\",\"brush\":4280427042},{\"type\":\"border\",\"width\":1,\"brush\":4286611584}]"},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, inputBatch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 240.0f, 0.0f, 80.0f});
        if (!near(tree.node(1).bounds.width, 120.0f) || !near(tree.node(1).bounds.height, 28.0f)) return 61;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        bool sawInputText = false;
        for (const auto& op : ops) { if (op.type == arrange::core::DrawOpType::DrawText && op.text == "Gain" && op.color == 0xffffffffu && near(op.fontSize, 16.0f) && near(op.rect.x, 8.0f) && near(op.rect.y, 6.0f) && near(op.rect.height, 16.0f)) { sawInputText = true; } }
        if (!sawInputText) return 62;

        const auto cat = std::string("\xe7\x8c\xab");
        const auto cats = cat + cat + cat + cat + cat + cat + cat + cat;
        arrange::core::BridgeBatch cjkInputBatch;
        cjkInputBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 3};
        cjkInputBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 20, 0, 0, 0, "Input"},
            {
                arrange::core::BridgeOpcode::SetProp,
                20,
                0,
                0,
                0,
                {},
                "modelValue",
                std::string("s:") + cats,
            },
            {
                arrange::core::BridgeOpcode::SetProp,
                20,
                0,
                0,
                0,
                {},
                "textStyle",
                "o:{\"fontSize\":16,\"color\":4294967295}",
            },
        };
        arrange::core::LayoutTree cjkInputTree;
        applySmokeBatch(cjkInputTree, cjkInputBatch);
        layout.layout(cjkInputTree, 20, {0.0f, 240.0f, 0.0f, 80.0f});
        if (!near(cjkInputTree.node(20).bounds.width, 144.0f) ||
            !near(cjkInputTree.node(20).bounds.height, 28.0f))
            return 198;

        arrange::core::BridgeBatch multilineBatch;
        multilineBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 5};
        multilineBatch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 10, 0, 0, 0, "Input"},
            {arrange::core::BridgeOpcode::SetProp, 10, 0, 0, 0, {}, "modelValue", "s:Line1\nLonger"},
            {arrange::core::BridgeOpcode::SetProp, 10, 0, 0, 0, {}, "singleLine", "b:0"},
            {arrange::core::BridgeOpcode::SetProp, 10, 0, 0, 0, {}, "minLines", "f:3"},
            {arrange::core::BridgeOpcode::SetProp, 10, 0, 0, 0, {}, "textStyle", "o:{\"fontSize\":16,\"color\":4294967295}"},
        };
        arrange::core::LayoutTree multilineTree;
        applySmokeBatch(multilineTree, multilineBatch);
        layout.layout(multilineTree, 10, {0.0f, 240.0f, 0.0f, 200.0f});
        if (!near(multilineTree.node(10).bounds.width, 120.0f) || !near(multilineTree.node(10).bounds.height, 65.6f)) return 164;
        const auto multilineOps = paint.collect(multilineTree, 10);
        bool sawMultilineText = false;
        for (const auto& op : multilineOps) { if (op.type == arrange::core::DrawOpType::DrawText && op.text == "Line1\nLonger" && op.maxLines == 2) sawMultilineText = true; }
        if (!sawMultilineText) return 165;
        return 0;
    }

    int verifyNativeTextInputEditingFirstSlice() {
        arrange::core::TextInputState input;
        input.begin("Preset A", true);
        if (!input.hasSelection() || input.selectionStart() != 0 || input.selectionEnd() != 8 || input.cursorIndex() != 8) return 103;

        const auto replaced = input.insertCodepoint(U'B');
        if (!replaced.consumed || !replaced.textChanged || input.text() != "B" || input.cursorIndex() != 1 || input.hasSelection()) return 104;
        if (!input.changedSinceBegin()) return 105;

        const auto home = input.moveHome();
        if (!home.consumed || home.textChanged || input.cursorIndex() != 0) return 106;
        const auto inserted = input.insertCodepoint(U'A');
        if (!inserted.textChanged || input.text() != "AB" || input.cursorIndex() != 1) return 107;
        const auto end = input.moveEnd();
        if (!end.consumed || input.cursorIndex() != 2) return 108;
        const auto backspace = input.backspace();
        if (!backspace.textChanged || input.text() != "A" || input.cursorIndex() != 1) return 109;
        const auto undoBackspace = input.undo();
        if (!undoBackspace.consumed || !undoBackspace.textChanged || input.text() != "AB" || input.cursorIndex() != 2) return 148;
        const auto redoBackspace = input.redo();
        if (!redoBackspace.consumed || !redoBackspace.textChanged || input.text() != "A" || input.cursorIndex() != 1) return 149;
        const auto undoAgain = input.undo();
        if (!undoAgain.consumed || input.text() != "AB" || input.cursorIndex() != 2) return 150;
        const auto insertedAfterUndo = input.insertCodepoint(U'C');
        if (!insertedAfterUndo.textChanged || input.text() != "ABC" || input.cursorIndex() != 3) return 151;
        const auto redoAfterNewEdit = input.redo();
        if (redoAfterNewEdit.consumed || input.text() != "ABC") return 152;

        input.begin("Clipboard", true);
        if (input.selectedText() != "Clipboard") return 155;
        const auto cut = input.cutSelection();
        if (!cut.consumed || !cut.textChanged || !input.text().empty() || input.cursorIndex() != 0) return 156;
        const auto undoCut = input.undo();
        if (!undoCut.consumed || input.text() != "Clipboard" || input.selectedText() != "Clipboard") return 157;
        const auto replacedSelection = input.replaceSelectionWithText("Paste");
        if (!replacedSelection.consumed || !replacedSelection.textChanged || input.text() != "Paste" || input.cursorIndex() != 5) return 158;
        const auto undoPaste = input.undo();
        if (!undoPaste.consumed || input.text() != "Clipboard" || input.selectedText() != "Clipboard") return 159;

        input.begin("ab", false);
        const auto lineBreak = input.insertLineBreak();
        if (!lineBreak.consumed || !lineBreak.textChanged || input.text() != "ab\n" || input.cursorIndex() != 3) return 166;
        const auto afterBreak = input.insertCodepoint(U'c');
        if (!afterBreak.textChanged || input.text() != "ab\nc" || input.cursorIndex() != 4) return 167;
        const auto lineHome = input.moveHome();
        if (!lineHome.consumed || input.cursorIndex() != 3) return 168;
        const auto lineEnd = input.moveEnd();
        if (!lineEnd.consumed || input.cursorIndex() != 4) return 169;
        const auto undoLine = input.undo();
        if (!undoLine.consumed || input.text() != "ab\n" || input.cursorIndex() != 3) return 170;

        input.begin("drag select", false);
        const auto dragSelect = input.selectRange(0, 4);
        if (!dragSelect.consumed || dragSelect.textChanged || input.selectedText() != "drag" || input.cursorIndex() != 4) return 171;
        const auto dragReplace = input.insertCodepoint(U'D');
        if (!dragReplace.textChanged || input.text() != "D select" || input.cursorIndex() != 1 || input.hasSelection()) return 172;
        input.begin(std::string("A") + "\xe7\x8c\xab" + "B", false);
        const auto clampedMove = input.moveCursorTo(2);
        if (!clampedMove.consumed || input.cursorIndex() != 1) return 173;
        const auto unicodeSelect = input.selectRange(2, input.text().size());
        if (!unicodeSelect.consumed || input.selectionStart() != 1 || input.selectionEnd() == 2 || input.selectedText() != std::string("\xe7\x8c\xab") + "B") return 174;

        input.begin(std::string("A") + "\xe7\x8c\xab" + "B", false);
        const auto imeSelect = input.selectRange(1, 4);
        if (!imeSelect.consumed || input.selectedText() != std::string("\xe7\x8c\xab")) return 175;
        const auto imeCommit = input.replaceSelectionWithText(std::string("\xe3\x81\x8b\xe3\x81\xaa"));
        if (!imeCommit.consumed || !imeCommit.textChanged || input.text() != std::string("A") + "\xe3\x81\x8b\xe3\x81\xaa" + "B" || input.cursorIndex() != 7) return 176;

        input.begin(std::string("A") + "\xe7\x8c\xab" + "B", false);
        const auto extendLeftB = input.extendSelectionLeft();
        if (!extendLeftB.consumed || extendLeftB.textChanged || input.selectedText() != "B" || input.cursorIndex() != 4) return 184;
        const auto extendLeftCat = input.extendSelectionLeft();
        if (!extendLeftCat.consumed || input.selectedText() != std::string("\xe7\x8c\xab") + "B" || input.cursorIndex() != 1) return 185;
        const auto shrinkRight = input.extendSelectionRight();
        if (!shrinkRight.consumed || input.selectedText() != "B" || input.cursorIndex() != 4) return 186;
        const auto replaceKeyboardSelection = input.replaceSelectionWithText(std::string("\xc3\xa9"));
        if (!replaceKeyboardSelection.textChanged || input.text() != std::string("A") + "\xe7\x8c\xab" + "\xc3\xa9" || input.cursorIndex() != 6) return 187;

        input.begin("ab\ncd", false);
        const auto extendHome = input.extendSelectionHome();
        if (!extendHome.consumed || input.selectedText() != "cd" || input.cursorIndex() != 3) return 188;
        const auto collapseHome = input.moveHome();
        if (!collapseHome.consumed || input.hasSelection() || input.cursorIndex() != 3) return 189;
        const auto extendEnd = input.extendSelectionEnd();
        if (!extendEnd.consumed || input.selectedText() != "cd" || input.cursorIndex() != 5) return 190;

        input.begin("abcd", false);
        if (input.changedSinceBegin() || input.cursorIndex() != 4) return 110;
        input.moveLeft();
        input.moveLeft();
        if (input.cursorIndex() != 2) return 111;
        const auto deleteForward = input.deleteForward();
        if (!deleteForward.textChanged || input.text() != "abd" || input.cursorIndex() != 2) return 112;
        const auto submit = input.submit();
        if (!submit.consumed || !submit.submitRequested || submit.textChanged) return 113;

        input.begin(std::string("A") + "\xe7\x8c\xab" + "B", false);
        input.moveLeft();
        input.moveLeft();
        if (input.cursorIndex() != 1) return 115;
        const auto deleteUnicode = input.deleteForward();
        if (!deleteUnicode.textChanged || input.text() != "AB" || input.cursorIndex() != 1) return 116;
        const auto insertUnicode = input.insertCodepoint(U'\u00e9');
        if (!insertUnicode.textChanged || input.text() != std::string("A") + "\xc3\xa9" + "B" || input.cursorIndex() != 3) return 117;
        const auto backspaceUnicode = input.backspace();
        if (!backspaceUnicode.textChanged || input.text() != "AB" || input.cursorIndex() != 1) return 118;

        input.reset();
        if (!input.text().empty() || input.cursorIndex() != 0 || input.hasSelection()) return 114;
        return 0;
    }

    int verifyNativeImageIconFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 17};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Row"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Icon"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "source", "s:play"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "tint", "f:4293454573"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Image"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "source", "s:logo.png"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "contentScale", "s:Crop"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "alignment", "s:BottomEnd"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "tint", "f:2164260863"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
            {arrange::core::BridgeOpcode::CreateNode, 4, 0, 0, 0, "Image"},
            {arrange::core::BridgeOpcode::SetProp, 4, 0, 0, 0, {}, "source", "s:wide.png"},
            {arrange::core::BridgeOpcode::SetProp, 4, 0, 0, 0, {}, "contentScale", "s:FillWidth"},
            {arrange::core::BridgeOpcode::SetProp, 4, 0, 0, 0, {}, "alignment", "s:TopStart"},
            {arrange::core::BridgeOpcode::SetProp, 4, 0, 0, 0, {}, "alpha", "f:0.5"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 4, 2},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 120.0f, 0.0f, 40.0f});
        if (!near(tree.node(2).bounds.width, 24.0f) || !near(tree.node(2).bounds.height, 24.0f)) return 64;
        if (!near(tree.node(3).bounds.width, 24.0f) || !near(tree.node(3).bounds.height, 24.0f)) return 65;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        bool sawIcon = false;
        bool sawImage = false;
        bool sawFillWidthImage = false;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::DrawIcon && op.resource == "play" && op.color == 0xffe8eaedu) sawIcon = true;
            if (op.type == arrange::core::DrawOpType::DrawImage && op.resource == "logo.png" && op.contentScale == "Crop" && op.alignment == "BottomEnd" && op.color == 0x80ffffffu && op.hasTint) sawImage = true;
            if (op.type == arrange::core::DrawOpType::DrawImage && op.resource == "wide.png" && op.contentScale == "FillWidth" && op.alignment == "TopStart" && op.color == 0x80ffffffu && !op.hasTint) sawFillWidthImage = true;
        }
        if (!sawIcon || !sawImage || !sawFillWidthImage) return 66;
        return 0;
    }

    int verifyNativeScrollFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 8};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"verticalScroll\",\"state\":{\"value\":12,\"__arrangeNativeScroll\":{\"eventSlot\":\"1:verticalScroll:verticalScroll\"}},\"enabled\":true}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":80},{\"type\":\"fillMaxWidth\",\"fraction\":1},{\"type\":\"background\",\"brush\":4281549909}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":20},{\"type\":\"fillMaxWidth\",\"fraction\":1},{\"type\":\"background\",\"brush\":4282668390}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::LayoutTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(1).bounds.width, 100.0f) || !near(tree.node(1).bounds.height, 40.0f)) return 67;
        if (!near(tree.node(2).bounds.y, -12.0f) || !near(tree.node(2).bounds.height, 80.0f)) return 68;
        if (!near(tree.node(3).bounds.y, 68.0f) || !near(tree.node(3).bounds.height, 20.0f)) return 69;

        arrange::core::DrawOpsBuilder paint;
        const auto ops = paint.collect(tree, 1);
        bool sawPushClip = false;
        bool sawPopClip = false;
        bool sawClippedChildPaint = false;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::PushClip && near(op.rect.x, 0.0f) && near(op.rect.y, 0.0f) && near(op.rect.width, 100.0f) && near(op.rect.height, 40.0f)) sawPushClip = true;
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0xff334455u && near(op.rect.y, -12.0f) && near(op.rect.height, 80.0f)) sawClippedChildPaint = true;
            if (op.type == arrange::core::DrawOpType::PopClip) sawPopClip = true;
        }
        if (!sawPushClip || !sawClippedChildPaint || !sawPopClip) return 70;

        arrange::core::BridgeBatch resetScroll;
        resetScroll.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        resetScroll.ops = {{arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"verticalScroll\",\"state\":{\"value\":0,\"__arrangeNativeScroll\":{\"eventSlot\":\"1:verticalScroll:verticalScroll\"}},\"enabled\":true}]"}};
        applySmokeBatch(tree, resetScroll);
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        tree.clearDirty();
        arrange::core::ScrollDispatcher scroll;
        const auto scrolled = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -1.0f, 24.0f);
        if (!scrolled.consumed || scrolled.target != 1 || !near(scrolled.value, 24.0f) || !near(scrolled.maxValue, 60.0f) || !near(scrolled.viewportSize, 40.0f) || !near(scrolled.contentSize, 100.0f) || scrolled.eventSlot.toString() != "1:verticalScroll:verticalScroll") return 71;
        arrange::core::BridgeBatch scrolledModifier;
        scrolledModifier.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        scrolledModifier.ops = {{arrange::core::BridgeOpcode::SetModifier, scrolled.target, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"verticalScroll\",\"state\":{\"value\":24,\"__arrangeNativeScroll\":{\"eventSlot\":\"1:verticalScroll:verticalScroll\"}},\"enabled\":true}]"}};
        applySmokeBatch(tree, scrolledModifier);
        if (!hasDirty(tree.node(1), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Paint) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::HitTest)) return 153;
        const auto dirty = tree.dirtySnapshot(arrange::core::dirtyMask(arrange::core::DirtyFlag::Layout) | arrange::core::dirtyMask(arrange::core::DirtyFlag::Paint));
        if (dirty.nodeCount != 1 || !dirty.hasRepaintBounds || !near(dirty.repaintBounds.width, 100.0f) || !near(dirty.repaintBounds.height, 40.0f)) return 154;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(2).bounds.y, -24.0f) || !near(tree.node(3).bounds.y, 56.0f)) return 72;
        const auto clamped = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -10.0f, 24.0f);
        if (!clamped.consumed || !near(clamped.value, 60.0f) || !near(clamped.maxValue, 60.0f)) return 73;
        arrange::core::BridgeBatch clampedModifier;
        clampedModifier.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        clampedModifier.ops = {{arrange::core::BridgeOpcode::SetModifier, clamped.target, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"verticalScroll\",\"state\":{\"value\":60,\"__arrangeNativeScroll\":{\"eventSlot\":\"1:verticalScroll:verticalScroll\"}},\"enabled\":true}]"}};
        applySmokeBatch(tree, clampedModifier);
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(2).bounds.y, -60.0f) || !near(tree.node(3).bounds.y, 20.0f)) return 74;
        return 0;
    }

    int verifyAppResolverAndScriptLoader() {
        const auto base = std::filesystem::absolute("build/native-smoke/app-resolver").lexically_normal();
        const auto okDir = base / "ok-ui";
        const auto badDir = base / "bad-ui";
        const auto missingDir = base / "missing-entry";
        std::filesystem::remove_all(base);
        std::filesystem::create_directories(okDir);
        std::filesystem::create_directories(badDir);
        std::filesystem::create_directories(missingDir);
        {
            std::ofstream app(okDir / "app.js", std::ios::binary);
            app << "export default {};\n";
        }
        {
            std::ofstream image(okDir / "logo.png", std::ios::binary);
            image << "not a real png but enough for resolver smoke\n";
        }
        {
            std::ofstream app(badDir / "app.js", std::ios::binary);
            app << "throw new Error('boom');\n";
        }

        arrange::AppResolver resolver;
        arrange::App configured;
        configured.useDist(okDir);
        configured.useLive("http://127.0.0.1:7788");
        if (!configured.hasDist() || !configured.hasLive() || configured.liveUrl() != "http://127.0.0.1:7788") return 194;
        const auto noSource = resolver.resolveRelease(arrange::App{});
        if (noSource.ok || noSource.error.find("你啥也没给我给你加载啥app（笑）") == std::string::npos || noSource.error.find("useDist") == std::string::npos) return 195;
        const auto appWithDist = [](const std::filesystem::path& dir) {
            arrange::App app;
            app.useDist(dir);
            return app;
        };
        const auto ok = resolver.resolveRelease(appWithDist(okDir));
        if (!ok.ok) return 20;
        if (ok.entryPath.filename() != "app.js") return 21;
        const auto okResource = arrange::resolvePackageResource(ok.packageDir, "logo.png");
        if (!okResource.ok || okResource.path.filename() != "logo.png") return 133;
        const auto missingResource = arrange::resolvePackageResource(ok.packageDir, "missing.png");
        if (missingResource.ok || missingResource.error.find("does not exist") == std::string::npos) return 134;
        const auto escapedResource = arrange::resolvePackageResource(ok.packageDir, "../outside.png");
        if (escapedResource.ok || escapedResource.error.find("escapes") == std::string::npos) return 135;
        const auto resourceModel = arrange::makeErrorScreenModel(arrange::ErrorSource::Resource, missingResource.error, {}, missingResource.path);
        if (resourceModel.diagnosticText().find("Resource") == std::string::npos || resourceModel.diagnosticText().find("missing.png") == std::string::npos) return 136;

        const auto missing = resolver.resolveRelease(appWithDist(missingDir));
        if (missing.ok) return 22;
        if (missing.error.find("app.js") == std::string::npos) return 23;
        const auto missingModel = arrange::makeErrorScreenModel(arrange::ErrorSource::AppPackage, missing.error, {}, missing.entryPath);
        if (missingModel.diagnosticText().find("app.js") == std::string::npos) return 32;
        if (!missingModel.retryAvailable) return 33;

        MockScriptHost editorHost;
        arrange::HeadlessArrangeEditor editor(appWithDist(okDir), editorHost);
        if (!editor.loadRelease()) return 45;
        if (editor.state() != arrange::HeadlessEditorState::Loaded) return 46;

        MockScriptHost missingEditorHost;
        arrange::HeadlessArrangeEditor missingEditor(appWithDist(missingDir), missingEditorHost);
        if (missingEditor.loadRelease()) return 47;
        if (missingEditor.state() != arrange::HeadlessEditorState::Error) return 48;
        if (missingEditor.error().diagnosticText().find("app.js") == std::string::npos) return 49;
        {
            std::ofstream app(missingDir / "app.js", std::ios::binary);
            app << "export default {};\n";
        }
        if (!missingEditor.retryRelease()) return 53;
        if (missingEditor.state() != arrange::HeadlessEditorState::Loaded) return 54;

        MockScriptHost badEditorHost;
        arrange::HeadlessArrangeEditor badEditor(appWithDist(badDir), badEditorHost);
        if (badEditor.loadRelease()) return 50;
        if (badEditor.state() != arrange::HeadlessEditorState::Error) return 51;
        if (badEditor.error().diagnosticText().find("script exception") == std::string::npos) return 52;
        const auto debug = resolver.resolveDebug(appWithDist(okDir));
        if (!debug.ok || !debug.devServer) return 24;
        if (debug.devServerUrl != arrange::AppResolver::DefaultDevServer) return 25;
        setEnvValue("ARRANGE_DEV_SERVER", "http://127.0.0.1:9999");
        const auto envDebug = resolver.resolveDebug(appWithDist(okDir));
        if (envDebug.devServerUrl != "http://127.0.0.1:9999") return 85;
        const auto explicitDebug = resolver.resolveDebug(appWithDist(okDir), "http://127.0.0.1:7777");
        if (explicitDebug.devServerUrl != "http://127.0.0.1:7777") return 86;
        clearEnvValue("ARRANGE_DEV_SERVER");

        MockScriptHost host;
        arrange::quickjs::AppScriptLoader loader(host);
        const auto loaded = loader.loadEntry(ok.entryPath);
        if (!loaded.ok) return 26;
        if (host.executeCount != 1) return 27;
        if (host.lastSource.find("export default") == std::string::npos) return 28;

        const auto bad = resolver.resolveRelease(appWithDist(badDir));
        if (!bad.ok) return 29;
        const auto failed = loader.loadEntry(bad.entryPath);
        if (failed.ok) return 30;
        if (failed.error.find("script exception") == std::string::npos) return 31;
        const auto scriptModel = arrange::makeErrorScreenModel(arrange::ErrorSource::ScriptRuntime, failed.error, {}, failed.modulePath);
        if (scriptModel.diagnosticText().find("script exception") == std::string::npos) return 34;
        try {
            const std::vector<std::byte> invalid = {std::byte{0}, std::byte{0}, std::byte{0}, std::byte{0}};
            (void)arrange::core::decodeBridgeBatch(std::as_bytes(std::span(invalid)));
            return 35;
        }
        catch (const arrange::core::BridgeDecodeError& error) {
            const auto bridgeModel = arrange::makeErrorScreenModel(arrange::ErrorSource::BridgeProtocol, error.what());
            if (bridgeModel.diagnosticText().find("BridgeProtocol") == std::string::npos) return 36;
        }
        return 0;
    }

    int verifyDevServerClientFirstSlice() {
        const auto endpoint = arrange::parseDevServerUrl("http://127.0.0.1:9178");
        if (!endpoint.ok || endpoint.secure || endpoint.host != "127.0.0.1" || endpoint.port != 9178 || endpoint.websocketPath != "/") return 87;
        if (arrange::devBundleHttpUrl("http://127.0.0.1:9178") != "http://127.0.0.1:9178/@arrange/app.js") return 93;

        const auto baseEndpoint = arrange::parseDevServerUrl("ws://localhost:3000/dev-base/");
        if (!baseEndpoint.ok || baseEndpoint.host != "localhost" || baseEndpoint.port != 3000 || baseEndpoint.websocketPath != "/dev-base/") return 88;

        const auto badEndpoint = arrange::parseDevServerUrl("127.0.0.1:9178");
        if (badEndpoint.ok || badEndpoint.error.find("http") == std::string::npos) return 89;

        const auto connected = arrange::parseViteHmrReloadMessage(R"({"type":"connected"})");
        if (connected.has_value()) return 90;

        const auto reload = arrange::parseViteHmrReloadMessage(R"({"type":"custom","event":"arrange:reload","data":{"path":"src/App.vue","timestamp":123}})");
        if (!reload || reload->path != "src/App.vue" || reload->payloadJson.find("timestamp") == std::string::npos) return 91;

        const auto otherCustom = arrange::parseViteHmrReloadMessage(R"({"type":"custom","event":"vite:beforeUpdate","data":{"path":"src/App.vue"}})");
        if (otherCustom.has_value()) return 92;
        return 0;
    }

    int verifyPropValueContract() {
        arrange::core::ArrangeNode node;
        node.props["number"] = "f:12.5";
        node.props["flag"] = "b:1";
        node.props["label"] = "s:hello";
        node.props["handle"] = "h:42";
        node.props["style"] = "o:{\"fontSize\":18,\"lineHeight\":24,\"brush\":{\"color\":4279312947},\"enabled\":true,\"name\":\"body\"}";

        if (!near(arrange::core::encodedNumberProp(node, "number"), 12.5f)) return 221;
        if (!arrange::core::encodedBoolProp(node, "flag")) return 222;
        if (arrange::core::decodeStringProp(node.props["label"]) != "hello") return 223;
        if (arrange::core::encodedHandleProp(node, "handle") != 42) return 224;

        const auto style = arrange::core::objectProp(node, "style");
        if (!near(style.number("fontSize"), 18.0f)) return 225;
        if (!near(style.number("lineHeight"), 24.0f)) return 226;
        if (style.color("brush.color") != 0xff112233u) return 227;
        if (!style.boolean("enabled")) return 228;
        if (style.string("name") != "body") return 229;
        if (style.number("missing", 7.0f) != 7.0f) return 230;
        return 0;
    }

    int verifyTextLayoutServiceContract() {
        const auto& service = arrange::core::defaultTextLayoutService();
        const auto empty = service.layout("", {10.0f, 12.0f}, {0, 0.0f, true});
        if (empty.lines.size() != 1 || !near(empty.height, 12.0f)) return 231;

        const auto text = service.layout("ab中", {10.0f, 12.0f}, {0, 0.0f, true});
        if (text.lines.size() != 1) return 232;
        if (!(service.xForByteIndex(text, 1) > 0.0f)) return 233;
        const auto endCaret = service.caretRect(text, text.text.size(), {2.0f, 3.0f});
        if (!near(endCaret.x, 2.0f + text.width) || !near(endCaret.y, 3.0f)) return 234;
        const auto range = service.boundsForRange(text, 1, text.text.size(), {2.0f, 3.0f});
        if (range.empty() || !(range[0].width > 0.0f)) return 235;
        if (service.byteIndexAtPoint(text, {0.0f, 0.0f}) != 0) return 236;
        if (service.byteIndexAtPoint(text, {1000.0f, 0.0f}) != text.text.size()) return 237;

        const auto multi = service.layout("a\nb", {10.0f, 12.0f}, {0, 0.0f, false});
        if (multi.lines.size() != 2 || !near(multi.height, 24.0f)) return 238;
        const auto secondLineCaret = service.caretRect(multi, 2, {});
        if (!near(secondLineCaret.y, 12.0f)) return 239;

        class ExactLineMeasurer final : public arrange::core::TextMeasurer {
        public:
            float advance(std::string_view, char32_t, const arrange::core::TextStyle&) const override { return 10.0f; }
            float lineWidth(std::string_view text, const arrange::core::TextStyle&) const override { return static_cast<float>(text.size()) * 11.0f; }
        };

        const ExactLineMeasurer exactMeasurer;
        const arrange::core::TextLayoutService exactService(exactMeasurer);
        const auto exact = exactService.layout("abc", {10.0f, 12.0f}, {1, 0.0f, true});
        if (!near(exact.width, 33.0f)) return 240;
        if (!near(exactService.xForByteIndex(exact, exact.text.size()), 33.0f)) return 241;

        const auto wrapped = exactService.layout("abcd", {10.0f, 12.0f}, {0, 15.0f, false});
        if (wrapped.lines.size() != 4 || !near(wrapped.width, 11.0f)) return 242;

        arrange::core::ArrangeNode inputNode;
        inputNode.id = 42;
        inputNode.type = arrange::core::NodeType::Input;
        inputNode.bounds = {10.0f, 20.0f, 120.0f, 30.0f};
        inputNode.props["textStyle"] = "o:{\"fontSize\":10,\"lineHeight\":12}";
        arrange::core::TextInputOverlayState overlayState;
        overlayState.text = "abcd";
        overlayState.cursorIndex = 2;
        overlayState.selectionStart = 1;
        overlayState.selectionEnd = 3;
        overlayState.temporaryUnderlines.push_back({0, 4});
        const auto overlayOps = arrange::core::TextInputOverlayBuilder{}.build(inputNode, overlayState, exactService);
        bool sawFocusRing = false;
        bool sawSelection = false;
        bool sawUnderline = false;
        bool sawCaret = false;
        bool sawClip = false;
        for (const auto& op : overlayOps) {
            if (op.type == arrange::core::DrawOpType::StrokeRect && op.nodeId == 42 && op.color == 0xff7aa2ffu) sawFocusRing = true;
            if (op.type == arrange::core::DrawOpType::PushClip && near(op.rect.x, 18.0f) && near(op.rect.y, 29.0f)) sawClip = true;
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == 0x663a7afeu) sawSelection = true;
            if (op.type == arrange::core::DrawOpType::DrawLine && op.color == 0xff7aa2ffu) sawUnderline = true;
            if (op.type == arrange::core::DrawOpType::DrawLine && op.color == 0xffe8eaedu && near(op.rect.x, 38.0f)) sawCaret = true;
        }
        if (!sawFocusRing || !sawClip || !sawSelection || !sawUnderline || !sawCaret) return 259;
        return 0;
    }

    int verifyMutationTransactionQueueAndSceneFramePipelineContract() {
        arrange::core::BridgeBatch first;
        first.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        first.ops.push_back({arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"});

        arrange::core::BridgeBatch second;
        second.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        second.ops = {
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, R"json(o:[{"type":"size","width":80,"height":40},{"type":"background","brush":4279312947}])json"},
        };

        arrange::core::MutationTransactionQueue queue;
        if (queue.hasPending()) return 243;
        queue.push(std::move(first));
        queue.push(std::move(second));
        if (!queue.hasPending()) return 244;

        auto transaction = queue.take();
        if (!transaction || !transaction->hasTreeMutations() || transaction->treeMutations.header.opCount != transaction->treeMutations.ops.size() || transaction->treeMutations.ops.size() != 2) return 245;
        if (queue.hasPending()) return 246;

        arrange::core::NativeScene scene;
        arrange::core::PublishedFrame publishedFrame;
        arrange::core::SceneFramePipeline pipeline;
        const auto result = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, &*transaction, true, publishedFrame);
        if (!result.ran || result.error) return 247;
        auto& tree = scene.tree();
        if (!tree.contains(1) || !near(tree.node(1).bounds.width, 80.0f) || !near(tree.node(1).bounds.height, 40.0f)) return 248;
        if (publishedFrame.content.drawOps.empty() || publishedFrame.content.drawOps.front().type != arrange::core::DrawOpType::FillRect) return 249;

        arrange::core::MutationTransaction invalid;
        invalid.treeMutations.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        invalid.treeMutations.ops.push_back({arrange::core::BridgeOpcode::SetProp, 99, 0, 0, 0, {}, "missing", "s:value"});
        const auto failed = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, &invalid, true, publishedFrame);
        if (!failed.ran || !failed.error || !publishedFrame.content.drawOps.empty()) return 250;
        return 0;
    }

    int verifySceneFramePipelinePrecisionContract() {
        arrange::core::NativeScene scene;
        arrange::core::PublishedFrame publishedFrame;
        arrange::core::SceneFramePipeline pipeline;

        arrange::core::BridgeBatch create;
        create.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 2};
        create.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, R"json(o:[{"type":"size","width":80,"height":40},{"type":"background","brush":4279312947},{"type":"clickable","onClick":{"eventSlot":"1:click:click"}}])json"},
        };
        auto createTransaction = arrange::core::MutationTransaction::fromBridgeBatch(std::move(create));
        auto created = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, &createTransaction, true, publishedFrame);
        if (!created.ran || created.error || !created.plan.measure || !created.plan.layout || !created.plan.buildPaint || !created.plan.passivePaint) return 272;
        if (!phaseRan(publishedFrame.phases, arrange::core::FramePhase::Measure) ||
            !phaseRan(publishedFrame.phases, arrange::core::FramePhase::Layout) ||
            !phaseRan(publishedFrame.phases, arrange::core::FramePhase::BuildPaint) ||
            !phaseRan(publishedFrame.phases, arrange::core::FramePhase::PassivePaint)) return 273;
        if (scene.dirtySnapshot().nodeCount != 0 || !scene.invalidationSnapshot().empty()) return 274;

        arrange::core::BridgeBatch paintOnly;
        paintOnly.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        paintOnly.ops = {
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeNativeInputPaintInvalidation", "native paint state changed"},
        };
        auto paintTransaction = arrange::core::MutationTransaction::fromBridgeBatch(std::move(paintOnly));
        auto paintResult = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, &paintTransaction, false, publishedFrame);
        if (!paintResult.ran || paintResult.error) return 275;
        if (paintResult.plan.measure || paintResult.plan.layout || !paintResult.plan.buildPaint || paintResult.plan.buildHitTest || !paintResult.plan.publishFrame || !paintResult.plan.passivePaint) return 276;
        if (phaseRan(publishedFrame.phases, arrange::core::FramePhase::Measure) ||
            phaseRan(publishedFrame.phases, arrange::core::FramePhase::Layout) ||
            !phaseRan(publishedFrame.phases, arrange::core::FramePhase::BuildPaint) ||
            !phaseRan(publishedFrame.phases, arrange::core::FramePhase::PassivePaint)) return 277;
        if (!paintResult.invalidation.affects(arrange::core::DirtyFlag::Paint)) return 278;

        arrange::core::BridgeBatch eventOnly;
        eventOnly.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        eventOnly.ops = {
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeEventSlot.onClick", "s:1:click:updated"},
        };
        auto eventTransaction = arrange::core::MutationTransaction::fromBridgeBatch(std::move(eventOnly));
        auto eventResult = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, &eventTransaction, false, publishedFrame);
        if (!eventResult.ran || eventResult.error) return 279;
        if (eventResult.plan.measure || eventResult.plan.layout || eventResult.plan.buildPaint || eventResult.plan.buildHitTest || eventResult.plan.publishFrame || eventResult.plan.passivePaint) return 280;
        if (phaseRan(publishedFrame.phases, arrange::core::FramePhase::Measure) ||
            phaseRan(publishedFrame.phases, arrange::core::FramePhase::Layout) ||
            phaseRan(publishedFrame.phases, arrange::core::FramePhase::BuildPaint) ||
            phaseRan(publishedFrame.phases, arrange::core::FramePhase::BuildHitTest) ||
            phaseRan(publishedFrame.phases, arrange::core::FramePhase::PublishFrame) ||
            phaseRan(publishedFrame.phases, arrange::core::FramePhase::PassivePaint)) return 281;
        if (!eventResult.invalidation.affects(arrange::core::DirtyFlag::EventSlot)) return 282;
        if (scene.dirtySnapshot().nodeCount != 0 || !scene.invalidationSnapshot().empty()) return 283;

        arrange::core::BridgeBatch transformOnly;
        transformOnly.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        transformOnly.ops = {
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, R"json(o:[{"type":"size","width":80,"height":40},{"type":"background","brush":4279312947},{"type":"graphicsLayer","scaleX":2}])json"},
        };
        auto transformTransaction = arrange::core::MutationTransaction::fromBridgeBatch(std::move(transformOnly));
        auto transformResult = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, &transformTransaction, false, publishedFrame);
        if (!transformResult.ran || transformResult.error) return 284;
        if (transformResult.plan.measure || transformResult.plan.layout || !transformResult.plan.buildPaint || !transformResult.plan.buildHitTest || !transformResult.plan.publishFrame || !transformResult.plan.passivePaint) return 285;

        arrange::core::BridgeBatch layoutOnly;
        layoutOnly.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        layoutOnly.ops = {
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, R"json(o:[{"type":"size","width":90,"height":50},{"type":"background","brush":4279312947}])json"},
        };
        auto layoutTransaction = arrange::core::MutationTransaction::fromBridgeBatch(std::move(layoutOnly));
        auto layoutResult = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, &layoutTransaction, false, publishedFrame);
        if (!layoutResult.ran || layoutResult.error) return 286;
        if (!layoutResult.plan.measure || !layoutResult.plan.layout || !layoutResult.plan.buildPaint || !layoutResult.plan.buildHitTest || !layoutResult.plan.publishFrame || !layoutResult.plan.passivePaint) return 287;
        if (!near(scene.node(1).bounds.width, 90.0f) || !near(scene.node(1).bounds.height, 50.0f)) return 288;

        scene.tree().requestFullFallback("precision contract explicit fallback");
        auto fallbackResult = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, nullptr, true, publishedFrame);
        if (!fallbackResult.ran || fallbackResult.error) return 289;
        if (!fallbackResult.plan.fullFallback || fallbackResult.plan.fallbackReason != "precision contract explicit fallback" || !fallbackResult.plan.buildPaint || !fallbackResult.plan.publishFrame || !fallbackResult.plan.passivePaint) return 290;
        bool sawFallbackReason = false;
        for (const auto& reason : fallbackResult.plan.reasons) {
            if (reason == "precision contract explicit fallback") sawFallbackReason = true;
        }
        if (!sawFallbackReason) return 291;

        scene.tree().recordSceneInvalidation(
            arrange::core::DirtyFlag::Accessibility,
            arrange::core::InvalidationSource::Diagnostics,
            "diagnostics",
            "diagnostics scene changed");
        auto diagnosticsResult = pipeline.run(scene, 1, {0.0f, 100.0f, 0.0f, 100.0f}, nullptr, false, publishedFrame);
        if (!diagnosticsResult.ran || diagnosticsResult.error) return 292;
        if (diagnosticsResult.plan.measure || diagnosticsResult.plan.layout || diagnosticsResult.plan.buildPaint || diagnosticsResult.plan.buildHitTest || !diagnosticsResult.plan.buildDiagnostics || !diagnosticsResult.plan.publishFrame || diagnosticsResult.plan.passivePaint) return 293;
        if (publishedFrame.content.drawOps.empty()) return 250;
        if (!phaseRan(publishedFrame.phases, arrange::core::FramePhase::BuildDiagnostics) ||
            phaseRan(publishedFrame.phases, arrange::core::FramePhase::PassivePaint)) return 294;
        if (!diagnosticsResult.invalidation.affects(arrange::core::DirtyFlag::Accessibility)) return 295;

        return 0;
    }

    int verifyMutationTransactionAndNativeSceneContract() {
        arrange::core::MutationTransactionQueue queue;
        if (queue.hasPending()) return 251;

        auto& pending = queue.ensurePending();
        if (!queue.hasPending()) return 252;
        if (!pending.empty()) return 253;

        const auto clickSlot = arrange::core::makeEventSlotId(1, arrange::core::EventSlotKind::Click);
        pending.eventSlotUpdates.push_back(clickSlot);

        auto transaction = queue.take();
        if (!transaction || transaction->empty() || transaction->hasTreeMutations() || !transaction->hasEventSlotChanges()) return 254;
        if (queue.hasPending()) return 255;

        arrange::core::NativeScene scene;
        scene.apply(*transaction);
        if (!scene.hasEventSlot(clickSlot) || scene.eventSlotCount() != 1) return 256;

        arrange::core::MutationTransaction retire;
        retire.retiredEventSlots.push_back(clickSlot);
        scene.apply(retire);
        if (scene.hasEventSlot(clickSlot) || scene.eventSlotCount() != 0) return 257;

        arrange::core::BridgeBatch create;
        create.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        create.ops.push_back({arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"});
        auto treeTransaction = arrange::core::MutationTransaction::fromBridgeBatch(std::move(create));
        treeTransaction.eventSlotUpdates.push_back(clickSlot);
        scene.apply(treeTransaction);
        if (!scene.contains(1) || !scene.hasEventSlot(clickSlot)) return 258;

        scene.reset();
        if (scene.contains(1) || scene.hasEventSlot(clickSlot) || scene.eventSlotCount() != 0) return 259;
        return 0;
    }

    int verifyInputIntentInvalidationContract() {
        arrange::core::NativeScene scene;
        arrange::core::PublishedFrame publishedFrame;
        arrange::core::SceneFramePipeline pipeline;

        arrange::core::BridgeBatch create;
        create.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 2};
        create.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, R"json(o:[{"type":"size","width":80,"height":40},{"type":"background","brush":4279312947}])json"},
        };
        auto createTransaction = arrange::core::MutationTransaction::fromBridgeBatch(std::move(create));
        auto created = pipeline.run(scene, 1, {0.0f, 120.0f, 0.0f, 80.0f}, &createTransaction, true, publishedFrame);
        if (!created.ran || created.error) return 296;

        scene.tree().recordSceneInvalidation(
            arrange::core::DirtyFlag::EventSlot,
            arrange::core::InvalidationSource::InputIntent,
            "input",
            "pointer intent");
        auto pointer = pipeline.run(scene, 1, {0.0f, 120.0f, 0.0f, 80.0f}, nullptr, false, publishedFrame);
        if (!pointer.ran || pointer.error) return 297;
        if (!pointer.invalidation.affects(arrange::core::DirtyFlag::EventSlot)) return 298;
        if (pointer.plan.measure || pointer.plan.layout || pointer.plan.buildPaint || pointer.plan.buildHitTest || pointer.plan.buildDiagnostics || pointer.plan.publishFrame || pointer.plan.passivePaint) return 299;

        scene.tree().recordSceneInvalidation(
            arrange::core::DirtyFlag::Structure,
            arrange::core::InvalidationSource::InputIntent,
            "package",
            "reload intent");
        auto reload = pipeline.run(scene, 1, {0.0f, 120.0f, 0.0f, 80.0f}, nullptr, false, publishedFrame);
        if (!reload.ran || reload.error) return 300;
        if (!reload.invalidation.affects(arrange::core::DirtyFlag::Structure) || !reload.invalidation.affects(arrange::core::DirtyFlag::Layout) || !reload.invalidation.affects(arrange::core::DirtyFlag::HitTest)) return 301;
        if (!reload.plan.measure || !reload.plan.layout || !reload.plan.buildPaint || !reload.plan.buildHitTest || !reload.plan.publishFrame || !reload.plan.passivePaint) return 302;

        scene.tree().recordSceneInvalidation(
            arrange::core::DirtyFlag::Resource,
            arrange::core::InvalidationSource::Resource,
            "resource",
            "resource ready");
        auto resource = pipeline.run(scene, 1, {0.0f, 120.0f, 0.0f, 80.0f}, nullptr, false, publishedFrame);
        if (!resource.ran || resource.error) return 303;
        if (!resource.invalidation.affects(arrange::core::DirtyFlag::Resource) || resource.invalidation.affects(arrange::core::DirtyFlag::Layout) || !resource.invalidation.affects(arrange::core::DirtyFlag::Paint)) return 304;
        if (resource.plan.measure || resource.plan.layout || !resource.plan.buildPaint || resource.plan.buildHitTest || !resource.plan.publishFrame || !resource.plan.passivePaint) return 305;

        arrange::juce::ScenePipelineState pipelineState;
        arrange::core::BridgeBatch pipelineStateCreate;
        pipelineStateCreate.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 2};
        pipelineStateCreate.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, R"json(o:[{"type":"size","width":80,"height":40}])json"},
        };
        pipelineState.enqueueIntent(arrange::core::InputIntent::packageLoad(
            arrange::core::MutationTransaction::fromBridgeBatch(std::move(pipelineStateCreate)),
            "intent pipeline state package load"));
        const auto pipelineStateCreated = pipelineState.run(1, {0.0f, 120.0f, 0.0f, 80.0f}, false);
        if (pipelineStateCreated.error || !pipelineStateCreated.plan.measure || !pipelineStateCreated.invalidation.affects(arrange::core::DirtyFlag::Structure)) return 306;

        pipelineState.enqueueIntent(arrange::core::InputIntent::key("key input contract", 1));
        pipelineState.enqueueIntent(arrange::core::InputIntent::textInput("text input contract", 1));
        pipelineState.enqueueIntent(arrange::core::InputIntent::imeComposition("ime composition contract", 1));
        pipelineState.enqueueIntent(arrange::core::InputIntent::animationFrame("animation frame contract"));
        const auto inputOnly = pipelineState.run(1, {0.0f, 120.0f, 0.0f, 80.0f}, false);
        if (inputOnly.error) return 307;
        if (!inputOnly.invalidation.affects(arrange::core::DirtyFlag::EventSlot)) return 308;
        if (inputOnly.plan.measure || inputOnly.plan.layout || inputOnly.plan.buildPaint || inputOnly.plan.buildHitTest || inputOnly.plan.buildDiagnostics || inputOnly.plan.publishFrame || inputOnly.plan.passivePaint) return 309;

        pipelineState.enqueueIntent(arrange::core::InputIntent::reload("reload contract"));
        const auto reloadIntent = pipelineState.run(1, {0.0f, 120.0f, 0.0f, 80.0f}, false);
        if (reloadIntent.error || !reloadIntent.plan.fullFallback || reloadIntent.plan.fallbackReason != "reload contract") return 310;
        if (!reloadIntent.plan.measure || !reloadIntent.plan.layout || !reloadIntent.plan.buildPaint || !reloadIntent.plan.passivePaint) return 311;

        pipelineState.enqueueIntent(arrange::core::InputIntent::resourceReady("resource ready contract"));
        const auto resourceIntent = pipelineState.run(1, {0.0f, 120.0f, 0.0f, 80.0f}, false);
        if (resourceIntent.error || resourceIntent.plan.fullFallback || !resourceIntent.plan.fallbackReason.empty()) return 312;
        if (!resourceIntent.invalidation.affects(arrange::core::DirtyFlag::Resource) || resourceIntent.plan.measure || resourceIntent.plan.layout || !resourceIntent.plan.buildPaint || resourceIntent.plan.buildHitTest) return 313;

        pipelineState.enqueueIntent(arrange::core::InputIntent::resourceFailed("resource failed contract"));
        const auto resourceFailed = pipelineState.run(1, {0.0f, 120.0f, 0.0f, 80.0f}, false);
        if (resourceFailed.error || resourceFailed.plan.fullFallback || !resourceFailed.plan.fallbackReason.empty()) return 314;
        if (!resourceFailed.invalidation.affects(arrange::core::DirtyFlag::Resource) || !resourceFailed.invalidation.affects(arrange::core::DirtyFlag::Accessibility)) return 315;
        if (resourceFailed.plan.measure || resourceFailed.plan.layout || !resourceFailed.plan.buildPaint || resourceFailed.plan.buildHitTest || !resourceFailed.plan.buildDiagnostics || !resourceFailed.plan.publishFrame || !resourceFailed.plan.passivePaint) return 316;

        std::vector<arrange::core::DrawOp> overlayOps;
        arrange::core::DrawOp overlayCaret;
        overlayCaret.type = arrange::core::DrawOpType::DrawLine;
        overlayCaret.nodeId = 1;
        overlayCaret.rect = {10.0f, 12.0f, 0.0f, 0.0f};
        overlayCaret.lineEnd = {10.0f, 36.0f};
        overlayCaret.strokeWidth = 1.0f;
        overlayOps.push_back(overlayCaret);
        pipelineState.setOverlayDrawOps(std::move(overlayOps), 1, 6.0f);
        const auto& overlayFrame = pipelineState.publishedFrame();
        if (!overlayFrame.changes.overlayDrawOpsChanged || !overlayFrame.changes.hasOverlayRepaintBounds) return 320;
        if (overlayFrame.content.focusedInputNode != 1 || !near(overlayFrame.content.focusedInputViewportX, 6.0f)) return 321;
        if (!near(overlayFrame.changes.overlayRepaintBounds.x, 9.0f) || !near(overlayFrame.changes.overlayRepaintBounds.y, 11.0f)) return 322;

        std::vector<arrange::core::DrawOp> diagnosticsOps;
        arrange::core::DrawOp diagnosticsBadge;
        diagnosticsBadge.type = arrange::core::DrawOpType::FillRect;
        diagnosticsBadge.rect = {20.0f, 22.0f, 30.0f, 12.0f};
        diagnosticsOps.push_back(diagnosticsBadge);
        pipelineState.setDiagnosticsDrawOps({}, std::move(diagnosticsOps), {});
        const auto& diagnosticsFrame = pipelineState.publishedFrame();
        if (!diagnosticsFrame.changes.diagnosticsDrawOpsChanged || !diagnosticsFrame.changes.hasDiagnosticsRepaintBounds) return 323;
        if (diagnosticsFrame.content.diagnosticsBadgeDrawOps.empty()) return 324;

        pipelineState.enqueueIntent(arrange::core::InputIntent::resize({0.0f, 240.0f, 0.0f, 160.0f}, "resize contract"));
        const auto resizeIntent = pipelineState.run(1, {0.0f, 240.0f, 0.0f, 160.0f}, false);
        if (resizeIntent.error || resizeIntent.plan.fullFallback || !resizeIntent.plan.fallbackReason.empty()) return 317;
        if (!resizeIntent.invalidation.affects(arrange::core::DirtyFlag::Layout)) return 318;
        if (!resizeIntent.plan.measure || !resizeIntent.plan.layout || !resizeIntent.plan.buildPaint || !resizeIntent.plan.buildHitTest || !resizeIntent.plan.publishFrame || !resizeIntent.plan.passivePaint) return 319;

        return 0;
    }

    int verifyFramePlannerTickPlanContract() {
        arrange::juce::FramePlanner planner;

        const auto idle = planner.planTick({});
        if (idle.runEvents || idle.runAnimation || idle.runPipeline || idle.hasTickWork) return 260;
        if (planner.hasPendingFrameWork({})) return 261;
        if (planner.desiredTimerFrequencyHz({}) != 20) return 262;

        planner.requestFramePipelineRun();
        const auto explicitPipeline = planner.planTick({});
        if (explicitPipeline.runEvents || explicitPipeline.runAnimation || !explicitPipeline.runPipeline || !explicitPipeline.hasTickWork) return 263;
        if (!planner.hasPendingFrameWork({})) return 264;
        if (planner.desiredTimerFrequencyHz({}) != 60) return 265;
        if (!planner.framePipelineRunRequested()) return 266;
        planner.clearFramePipelineRunRequest();
        if (planner.framePipelineRunRequested()) return 267;

        const arrange::juce::FrameWorkState queuedAnimatedState{true, true, false, false};
        const auto queuedAnimated = planner.planTick(queuedAnimatedState);
        if (!queuedAnimated.runEvents || !queuedAnimated.runAnimation || queuedAnimated.runPipeline || !queuedAnimated.hasTickWork) return 268;
        if (planner.framePipelineRunRequested()) return 269;

        const arrange::juce::FrameWorkState transactionOnlyState{false, false, false, true};
        const auto transactionOnly = planner.planTick(transactionOnlyState);
        if (transactionOnly.runEvents || transactionOnly.runAnimation || !transactionOnly.runPipeline || !transactionOnly.hasTickWork) return 270;

        planner.reset();
        const auto reset = planner.planTick({});
        if (reset.hasTickWork || planner.framePipelineRunRequested()) return 271;
        return 0;
    }
}

int main(int argc, char** argv) {
    if (const auto bridge = verifyBridgeTreeAndLayout(argc, argv); bridge != 0) return bridge;
    if (const auto layout = verifyNativeArrangementAndWeightLayout(); layout != 0) return layout;
    if (const auto modifierOrder = verifyNativeModifierOrderFirstSlice(); modifierOrder != 0) return modifierOrder;
    if (const auto text = verifyNativeTextFirstSlice(); text != 0) return text;
    if (const auto insertChild = verifyLayoutTreeInsertChildKeepsParentReferenceStable(); insertChild != 0) return insertChild;
    if (const auto cycles = verifyLayoutTreeRejectsCyclesAndDeduplicatesChildren(); cycles != 0) return cycles;
    if (const auto dirty = verifyLayoutTreeDirtyPropagationFirstSlice(); dirty != 0) return dirty;
    if (const auto dirtySnapshot = verifyLayoutTreeDirtySnapshotAndClearFirstSlice(); dirtySnapshot != 0) return dirtySnapshot;
    if (const auto transformHit = verifyNativeGraphicsLayerTranslationHitTestFirstSlice(); transformHit != 0) return transformHit;
    if (const auto transformScaleRotationHit = verifyNativeGraphicsLayerScaleRotationHitTestFirstSlice(); transformScaleRotationHit != 0) return transformScaleRotationHit;
    if (const auto nestedTransformClip = verifyNativeNestedTransformClipFirstSlice(); nestedTransformClip != 0) return nestedTransformClip;
    if (const auto zIndex = verifyNativeZIndexPaintAndHitTestFirstSlice(); zIndex != 0) return zIndex;
    if (const auto input = verifyNativeInputFirstSlice(); input != 0) return input;
    if (const auto inputEditing = verifyNativeTextInputEditingFirstSlice(); inputEditing != 0) return inputEditing;
    if (const auto imageIcon = verifyNativeImageIconFirstSlice(); imageIcon != 0) return imageIcon;
    if (const auto typedModifierElements = verifyNativeTypedModifierPayloadWithoutExpandedProps(); typedModifierElements != 0) return typedModifierElements;
    if (const auto propValue = verifyPropValueContract(); propValue != 0) return propValue;
    if (const auto textLayout = verifyTextLayoutServiceContract(); textLayout != 0) return textLayout;
    if (const auto pipeline = verifyMutationTransactionQueueAndSceneFramePipelineContract(); pipeline != 0) return pipeline;
    if (const auto precisePipeline = verifySceneFramePipelinePrecisionContract(); precisePipeline != 0) return precisePipeline;
    if (const auto transaction = verifyMutationTransactionAndNativeSceneContract(); transaction != 0) return transaction;
    if (const auto intentInvalidation = verifyInputIntentInvalidationContract(); intentInvalidation != 0) return intentInvalidation;
    if (const auto framePlanner = verifyFramePlannerTickPlanContract(); framePlanner != 0) return framePlanner;
    if (const auto app = verifyAppResolverAndScriptLoader(); app != 0) return app;
    if (const auto devServer = verifyDevServerClientFirstSlice(); devServer != 0) return devServer;
    return 0;
}
