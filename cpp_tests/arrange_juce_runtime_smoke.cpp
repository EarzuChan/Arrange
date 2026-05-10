#include <arrange/core/EventSlot.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/DiagnosticsScene.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/ImageResourceCache.h>
#include <arrange/juce/JuceDrawOpsPainter.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/ScriptEventBridge.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <filesystem>
#include <iostream>
#include <memory>
#include <optional>
#include <string>

namespace {
    std::optional<arrange::core::EventSlotId> firstCompiledModifierEventSlot(
        const arrange::core::LayoutTree& tree,
        arrange::core::EventSlotKind kind) {
        for (arrange::core::NodeId id = 1; id < 512; ++id) {
            if (!tree.contains(id)) continue;
            const auto& modifier = tree.node(id).modifier;
            if (kind == arrange::core::EventSlotKind::Click && modifier.input.clickEventSlot.valid()) {
                return modifier.input.clickEventSlot;
            }
            if (kind == arrange::core::EventSlotKind::VerticalScroll && modifier.scroll.verticalEventSlot.valid()) {
                return modifier.scroll.verticalEventSlot;
            }
            if (kind == arrange::core::EventSlotKind::HorizontalScroll && modifier.scroll.horizontalEventSlot.valid()) {
                return modifier.scroll.horizontalEventSlot;
            }
        }
        return std::nullopt;
    }

    bool treeContainsText(const arrange::core::LayoutTree& tree, const std::string& text) {
        for (arrange::core::NodeId id = 1; id < 512; ++id) {
            if (!tree.contains(id)) continue;
            if (tree.node(id).text == text) return true;
        }
        return false;
    }

    std::optional<arrange::core::NodeId> firstNodeWithProp(
        const arrange::core::LayoutTree& tree,
        std::initializer_list<const char*> keys) {
        for (arrange::core::NodeId id = 1; id < 512; ++id) {
            if (!tree.contains(id)) continue;
            if (tree.node(id).type != arrange::core::NodeType::Input) continue;
            const auto& props = tree.node(id).props;
            for (const auto* key : keys) {
                if (props.find(key) != props.end()) return id;
            }
        }
        return std::nullopt;
    }

    arrange::core::DrawOp imageOp(std::string resource) {
        arrange::core::DrawOp op;
        op.type = arrange::core::DrawOpType::DrawImage;
        op.resource = std::move(resource);
        op.rect = {0.0f, 0.0f, 8.0f, 8.0f};
        op.color = 0xffffffff;
        return op;
    }

    bool verifyScriptEventBridgeRequiresRealPropContract() {
        arrange::core::ArrangeNode inputNode;
        inputNode.id = 42;
        inputNode.type = arrange::core::NodeType::Input;

        const auto missingSubmit = arrange::juce::ScriptEventBridge::eventSlotFromAnyProp(
            inputNode,
            arrange::core::EventSlotKind::InputSubmit,
            "onSubmit",
            nullptr);
        if (missingSubmit.valid()) return false;

        inputNode.props["__arrangeEventSlot.onSubmit"] = "s:42:inputSubmit:inputSubmit";
        const auto generatedSubmit = arrange::juce::ScriptEventBridge::eventSlotFromAnyProp(
            inputNode,
            arrange::core::EventSlotKind::InputSubmit,
            "onSubmit",
            nullptr);
        if (!generatedSubmit.valid() || generatedSubmit.node != 42 || generatedSubmit.kind != arrange::core::EventSlotKind::InputSubmit) return false;

        inputNode.props.erase("__arrangeEventSlot.onSubmit");
        inputNode.props["onUpdate:model-value"] = "s:42:inputUpdate:inputUpdate";
        const auto kebabUpdate = arrange::juce::ScriptEventBridge::eventSlotFromAnyProp(
            inputNode,
            arrange::core::EventSlotKind::InputUpdate,
            "onUpdate:modelValue",
            "onUpdate:model-value");
        return kebabUpdate.valid() && kebabUpdate.node == 42 && kebabUpdate.kind == arrange::core::EventSlotKind::InputUpdate;
    }
} // namespace

