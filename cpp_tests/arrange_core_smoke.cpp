#include <arrange/core/Bridge.h>
#include <arrange/core/Layout.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/InputEditing.h>
#include <arrange/core/PointerDispatcher.h>
#include <arrange/core/Paint.h>
#include <arrange/core/PropValue.h>
#include <arrange/core/RenderTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/core/Version.h>
#include <arrange/juce/AppResolver.h>
#include <arrange/juce/DevServerClient.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/HeadlessArrangeEditor.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/CallbackRegistry.h>

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

        arrange::quickjs::CallbackInvokeResult invokeCallback(std::uint32_t callbackHandle, const arrange::quickjs::CallbackInvokeOptions& options = {}) override {
            invokedHandles.push_back(callbackHandle);
            if (options.hasStringArgument) invokedStringArguments.push_back(options.stringArgument);
            if (callbackHandle == 999) return {false, "Mock callback failed"};
            return {true, {}};
        }

        int executeCount = 0;
        std::filesystem::path lastModulePath;
        std::string lastSource;
        std::vector<std::uint32_t> invokedHandles;
        std::vector<std::string> invokedStringArguments;
    };

    bool near(float actual, float expected, float epsilon = 0.01f) { return std::fabs(actual - expected) <= epsilon; }
    bool hasDirty(const arrange::core::ArrangeNode& node, arrange::core::DirtyFlag flag) { return (node.dirty & arrange::core::dirtyMask(flag)) != 0; }

    void clearDirty(arrange::core::RenderTree& tree, std::initializer_list<arrange::core::NodeId> ids) { for (auto id : ids) { if (tree.contains(id)) tree.node(id).dirty = 0; } }

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

    float parseTestNumberAfter(const std::string& text, const char* key, float fallback = 0.0f) {
        const auto pos = text.find(key);
        if (pos == std::string::npos) return fallback;
        char* end = nullptr;
        const auto parsed = std::strtof(text.c_str() + pos + std::string(key).size(), &end);
        return end == text.c_str() + pos + std::string(key).size() ? fallback : parsed;
    }

    bool parseTestBoolAfter(const std::string& text, const char* key, bool fallback = false) {
        const auto pos = text.find(key);
        if (pos == std::string::npos) return fallback;
        const auto value = std::string_view(text).substr(pos + std::string(key).size());
        if (value.starts_with("true") || value.starts_with("1")) return true;
        if (value.starts_with("false") || value.starts_with("0")) return false;
        return fallback;
    }

    std::string parseTestStringAfter(const std::string& text, const char* key) {
        const auto pos = text.find(key);
        if (pos == std::string::npos) return {};

        auto start = pos + std::string(key).size();
        if (start < text.size() && text[start] == '"') ++start;

        std::string result;
        bool escaping = false;
        for (auto i = start; i < text.size(); ++i) {
            const auto ch = text[i];

            if (escaping) {
                result.push_back(ch);
                escaping = false;
                continue;
            }

            if (ch == '\\') {
                escaping = true;
                continue;
            }

            if (ch == '"') break;
            result.push_back(ch);
        }
        return result;
    }

    std::uint32_t parseTestHandleAfter(const std::string& text, const char* key) {
        const auto pos = text.find(key);
        if (pos == std::string::npos) return 0;

        char* end = nullptr;
        const auto parsed = std::strtoul(text.c_str() + pos + std::string(key).size(), &end, 10);
        return end == text.c_str() + pos + std::string(key).size() ? 0 : static_cast<std::uint32_t>(parsed);
    }

    void addTypedNumber(std::vector<arrange::core::BridgeOp>& ops, arrange::core::NodeId id, const std::string& prefix, const std::string& key, const std::string& body, const char* jsonKey, float fallback = 0.0f) {
        if (body.find(jsonKey) == std::string::npos) return;
        addTypedProp(ops, id, prefix + key, encodedNumber(parseTestNumberAfter(body, jsonKey, fallback)));
    }

    void addTypedUint(std::vector<arrange::core::BridgeOp>& ops, arrange::core::NodeId id, const std::string& prefix, const std::string& key, const std::string& body, const char* jsonKey) {
        const auto pos = body.find(jsonKey);
        if (pos == std::string::npos) return;

        const auto start = pos + std::string(jsonKey).size();
        char* end = nullptr;
        const auto parsed = std::strtoul(body.c_str() + start, &end, 10);
        if (end == body.c_str() + start) return;

        addTypedProp(ops, id, prefix + key, "f:" + std::to_string(static_cast<std::uint32_t>(parsed)));
    }

    void addTypedBool(std::vector<arrange::core::BridgeOp>& ops, arrange::core::NodeId id, const std::string& prefix, const std::string& key, const std::string& body, const char* jsonKey, bool fallback = false) {
        if (body.find(jsonKey) == std::string::npos) return;
        addTypedProp(ops, id, prefix + key, parseTestBoolAfter(body, jsonKey, fallback) ? "b:1" : "b:0");
    }

    void addTypedString(std::vector<arrange::core::BridgeOp>& ops, arrange::core::NodeId id, const std::string& prefix, const std::string& key, const std::string& body, const char* jsonKey) {
        if (body.find(jsonKey) == std::string::npos) return;
        addTypedProp(ops, id, prefix + key, "s:" + parseTestStringAfter(body, jsonKey));
    }

    void addTypedHandle(std::vector<arrange::core::BridgeOp>& ops, arrange::core::NodeId id, const std::string& prefix, const std::string& key, const std::string& body, const char* jsonKey) {
        if (body.find(jsonKey) == std::string::npos) return;
        addTypedProp(ops, id, prefix + key, "h:" + std::to_string(parseTestHandleAfter(body, jsonKey)));
    }

    std::vector<std::string> testModifierObjects(std::string_view encodedJson) {
        auto text = std::string(encodedJson);
        if (text.rfind("o:", 0) == 0) text = text.substr(2);
        std::vector<std::string> objects;

        for (std::size_t i = 0; i < text.size(); ++i) {
            if (text[i] != '{') continue;

            const auto objectStart = i;
            int depth = 0;
            bool inString = false;
            bool escaping = false;
            for (; i < text.size(); ++i) {
                const auto ch = text[i];
                if (escaping) {
                    escaping = false;
                    continue;
                }

                if (ch == '\\') {
                    escaping = inString;
                    continue;
                }

                if (ch == '"') {
                    inString = !inString;
                    continue;
                }

                if (inString) continue;

                if (ch == '{') ++depth;

                if (ch == '}') {
                    --depth;
                    if (depth == 0) break;
                }
            }
            if (i < text.size()) objects.push_back(text.substr(objectStart, i - objectStart + 1));
        }
        return objects;
    }

    void appendTypedModifierForSmoke(std::vector<arrange::core::BridgeOp>& ops, arrange::core::NodeId id, std::string_view encodedJson) {
        const auto objects = testModifierObjects(encodedJson);
        addTypedProp(ops, id, "__arrangeModifierCount", encodedNumber(static_cast<float>(objects.size())));

        for (std::size_t index = 0; index < objects.size(); ++index) {
            const auto& body = objects[index];
            const auto prefix = "__arrangeModifier." + std::to_string(index) + ".";
            const auto type = parseTestStringAfter(body, "\"type\":");
            addTypedProp(ops, id, prefix + "type", "s:" + type);
            addTypedNumber(ops, id, prefix, "value", body, "\"value\":");
            addTypedNumber(ops, id, prefix, "width", body, "\"width\":");
            addTypedNumber(ops, id, prefix, "height", body, "\"height\":");
            addTypedNumber(ops, id, prefix, "fraction", body, "\"fraction\":", 1.0f);
            addTypedNumber(ops, id, prefix, "min", body, "\"min\":");
            addTypedNumber(ops, id, prefix, "max", body, "\"max\":");
            addTypedNumber(ops, id, prefix, "minWidth", body, "\"minWidth\":");
            addTypedNumber(ops, id, prefix, "maxWidth", body, "\"maxWidth\":");
            addTypedNumber(ops, id, prefix, "minHeight", body, "\"minHeight\":");
            addTypedNumber(ops, id, prefix, "maxHeight", body, "\"maxHeight\":");
            addTypedNumber(ops, id, prefix, "start", body, "\"start\":");
            addTypedNumber(ops, id, prefix, "top", body, "\"top\":");
            addTypedNumber(ops, id, prefix, "end", body, "\"end\":");
            addTypedNumber(ops, id, prefix, "bottom", body, "\"bottom\":");
            addTypedNumber(ops, id, prefix, "x", body, "\"x\":");
            addTypedNumber(ops, id, prefix, "y", body, "\"y\":");
            addTypedNumber(ops, id, prefix, "weight", body, "\"weight\":");
            addTypedBool(ops, id, prefix, "fill", body, "\"fill\":", true);
            addTypedString(ops, id, prefix, "alignment", body, "\"alignment\":");
            addTypedUint(ops, id, prefix, "brush", body, "\"brush\":");
            addTypedUint(ops, id, prefix, "color", body, "\"color\":");
            addTypedNumber(ops, id, prefix, "offsetX", body, "\"offsetX\":");
            addTypedNumber(ops, id, prefix, "offsetY", body, "\"offsetY\":");
            addTypedNumber(ops, id, prefix, "offset.x", body, "\"offset\":{\"x\":");
            addTypedNumber(ops, id, prefix, "offset.y", body, "\"y\":");
            addTypedNumber(ops, id, prefix, "scaleX", body, "\"scaleX\":", 1.0f);
            addTypedNumber(ops, id, prefix, "scaleY", body, "\"scaleY\":", 1.0f);
            addTypedNumber(ops, id, prefix, "translationX", body, "\"translationX\":");
            addTypedNumber(ops, id, prefix, "translationY", body, "\"translationY\":");
            addTypedNumber(ops, id, prefix, "rotationZ", body, "\"rotationZ\":");
            addTypedString(ops, id, prefix, "transformOrigin", body, "\"transformOrigin\":");
            addTypedNumber(ops, id, prefix, "shape.radius", body, "\"radius\":");
            if (body.find("\"shape\":{\"type\":\"rounded\"") != std::string::npos) addTypedProp(ops, id, prefix + "shape.type", "s:rounded");
            if (body.find("\"shape\":{\"type\":\"circle\"") != std::string::npos) addTypedProp(ops, id, prefix + "shape.type", "s:circle");
            addTypedNumber(ops, id, prefix, "state.value", body, "\"state\":{\"value\":");
            addTypedHandle(ops, id, prefix, "state.__arrangeNativeScroll.callbackHandle", body, "\"__arrangeNativeScroll\":{\"callbackHandle\":");
            addTypedHandle(ops, id, prefix, "onClick.callbackHandle", body, "\"onClick\":{\"callbackHandle\":");
            addTypedHandle(ops, id, prefix, "callbackHandle", body, "\"callbackHandle\":");
        }
    }

    void applySmokeBatch(arrange::core::RenderTree& tree, const arrange::core::BridgeBatch& batch) {
        arrange::core::BridgeBatch expanded = batch;
        const auto originalOps = expanded.ops;
        expanded.ops.clear();

        for (const auto& op : originalOps) {
            expanded.ops.push_back(op);
            if (op.opcode == arrange::core::BridgeOpcode::SetModifier) appendTypedModifierForSmoke(expanded.ops, op.id, op.modifierDebugJson);
        }
        tree.apply(expanded);
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

        arrange::core::RenderTree tree;
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

        arrange::core::PaintModel paint;
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
        arrange::core::PointerDispatcher dispatcher;
        const auto down = dispatcher.pointerDown(tree, 1, {10.0f, 32.0f}, 1);
        if (!down.consumed || down.clickTriggered || down.target != 3 || down.callbackHandle != 1) return 19;
        const auto up = dispatcher.pointerUp(tree, 1, {10.0f, 32.0f}, 1);
        if (!up.consumed || !up.clickTriggered || up.target != 3 || up.callbackHandle != 1) return 37;
        arrange::quickjs::CallbackRegistry callbackRegistry;
        callbackRegistry.add(up.callbackHandle);
        MockScriptHost clickHost;
        arrange::quickjs::CallbackDispatcher callbackDispatcher(callbackRegistry, clickHost);
        const auto callback = callbackDispatcher.dispatch(up.callbackHandle);
        if (!callback.ok || clickHost.invokedHandles.size() != 1 || clickHost.invokedHandles[0] != 1) return 42;
        arrange::quickjs::CallbackInvokeOptions textCallbackOptions;
        textCallbackOptions.hasStringArgument = true;
        textCallbackOptions.stringArgument = "typed";
        const auto textCallback = callbackDispatcher.dispatch(up.callbackHandle, textCallbackOptions);
        if (!textCallback.ok || clickHost.invokedStringArguments.empty() || clickHost.invokedStringArguments.back() != "typed") return 63;
        const auto unknownCallback = callbackDispatcher.dispatch(777);
        if (unknownCallback.ok) return 43;
        const auto dragDown = dispatcher.pointerDown(tree, 1, {10.0f, 32.0f}, 2);
        if (!dragDown.consumed) return 38;
        const auto dragOut = dispatcher.pointerUp(tree, 1, {10.0f, 10.0f}, 2);
        if (!dragOut.consumed || dragOut.clickTriggered) return 39;
        const auto cancelDown = dispatcher.pointerDown(tree, 1, {10.0f, 32.0f}, 3);
        if (!cancelDown.consumed) return 40;
        const auto cancel = dispatcher.pointerCancel(3);
        if (!cancel.consumed || cancel.clickTriggered || cancel.target != 3 || cancel.callbackHandle != 1) return 41;
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

        arrange::core::RenderTree rowTree;
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

        arrange::core::RenderTree columnTree;
        applySmokeBatch(columnTree, columnBatch);
        layout.layout(columnTree, 1, {0.0f, 80.0f, 0.0f, 100.0f});
        if (!near(columnTree.node(2).bounds.y, 0.0f) || !near(columnTree.node(2).bounds.height, 20.0f)) return 58;
        if (!near(columnTree.node(3).bounds.y, 26.0f) || !near(columnTree.node(3).bounds.height, 74.0f)) return 59;
        if (!near(columnTree.node(3).bounds.width, 80.0f)) return 60;
        return 0;
    }

    int verifyNativeWeightTypedPropsWithoutDebugJson() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 9};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Row"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":300,\"height\":40}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"width\",\"value\":100}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "__arrangeWeight", "f:1"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "__arrangeWeightFill", "b:1"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 300.0f, 0.0f, 40.0f});
        if (!near(tree.node(3).bounds.x, 100.0f) || !near(tree.node(3).bounds.width, 200.0f)) return 202;
        if (tree.node(3).modifierDebugJson.find("weight") != std::string::npos) return 203;

        tree.node(3).props["__arrangeWeightFill"] = "b:0";
        layout.layout(tree, 1, {0.0f, 300.0f, 0.0f, 40.0f});
        if (!near(tree.node(3).bounds.width, 0.0f)) return 204;
        return 0;
    }

    int verifyNativeAlignAndOffsetTypedPropsWithoutDebugJson() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 8};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":100}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":10}]"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeAlign", "s:BottomEnd"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeLayoutOffsetX", "f:3"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeLayoutOffsetY", "f:4"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 100.0f});
        if (!near(tree.node(2).bounds.x, 83.0f) || !near(tree.node(2).bounds.y, 94.0f)) return 205;
        if (tree.node(2).modifierDebugJson.find("align") != std::string::npos) return 206;
        if (tree.node(2).modifierDebugJson.find("offset") != std::string::npos) return 207;
        return 0;
    }

    int verifyNativeTypedModifierElementsWithoutDebugJson() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 15};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifierCount", "f:4"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.0.type", "s:size"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.0.width", "f:80"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.0.height", "f:40"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.1.type", "s:background"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.1.brush", "f:4279312947"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.2.type", "s:padding"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.2.start", "f:10"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.2.top", "f:6"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.2.end", "f:10"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.2.bottom", "f:6"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.3.type", "s:clip"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.3.shape.type", "s:rounded"},
            {arrange::core::BridgeOpcode::SetProp, 1, 0, 0, 0, {}, "__arrangeModifier.3.shape.radius", "f:4"},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 200.0f, 0.0f, 200.0f});
        if (!near(tree.node(1).bounds.width, 80.0f) || !near(tree.node(1).bounds.height, 40.0f)) return 218;
        if (!tree.node(1).modifierDebugJson.empty()) return 219;

        arrange::core::PaintModel paint;
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

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 400.0f, 0.0f, 400.0f});

        if (!near(tree.node(2).bounds.x, 0.0f) || !near(tree.node(2).bounds.y, 0.0f) || !near(tree.node(2).bounds.width, 100.0f) || !near(tree.node(2).bounds.height, 40.0f)) return 82;
        if (!near(tree.node(3).bounds.x, 0.0f) || !near(tree.node(3).bounds.y, 40.0f) || !near(tree.node(3).bounds.width, 120.0f) || !near(tree.node(3).bounds.height, 60.0f)) return 83;

        arrange::core::PaintModel paint;
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
        arrange::core::RenderTree alphaTree;
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
        arrange::core::RenderTree shapeTree;
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

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 400.0f, 0.0f, 400.0f});
        if (!near(tree.node(1).bounds.width, 72.0f) || !near(tree.node(1).bounds.height, 28.0f)) return 97;
        if (!near(tree.node(1).baseline, 11.2f)) return 98;

        arrange::core::PaintModel paint;
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
        arrange::core::RenderTree cjkTree;
        applySmokeBatch(cjkTree, cjkBatch);
        layout.layout(cjkTree, 10, {0.0f, 400.0f, 0.0f, 400.0f});
        if (!near(cjkTree.node(10).bounds.width, 20.0f) ||
            !near(cjkTree.node(10).bounds.height, 24.0f))
            return 197;
        return 0;
    }

    int verifyRenderTreeInsertChildKeepsParentReferenceStable() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 60};
        batch.ops.push_back({arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"});
        for (arrange::core::NodeId id = 2; id < 22; ++id) {
            batch.ops.push_back({arrange::core::BridgeOpcode::CreateNode, id, 0, 0, 0, "Box"});
            batch.ops.push_back({arrange::core::BridgeOpcode::InsertChild, 0, 1, id, id - 2});
        }

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        if (tree.node(1).children.size() != 20) return 101;
        for (std::size_t index = 0; index < tree.node(1).children.size(); ++index) { if (tree.node(1).children[index] != static_cast<arrange::core::NodeId>(index + 2)) return 102; }
        return 0;
    }

    int verifyRenderTreeRejectsCyclesAndDeduplicatesChildren() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 5};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 1},
            {arrange::core::BridgeOpcode::InsertChild, 0, 2, 1, 0},
        };

        arrange::core::RenderTree tree;
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

    int verifyRenderTreeDirtyPropagationFirstSlice() {
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

        arrange::core::RenderTree tree;
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
        modifierChange.ops = {{arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"offset\",\"x\":8,\"y\":4},{\"type\":\"clickable\",\"onClick\":{\"callbackHandle\":7}}]"}};
        applySmokeBatch(tree, modifierChange);
        if (!hasDirty(tree.node(3), arrange::core::DirtyFlag::Transform) || !hasDirty(tree.node(3), arrange::core::DirtyFlag::HitTest)) return 125;
        if (!hasDirty(tree.node(2), arrange::core::DirtyFlag::HitTest) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::HitTest)) return 126;
        if (!hasDirty(tree.node(2), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Layout)) return 127;

        clearDirty(tree, {1, 2, 3});
        arrange::core::BridgeBatch typedTransformChange;
        typedTransformChange.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        typedTransformChange.ops = {{arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "__arrangeLayoutOffsetX", "f:4"}};
        applySmokeBatch(tree, typedTransformChange);
        if (!hasDirty(tree.node(3), arrange::core::DirtyFlag::Transform) || !hasDirty(tree.node(3), arrange::core::DirtyFlag::HitTest)) return 211;
        if (!hasDirty(tree.node(2), arrange::core::DirtyFlag::HitTest) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Paint)) return 212;

        clearDirty(tree, {1, 2, 3});
        arrange::core::BridgeBatch typedLayerChange;
        typedLayerChange.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        typedLayerChange.ops = {{arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "__arrangeLayerScaleX", "f:2"}};
        applySmokeBatch(tree, typedLayerChange);
        if (!hasDirty(tree.node(3), arrange::core::DirtyFlag::Transform) || !hasDirty(tree.node(3), arrange::core::DirtyFlag::HitTest)) return 213;
        if (!hasDirty(tree.node(2), arrange::core::DirtyFlag::HitTest) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Paint)) return 214;

        clearDirty(tree, {1, 2, 3});
        arrange::core::BridgeBatch resourceChange;
        resourceChange.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
        resourceChange.ops = {{arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "source", "s:logo.png"}};
        applySmokeBatch(tree, resourceChange);
        if (!hasDirty(tree.node(3), arrange::core::DirtyFlag::Resource)) return 128;
        if (!hasDirty(tree.node(2), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Paint)) return 129;

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

    int verifyRenderTreeDirtySnapshotAndClearFirstSlice() {
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

        arrange::core::RenderTree tree;
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
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":10},{\"type\":\"graphicsLayer\",\"translationX\":30,\"translationY\":5},{\"type\":\"background\",\"brush\":4281549909},{\"type\":\"clickable\",\"onClick\":{\"callbackHandle\":9}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 50.0f});
        if (!near(tree.node(2).bounds.x, 30.0f) || !near(tree.node(2).bounds.y, 5.0f) || !near(tree.node(2).bounds.width, 20.0f)) return 137;

        arrange::core::HitTester hitTester;
        const auto originalPoint = hitTester.hitTestClickable(tree, 1, {4.0f, 4.0f});
        if (originalPoint.hit) return 138;
        const auto translatedPoint = hitTester.hitTestClickable(tree, 1, {35.0f, 8.0f});
        if (!translatedPoint.hit || translatedPoint.node != 2 || !translatedPoint.clickable) return 139;

        arrange::core::PaintModel paint;
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
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"graphicsLayer\",\"scaleX\":2,\"scaleY\":2},{\"type\":\"background\",\"brush\":4279312947},{\"type\":\"clickable\",\"onClick\":{\"callbackHandle\":12}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {
                arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {},
                "o:[{\"type\":\"size\",\"width\":20,\"height\":10},{\"type\":\"offset\",\"x\":40,\"y\":20},{\"type\":\"graphicsLayer\",\"rotationZ\":90},{\"type\":\"background\",\"brush\":4280427042},{\"type\":\"clickable\",\"onClick\":{\"callbackHandle\":13}}]"
            },
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::RenderTree tree;
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

        arrange::core::PaintModel paint;
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

    int verifyNativeGraphicsLayerTransformTypedPropsWithoutDebugJson() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 10};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":80}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20}]"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeLayerScaleX", "f:2"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeLayerScaleY", "f:2"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeLayerRotationZ", "f:0"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeClickableEnabled", "b:1"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeClickCallback", "h:31"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 80.0f});

        arrange::core::HitTester hitTester;
        const auto scaledOutsideOriginal = hitTester.hitTestClickable(tree, 1, {25.0f, 10.0f});
        if (!scaledOutsideOriginal.hit || scaledOutsideOriginal.node != 2 || !scaledOutsideOriginal.clickable) return 215;

        arrange::core::PaintModel paint;
        const auto ops = paint.collect(tree, 1);
        bool sawTypedTransform = false;
        int transformPops = 0;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::PushTransform &&
                near(op.scaleX, 2.0f) &&
                near(op.scaleY, 2.0f) &&
                near(op.rotationZ, 0.0f) &&
                near(op.transformOriginX, 0.5f) &&
                near(op.transformOriginY, 0.5f)) { sawTypedTransform = true; }
            if (op.type == arrange::core::DrawOpType::PopTransform) ++transformPops;
        }
        if (!sawTypedTransform || transformPops != 1) return 216;
        if (tree.node(2).modifierDebugJson.find("graphicsLayer") != std::string::npos) return 217;
        return 0;
    }

    int verifyNativeNestedTransformClipFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 6};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":60},{\"type\":\"graphicsLayer\",\"scaleX\":2,\"scaleY\":2,\"transformOrigin\":\"TopStart\"},{\"type\":\"clip\",\"shape\":{\"type\":\"rounded\",\"radius\":4}}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"offset\",\"x\":70,\"y\":5},{\"type\":\"background\",\"brush\":4279312947},{\"type\":\"clickable\",\"onClick\":{\"callbackHandle\":21}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 60.0f});

        arrange::core::HitTester hitTester;
        const auto hit = hitTester.hitTestClickable(tree, 1, {150.0f, 20.0f});
        if (!hit.hit || hit.node != 2 || !hit.clickable) return 178;

        arrange::core::PaintModel paint;
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
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"zIndex\",\"value\":10},{\"type\":\"background\",\"brush\":4278190335},{\"type\":\"clickable\",\"onClick\":{\"callbackHandle\":10}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"zIndex\",\"value\":0},{\"type\":\"background\",\"brush\":4294901760},{\"type\":\"clickable\",\"onClick\":{\"callbackHandle\":11}}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 40.0f, 0.0f, 40.0f});

        arrange::core::PaintModel paint;
        const auto ops = paint.collect(tree, 1);
        std::vector<std::uint32_t> fills;
        for (const auto& op : ops) { if (op.type == arrange::core::DrawOpType::FillRect) fills.push_back(op.color); }
        if (fills.size() != 2 || fills[0] != 0xffff0000u || fills[1] != 0xff0000ffu) return 141;

        arrange::core::HitTester hitTester;
        const auto hit = hitTester.hitTestClickable(tree, 1, {4.0f, 4.0f});
        if (!hit.hit || hit.node != 2 || !hit.clickable) return 142;
        return 0;
    }

    int verifyNativeZIndexTypedPropsWithoutDebugJson() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 12};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":40,\"height\":40}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"background\",\"brush\":4278190335}]"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeZIndex", "f:10"},
            {arrange::core::BridgeOpcode::SetProp, 2, 0, 0, 0, {}, "__arrangeClickableEnabled", "b:1"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":20,\"height\":20},{\"type\":\"background\",\"brush\":4294901760}]"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "__arrangeZIndex", "f:0"},
            {arrange::core::BridgeOpcode::SetProp, 3, 0, 0, 0, {}, "__arrangeClickableEnabled", "b:1"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 40.0f, 0.0f, 40.0f});

        arrange::core::PaintModel paint;
        const auto ops = paint.collect(tree, 1);
        std::vector<std::uint32_t> fills;
        for (const auto& op : ops) { if (op.type == arrange::core::DrawOpType::FillRect) fills.push_back(op.color); }
        if (fills.size() != 2 || fills[0] != 0xffff0000u || fills[1] != 0xff0000ffu) return 208;

        arrange::core::HitTester hitTester;
        const auto hit = hitTester.hitTestClickable(tree, 1, {4.0f, 4.0f});
        if (!hit.hit || hit.node != 2 || !hit.clickable) return 209;
        if (tree.node(2).modifierDebugJson.find("zIndex") != std::string::npos) return 210;
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

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, inputBatch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 240.0f, 0.0f, 80.0f});
        if (!near(tree.node(1).bounds.width, 120.0f) || !near(tree.node(1).bounds.height, 28.0f)) return 61;

        arrange::core::PaintModel paint;
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
        arrange::core::RenderTree cjkInputTree;
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
        arrange::core::RenderTree multilineTree;
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

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 120.0f, 0.0f, 40.0f});
        if (!near(tree.node(2).bounds.width, 24.0f) || !near(tree.node(2).bounds.height, 24.0f)) return 64;
        if (!near(tree.node(3).bounds.width, 24.0f) || !near(tree.node(3).bounds.height, 24.0f)) return 65;

        arrange::core::PaintModel paint;
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
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"verticalScroll\",\"state\":{\"value\":12,\"__arrangeNativeScroll\":{\"callbackHandle\":77}},\"enabled\":true}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":80},{\"type\":\"fillMaxWidth\",\"fraction\":1},{\"type\":\"background\",\"brush\":4281549909}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":20},{\"type\":\"fillMaxWidth\",\"fraction\":1},{\"type\":\"background\",\"brush\":4282668390}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(1).bounds.width, 100.0f) || !near(tree.node(1).bounds.height, 40.0f)) return 67;
        if (!near(tree.node(2).bounds.y, -12.0f) || !near(tree.node(2).bounds.height, 80.0f)) return 68;
        if (!near(tree.node(3).bounds.y, 68.0f) || !near(tree.node(3).bounds.height, 20.0f)) return 69;

        arrange::core::PaintModel paint;
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

        tree.node(1).props["__arrangeVerticalScrollValue"] = "f:0";
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        tree.clearDirty();
        arrange::core::ScrollDispatcher scroll;
        const auto scrolled = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -1.0f, 24.0f);
        if (!scrolled.consumed || scrolled.target != 1 || !near(scrolled.value, 24.0f) || !near(scrolled.maxValue, 60.0f) || !near(scrolled.viewportSize, 40.0f) || !near(scrolled.contentSize, 100.0f) || scrolled.callbackHandle != 77) return 71;
        if (!hasDirty(tree.node(1), arrange::core::DirtyFlag::Layout) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::Paint) || !hasDirty(tree.node(1), arrange::core::DirtyFlag::HitTest)) return 153;
        const auto dirty = tree.dirtySnapshot(arrange::core::dirtyMask(arrange::core::DirtyFlag::Layout) | arrange::core::dirtyMask(arrange::core::DirtyFlag::Paint));
        if (dirty.nodeCount != 1 || !dirty.hasRepaintBounds || !near(dirty.repaintBounds.width, 100.0f) || !near(dirty.repaintBounds.height, 40.0f)) return 154;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(2).bounds.y, -24.0f) || !near(tree.node(3).bounds.y, 56.0f)) return 72;
        const auto clamped = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -10.0f, 24.0f);
        if (!clamped.consumed || !near(clamped.value, 60.0f) || !near(clamped.maxValue, 60.0f)) return 73;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(2).bounds.y, -60.0f) || !near(tree.node(3).bounds.y, 20.0f)) return 74;
        return 0;
    }

    int verifyNativeHorizontalScrollFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 8};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Row"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"horizontalScroll\",\"state\":{\"value\":15},\"enabled\":true}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"width\",\"value\":80},{\"type\":\"fillMaxHeight\",\"fraction\":1},{\"type\":\"background\",\"brush\":4281549909}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"width\",\"value\":40},{\"type\":\"fillMaxHeight\",\"fraction\":1},{\"type\":\"background\",\"brush\":4282668390}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 3, 1},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(1).bounds.width, 100.0f) || !near(tree.node(1).bounds.height, 40.0f)) return 75;
        if (!near(tree.node(2).bounds.x, -15.0f) || !near(tree.node(2).bounds.width, 80.0f)) return 76;
        if (!near(tree.node(3).bounds.x, 65.0f) || !near(tree.node(3).bounds.width, 40.0f)) return 77;

        arrange::core::PaintModel paint;
        const auto ops = paint.collect(tree, 1);
        bool sawPushClip = false;
        bool sawPopClip = false;
        for (const auto& op : ops) {
            if (op.type == arrange::core::DrawOpType::PushClip && near(op.rect.width, 100.0f) && near(op.rect.height, 40.0f)) sawPushClip = true;
            if (op.type == arrange::core::DrawOpType::PopClip) sawPopClip = true;
        }
        if (!sawPushClip || !sawPopClip) return 78;

        tree.node(1).props["__arrangeHorizontalScrollValue"] = "f:0";
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        arrange::core::ScrollDispatcher scroll;
        const auto scrolled = scroll.horizontalWheel(tree, 1, {8.0f, 8.0f}, -1.0f, 10.0f);
        if (!scrolled.consumed || scrolled.target != 1 || !near(scrolled.value, 10.0f) || !near(scrolled.maxValue, 20.0f)) return 79;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 40.0f});
        if (!near(tree.node(2).bounds.x, -10.0f) || !near(tree.node(3).bounds.x, 70.0f)) return 80;
        const auto clamped = scroll.horizontalWheel(tree, 1, {8.0f, 8.0f}, -10.0f, 10.0f);
        if (!clamped.consumed || !near(clamped.value, 20.0f) || !near(clamped.maxValue, 20.0f)) return 81;
        return 0;
    }

    int verifyNativeNestedScrollConsumptionFirstSlice() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 14};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::SetModifier, 1, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":60},{\"type\":\"verticalScroll\",\"state\":{\"value\":0,\"__arrangeNativeScroll\":{\"callbackHandle\":10}},\"enabled\":true}]"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::SetModifier, 2, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"size\",\"width\":100,\"height\":40},{\"type\":\"verticalScroll\",\"state\":{\"value\":0,\"__arrangeNativeScroll\":{\"callbackHandle\":20}},\"enabled\":true}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
            {arrange::core::BridgeOpcode::CreateNode, 3, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 3, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":50},{\"type\":\"fillMaxWidth\",\"fraction\":1}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 2, 3, 0},
            {arrange::core::BridgeOpcode::CreateNode, 4, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 4, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":50},{\"type\":\"fillMaxWidth\",\"fraction\":1}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 2, 4, 1},
            {arrange::core::BridgeOpcode::CreateNode, 5, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::SetModifier, 5, 0, 0, 0, {}, {}, {}, {}, "o:[{\"type\":\"height\",\"value\":80},{\"type\":\"fillMaxWidth\",\"fraction\":1}]"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 5, 1},
        };

        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        arrange::core::LayoutEngine layout;
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 60.0f});
        arrange::core::ScrollDispatcher scroll;

        const auto childFirst = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -1.0f, 10.0f);
        if (!childFirst.consumed || childFirst.target != 2 || !near(childFirst.value, 10.0f) || !near(childFirst.maxValue, 60.0f) || childFirst.callbackHandle != 20) return 191;

        tree.node(1).props["__arrangeVerticalScrollValue"] = "f:0";
        tree.node(2).props["__arrangeVerticalScrollValue"] = "f:60";
        layout.layout(tree, 1, {0.0f, 100.0f, 0.0f, 60.0f});
        const auto parentFallback = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -1.0f, 10.0f);
        if (!parentFallback.consumed || parentFallback.target != 1 || !near(parentFallback.value, 10.0f) || !near(parentFallback.maxValue, 60.0f) || parentFallback.callbackHandle != 10) return 192;
        if (!tree.node(2).props["__arrangeVerticalScrollValue"].starts_with("f:60")) return 193;
        return 0;
    }

    int verifyNativeScrollTypedPropsWithoutDebugJson() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 3};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };
        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        tree.node(1).bounds = {0.0f, 0.0f, 100.0f, 40.0f};
        tree.node(2).bounds = {0.0f, 0.0f, 100.0f, 100.0f};
        tree.node(1).props["__arrangeVerticalScrollEnabled"] = "b:1";
        tree.node(1).props["__arrangeVerticalScrollValue"] = "f:5";
        tree.node(1).props["__arrangeVerticalScrollCallback"] = "h:123";

        arrange::core::ScrollDispatcher scroll;
        const auto scrolled = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -1.0f, 10.0f);
        if (!scrolled.consumed || scrolled.target != 1 || !near(scrolled.value, 15.0f) || !near(scrolled.maxValue, 60.0f) || scrolled.callbackHandle != 123) return 194;
        if (tree.node(1).modifierDebugJson.find("verticalScroll") != std::string::npos) return 195;

        tree.node(1).props["__arrangeVerticalScrollEnabled"] = "b:0";
        const auto disabled = scroll.verticalWheel(tree, 1, {8.0f, 8.0f}, -1.0f, 10.0f);
        if (disabled.target != 0 || disabled.consumed) return 196;
        return 0;
    }

    int verifyNativeClickableTypedPropsWithoutDebugJson() {
        arrange::core::BridgeBatch batch;
        batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 3};
        batch.ops = {
            {arrange::core::BridgeOpcode::CreateNode, 1, 0, 0, 0, "Column"},
            {arrange::core::BridgeOpcode::CreateNode, 2, 0, 0, 0, "Box"},
            {arrange::core::BridgeOpcode::InsertChild, 0, 1, 2, 0},
        };
        arrange::core::RenderTree tree;
        applySmokeBatch(tree, batch);
        tree.node(1).bounds = {0.0f, 0.0f, 100.0f, 40.0f};
        tree.node(2).bounds = {0.0f, 0.0f, 40.0f, 20.0f};
        tree.node(2).props["__arrangeClickableEnabled"] = "b:1";
        tree.node(2).props["__arrangeClickCallback"] = "h:321";

        arrange::core::HitTester hitTester;
        const auto clickable = hitTester.hitTestClickable(tree, 1, {8.0f, 8.0f});
        if (!clickable.hit || clickable.node != 2 || !clickable.clickable) return 197;

        arrange::core::PointerDispatcher pointer;
        const auto down = pointer.pointerDown(tree, 1, {8.0f, 8.0f}, 1);
        if (!down.consumed || down.callbackHandle != 321) return 198;
        const auto up = pointer.pointerUp(tree, 1, {8.0f, 8.0f}, 1);
        if (!up.consumed || !up.clickTriggered || up.callbackHandle != 321) return 199;
        if (tree.node(2).modifierDebugJson.find("clickable") != std::string::npos) return 200;

        tree.node(2).props["__arrangeClickableEnabled"] = "b:0";
        const auto disabled = hitTester.hitTestClickable(tree, 1, {8.0f, 8.0f});
        if (disabled.hit) return 201;
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
            std::ofstream app(okDir / "app.mjs", std::ios::binary);
            app << "export default {};\n";
        }
        {
            std::ofstream image(okDir / "logo.png", std::ios::binary);
            image << "not a real png but enough for resolver smoke\n";
        }
        {
            std::ofstream app(badDir / "app.mjs", std::ios::binary);
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
        if (ok.entryPath.filename() != "app.mjs") return 21;
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
        if (missing.error.find("app.mjs") == std::string::npos) return 23;
        const auto missingModel = arrange::makeErrorScreenModel(arrange::ErrorSource::AppPackage, missing.error, {}, missing.entryPath);
        if (missingModel.diagnosticText().find("app.mjs") == std::string::npos) return 32;
        if (!missingModel.retryAvailable) return 33;

        MockScriptHost editorHost;
        arrange::HeadlessArrangeEditor editor(appWithDist(okDir), editorHost);
        if (!editor.loadRelease()) return 45;
        if (editor.state() != arrange::HeadlessEditorState::Loaded) return 46;

        MockScriptHost missingEditorHost;
        arrange::HeadlessArrangeEditor missingEditor(appWithDist(missingDir), missingEditorHost);
        if (missingEditor.loadRelease()) return 47;
        if (missingEditor.state() != arrange::HeadlessEditorState::Error) return 48;
        if (missingEditor.error().diagnosticText().find("app.mjs") == std::string::npos) return 49;
        {
            std::ofstream app(missingDir / "app.mjs", std::ios::binary);
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
        if (arrange::devBundleHttpUrl("http://127.0.0.1:9178") != "http://127.0.0.1:9178/@arrange/app.mjs") return 93;

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
        return 0;
    }
}