int main(int argc, char** argv) {
#if !ARRANGE_WITH_QUICKJS_NG || !ARRANGE_JUCE_WITH_JUCE
    (void)argc;
    (void)argv;
    std::cerr << "Arrange JUCE runtime smoke requires QuickJS and JUCE\n";
    return 2;
#else
    ::juce::ScopedJuceInitialiser_GUI juceInitialiser;

    if (!verifyScriptEventBridgeRequiresRealPropContract()) {
        std::cerr << "script event bridge generated a fake slot or failed to read a real prop slot\n";
        return 18;
    }

    const auto entry = argc > 1
        ? std::filesystem::path(argv[1])
        : std::filesystem::absolute("demo/plugin-src/ui/app.js");

    auto host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
    arrange::quickjs::AppScriptLoader loader(*host);
    const auto loaded = loader.loadEntry(entry);
    if (!loaded.ok) {
        std::cerr << loaded.error << "\n";
        return 3;
    }

    auto initial = host->takePendingTransaction();
    if (!initial || !initial->hasTreeMutations()) return 4;

    arrange::juce::JuceTextMeasurer textMeasurer;
    arrange::core::TextLayoutService textLayoutService(textMeasurer);
    arrange::juce::ArrangeRuntime runtime{
        arrange::core::SceneFramePipeline(arrange::core::LayoutEngine(textLayoutService)),
    };
    runtime.setScriptHost(std::move(host));
    runtime.enqueue(std::move(*initial));

    const arrange::core::Constraints constraints{0.0f, 520.0f, 0.0f, 380.0f};
    const auto firstFrame = runtime.pumpFrame(1, constraints, 0.0);
    if (!firstFrame.ok || !firstFrame.pipelineRan || !runtime.scene().contains(1)) {
        std::cerr << "initial runtime frame failed: " << firstFrame.error << "\n";
        return 7;
    }

    const auto clickSlot = firstCompiledModifierEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::Click);
    if (!clickSlot || !clickSlot->valid()) return 5;
    const auto scrollSlot = firstCompiledModifierEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::VerticalScroll);
    if (!scrollSlot || !scrollSlot->valid()) return 6;

    for (int index = 0; index < 13; ++index) {
        runtime.enqueueEvent(*clickSlot);
        const auto frame = runtime.pumpFrame(1, constraints, 16.0 * static_cast<double>(index + 1));
        if (!frame.ok) {
            std::cerr << "event frame failed at " << index << ": " << frame.error << "\n";
            return 8;
        }
    }

    if (!treeContainsText(runtime.scene().tree(), "Clicks: 13")) {
        std::cerr << "counter text did not reach Clicks: 13\n";
        return 9;
    }

    arrange::core::ScrollResult scroll;
    scroll.consumed = true;
    scroll.target = scrollSlot->node;
    scroll.value = 17.0f;
    scroll.maxValue = 42.0f;
    scroll.viewportSize = 58.0f;
    scroll.contentSize = 100.0f;
    scroll.eventSlot = *scrollSlot;
    runtime.enqueueScrollSnapshotEvent(*scrollSlot, scroll);
    const auto scrollFrame = runtime.pumpFrame(1, constraints, 240.0);
    if (!scrollFrame.ok) {
        std::cerr << "scroll snapshot frame failed: " << scrollFrame.error << "\n";
        return 10;
    }

    if (runtime.scene().tree().node(scrollSlot->node).modifier.scroll.verticalValue != 17.0f) {
        std::cerr << "scroll value did not sync through compiled modifier\n";
        return 11;
    }

    const auto inputNode = firstNodeWithProp(runtime.scene().tree(), {"__arrangeEventSlot.onSubmit", "onSubmit"});
    if (!inputNode) {
        std::cerr << "input submit node not found\n";
        return 12;
    }
    const auto inputSubmitSlot = arrange::juce::ScriptEventBridge::eventSlotFromAnyProp(
        runtime.scene().tree().node(*inputNode),
        arrange::core::EventSlotKind::InputSubmit,
        "onSubmit",
        nullptr);
    if (!inputSubmitSlot.valid()) {
        std::cerr << "input submit slot not found on node\n";
        return 13;
    }
    runtime.enqueueStringEvent(inputSubmitSlot, "Runtime Smoke");
    const auto inputFrame = runtime.pumpFrame(1, constraints, 256.0);
    if (!inputFrame.ok) {
        std::cerr << "input submit frame failed: " << inputFrame.error << "\n";
        return 14;
    }

    if (!treeContainsText(runtime.scene().tree(), "Submitted: Runtime Smoke")) {
        std::cerr << "input submit text did not sync through runtime event queue\n";
        return 15;
    }

    arrange::juce::DiagnosticsScene diagnosticsScene;
    const auto errorOps = diagnosticsScene.buildErrorScreen(
        {0, 0, 320, 180},
        arrange::makeErrorScreenModel(arrange::ErrorSource::ScriptRuntime, "diagnostics scene smoke", "details"),
        true);
    if (errorOps.size() < 3 || errorOps.front().type != arrange::core::DrawOpType::FillRect) return 16;
    bool sawErrorText = false;
    for (const auto& op : errorOps) {
        if (op.type == arrange::core::DrawOpType::DrawText && op.text.find("diagnostics scene smoke") != std::string::npos) sawErrorText = true;
    }
    if (!sawErrorText) return 17;

    arrange::juce::DiagnosticsBadgeModel badge;
    badge.text = "Debug dist";
    const auto badgeOps = diagnosticsScene.buildBadge({0, 0, 320, 180}, badge, arrange::juce::DiagnosticVisibility::Always);
    if (badgeOps.size() < 4 || badgeOps.front().type != arrange::core::DrawOpType::FillRect) return 18;
    if (!diagnosticsScene.buildBadge({0, 0, 320, 180}, badge, arrange::juce::DiagnosticVisibility::Hidden).empty()) return 19;

    const std::vector<arrange::juce::DiagnosticsToastModel> toasts{{arrange::juce::LogLevel::Info, "Toast", "DiagnosticsScene"}};
    const auto toastOps = diagnosticsScene.buildToasts({0, 0, 320, 180}, toasts, arrange::juce::DiagnosticVisibility::Always);
    if (toastOps.size() < 4) return 20;

    arrange::juce::DiagnosticsState DiagnosticsState;
    arrange::juce::DiagnosticsConfig diagnosticsConfig;
    diagnosticsConfig.badge = arrange::juce::DiagnosticVisibility::Always;
    diagnosticsConfig.toasts = arrange::juce::DiagnosticVisibility::Always;
    DiagnosticsState.configure(std::move(diagnosticsConfig));
    DiagnosticsState.setError(arrange::makeErrorScreenModel(
        arrange::ErrorSource::ScriptRuntime,
        "prepared diagnostics frame smoke",
        "details"));
    if (!DiagnosticsState.prepareFrame({0, 0, 320, 180}, true, badge)) return 26;
    if (DiagnosticsState.errorOpsSnapshot().empty() ||
        DiagnosticsState.badgeOpsSnapshot().empty()) return 27;
    if (DiagnosticsState.prepareFrame({0, 0, 320, 180}, true, badge)) return 28;
    DiagnosticsState.clearError();
    if (!DiagnosticsState.prepareFrame({0, 0, 320, 180}, true, badge)) return 29;
    if (!DiagnosticsState.errorOpsSnapshot().empty()) return 30;

    const auto resourceDir = std::filesystem::temp_directory_path() / "arrange-resource-prepare-smoke";
    std::filesystem::create_directories(resourceDir);
    arrange::juce::ImageResourceCache imageCache;
    imageCache.setPackageDir(resourceDir);
    const std::vector missingOps{imageOp("missing.png")};
    const auto missing = imageCache.prepare(missingOps);
    if (!missing.error || missing.error->source != arrange::ErrorSource::Resource) return 21;

    imageCache.clear();
    const auto validPath = resourceDir / "valid.png";
    {
        ::juce::Image validImage(::juce::Image::RGB, 2, 2, true);
        validImage.clear(validImage.getBounds(), ::juce::Colours::red);
        ::juce::PNGImageFormat png;
        ::juce::FileOutputStream out(::juce::File(validPath.string()));
        if (!out.openedOk() || !png.writeImageToStream(validImage, out)) return 22;
    }

    arrange::juce::JuceDrawOpsPainter painter;
    ::juce::Image canvas(::juce::Image::RGB, 16, 16, true);
    ::juce::Graphics graphics(canvas);
    const std::vector validOps{imageOp("valid.png")};
    const auto paintWithoutPrepare = painter.paint(graphics, validOps, imageCache);
    if (paintWithoutPrepare.error || imageCache.find("valid.png").isValid() || imageCache.lastError()) return 23;

    const auto prepared = imageCache.prepare(validOps);
    if (prepared.error || !prepared.changed || !imageCache.find("valid.png").isValid()) return 24;
    const auto paintAfterPrepare = painter.paint(graphics, validOps, imageCache);
    if (paintAfterPrepare.error) return 25;

    std::cout << "ArrangeRuntime queued counter/scroll/input smoke passed\n";
    return 0;
#endif
}