int main(int argc, char** argv) {
    if (const auto bridge = verifyBridgeTreeAndLayout(argc, argv); bridge != 0) return bridge;
    if (const auto layout = verifyNativeArrangementAndWeightLayout(); layout != 0) return layout;
    if (const auto modifierOrder = verifyNativeModifierOrderFirstSlice(); modifierOrder != 0) return modifierOrder;
    if (const auto text = verifyNativeTextFirstSlice(); text != 0) return text;
    if (const auto insertChild = verifyRenderTreeInsertChildKeepsParentReferenceStable(); insertChild != 0) return insertChild;
    if (const auto cycles = verifyRenderTreeRejectsCyclesAndDeduplicatesChildren(); cycles != 0) return cycles;
    if (const auto dirty = verifyRenderTreeDirtyPropagationFirstSlice(); dirty != 0) return dirty;
    if (const auto dirtySnapshot = verifyRenderTreeDirtySnapshotAndClearFirstSlice(); dirtySnapshot != 0) return dirtySnapshot;
    if (const auto transformHit = verifyNativeGraphicsLayerTranslationHitTestFirstSlice(); transformHit != 0) return transformHit;
    if (const auto transformScaleRotationHit = verifyNativeGraphicsLayerScaleRotationHitTestFirstSlice(); transformScaleRotationHit != 0) return transformScaleRotationHit;
    if (const auto typedTransformHit = verifyNativeGraphicsLayerTransformTypedPropsWithoutDebugJson(); typedTransformHit != 0) return typedTransformHit;
    if (const auto nestedTransformClip = verifyNativeNestedTransformClipFirstSlice(); nestedTransformClip != 0) return nestedTransformClip;
    if (const auto zIndex = verifyNativeZIndexPaintAndHitTestFirstSlice(); zIndex != 0) return zIndex;
    if (const auto typedZIndex = verifyNativeZIndexTypedPropsWithoutDebugJson(); typedZIndex != 0) return typedZIndex;
    if (const auto input = verifyNativeInputFirstSlice(); input != 0) return input;
    if (const auto inputEditing = verifyNativeTextInputEditingFirstSlice(); inputEditing != 0) return inputEditing;
    if (const auto imageIcon = verifyNativeImageIconFirstSlice(); imageIcon != 0) return imageIcon;
    if (const auto scroll = verifyNativeScrollFirstSlice(); scroll != 0) return scroll;
    if (const auto horizontalScroll = verifyNativeHorizontalScrollFirstSlice(); horizontalScroll != 0) return horizontalScroll;
    if (const auto nestedScroll = verifyNativeNestedScrollConsumptionFirstSlice(); nestedScroll != 0) return nestedScroll;
    if (const auto typedScroll = verifyNativeScrollTypedPropsWithoutDebugJson(); typedScroll != 0) return typedScroll;
    if (const auto typedClick = verifyNativeClickableTypedPropsWithoutDebugJson(); typedClick != 0) return typedClick;
    if (const auto typedWeight = verifyNativeWeightTypedPropsWithoutDebugJson(); typedWeight != 0) return typedWeight;
    if (const auto typedAlignOffset = verifyNativeAlignAndOffsetTypedPropsWithoutDebugJson(); typedAlignOffset != 0) return typedAlignOffset;
    if (const auto typedModifierElements = verifyNativeTypedModifierElementsWithoutDebugJson(); typedModifierElements != 0) return typedModifierElements;
    if (const auto propValue = verifyPropValueContract(); propValue != 0) return propValue;
    if (const auto textLayout = verifyTextLayoutServiceContract(); textLayout != 0) return textLayout;
    if (const auto app = verifyAppResolverAndScriptLoader(); app != 0) return app;
    if (const auto devServer = verifyDevServerClientFirstSlice(); devServer != 0) return devServer;
    return 0;
}
