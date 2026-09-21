#include "TextFixtures.h"
#include <arrange/core/PointerInputProcessor.h>
#include <arrange/core/EventSlot.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/DiagnosticsScene.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/PainterResources.h>
#include <arrange/juce/JuceDrawOpsPainter.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/ScriptEventDispatcher.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <optional>
#include <string>

namespace {
    std::optional<arrange::core::EventSlotId> firstModifierEventSlot(const arrange::core::LayoutTree& tree, arrange::core::EventSlotKind kind) {
        for (const auto id : tree.nodeIds()) {
            if (kind == arrange::core::EventSlotKind::Click && test_support::textOf(tree.node(id)) != "撅了啊 0 次") continue;

            for (const auto& instance : tree.node(id).modifier.elements()) {
                arrange::core::EventSlotId slot;
                if (const auto* input = std::get_if<arrange::core::InputModifierSemantics>(&instance.descriptor.value)) slot = input->eventSlot;
                if (const auto* input = std::get_if<arrange::core::LayoutModifierSemantics>(&instance.descriptor.value)) slot = input->eventSlot;
                if (slot.kind == kind && slot.valid()) return slot;
            }
        }
        return std::nullopt;
    }

    bool treeContainsText(const arrange::core::LayoutTree& tree, const std::string& text) {
        for (const auto id : tree.nodeIds()) {
            if (test_support::textOf(tree.node(id)) == text) return true;
        }
        return false;
    }

    std::optional<arrange::core::NodeId> firstInputNodeWithEventSlot(const arrange::core::LayoutTree& tree, arrange::core::EventSlotKind kind) {
        for (const auto id : tree.nodeIds()) {
            if (test_support::event(tree.node(id), kind).valid()) return id;
        }
        return std::nullopt;
    }

    arrange::core::DrawOp painterOp(std::shared_ptr<const arrange::core::PainterContent> content, bool tinted = false) {
        arrange::core::DrawOp op;
        op.type = arrange::core::DrawOpType::DrawPainter;
        op.painter = {1, 1, 1, std::move(content)};
        op.rect = {0, 0, 8, 8};
        op.hasTint = tinted;
        op.color = 0xffe8eaed;
        return op;
    }

    bool verifyScriptEventDispatcherRequiresTypedSlotContract() {
        arrange::core::LayoutNode inputNode;
        inputNode.id = 42;
        inputNode.type = arrange::core::NodeType::Layout;
        if (test_support::event(inputNode, arrange::core::EventSlotKind::InputSubmit).valid()) return false;
        auto field = test_support::textField("测试");
        field.onSubmit = arrange::core::makeEventSlotId(42, arrange::core::EventSlotKind::InputSubmit);
        inputNode.modifier.reconcile({{field, {}}});
        const auto slot = test_support::event(inputNode, arrange::core::EventSlotKind::InputSubmit);
        return slot.valid() && slot.node == 42 && !test_support::event(inputNode, arrange::core::EventSlotKind::InputUpdate).valid();
    }
}  // namespace

int main(int argc, char** argv) {
#if !ARRANGE_WITH_QUICKJS_NG || !ARRANGE_JUCE_WITH_JUCE
    (void)argc;
    (void)argv;
    std::cerr << "Arrange JUCE 运行时烟雾测试需要 QuickJS 和 JUCE\n";
    return 2;
#else
    ::juce::ScopedJuceInitialiser_GUI juceInitialiser;

    if (!verifyScriptEventDispatcherRequiresTypedSlotContract()) {
        std::cerr << "脚本事件分发器生成了虚假事件槽，或未能读取类型化事件槽\n";
        return 18;
    }

    const auto entry = argc > 1 ? std::filesystem::path(argv[1]) : std::filesystem::absolute("build/demo-ui-dist/app.js");

    auto host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
    host->setPainterLoader(arrange::juce::packagePainterLoader(entry.parent_path()));
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
        std::cerr << "运行时初始帧失败：" << firstFrame.error << "\n";
        return 7;
    }

    const auto clickSlot = firstModifierEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::Click);
    if (!clickSlot || !clickSlot->valid()) return 5;
    const auto scrollSlot = firstModifierEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::VerticalScroll);
    if (!scrollSlot || !scrollSlot->valid()) {
        std::cerr << "实际布局节点中未找到 VerticalScroll 事件槽\n";
        return 6;
    }

    arrange::core::PointerInputProcessor pointer;
    for (int index = 0; index < 13; ++index) {
        const auto& snapshot = *runtime.publishedFrame().content.hitTest;
        auto region = std::find_if(snapshot.regions.begin(), snapshot.regions.end(), [&](const auto& candidate) { return candidate.target.eventSlot == *clickSlot; });
        if (region == snapshot.regions.end()) return 20;
        const arrange::core::Point point{region->bounds.x + region->bounds.width / 2, region->bounds.y + region->bounds.height / 2};
        pointer.pointerDown(snapshot, point);
        const auto clicked = pointer.pointerUp(snapshot, point);
        if (!clicked.clickTriggered || clicked.eventSlot != *clickSlot) return 21;
        runtime.enqueueEvent(clicked.eventSlot);
        const auto frame = runtime.pumpFrame(1, constraints, 16.0 * static_cast<double>(index + 1));
        if (!frame.ok) {
            std::cerr << "事件帧失败，索引为 " << index << ": " << frame.error << "\n";
            return 8;
        }
    }

    // 动画与事件可在已有候选等待 apply 时失效，回执后的候选由下一次宿主帧消费
    if (runtime.hasPendingTransactions() || runtime.hasPendingIntents()) {
        if (!runtime.hasPendingFrameWork()) return 22;
        const auto frame = runtime.pumpFrame(1, constraints, 224.0);
        if (!frame.ok || !frame.pipelineRan) return 23;
    }
    if (!treeContainsText(runtime.scene().tree(), "撅了啊 13 次")) {
        std::cerr << "计数器文本未达到预期的“撅了啊 13 次”\n";
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
        std::cerr << "滚动快照帧失败：" << scrollFrame.error << "\n";
        return 10;
    }
    if (runtime.hasPendingTransactions() || runtime.hasPendingIntents()) {
        const auto applied = runtime.pumpFrame(1, constraints, 256.0);
        if (!applied.ok || !applied.pipelineRan) return 24;
    }

    if (arrange::core::ScrollDispatcher::verticalScrollValue(runtime.scene().tree().node(scrollSlot->node)) != 17.0f) {
        std::cerr << "滚动值未通过编译后的 Modifier 同步\n";
        return 11;
    }

    const auto inputNode = firstInputNodeWithEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::InputSubmit);
    if (!inputNode) {
        std::cerr << "未找到输入提交节点\n";
        return 12;
    }
    const auto inputSubmitSlot = test_support::event(runtime.scene().tree().node(*inputNode), arrange::core::EventSlotKind::InputSubmit);
    if (!inputSubmitSlot.valid()) {
        std::cerr << "节点上未找到输入提交事件槽\n";
        return 13;
    }
    runtime.enqueueStringEvent(inputSubmitSlot, "Runtime Smoke");
    const auto inputFrame = runtime.pumpFrame(1, constraints, 272.0);
    if (!inputFrame.ok) {
        std::cerr << "输入提交帧失败：" << inputFrame.error << "\n";
        return 14;
    }
    if (runtime.hasPendingTransactions() || runtime.hasPendingIntents()) {
        const auto applied = runtime.pumpFrame(1, constraints, 288.0);
        if (!applied.ok || !applied.pipelineRan) return 25;
    }

    if (!treeContainsText(runtime.scene().tree(), "提交啊一个：Runtime Smoke")) {
        std::cerr << "输入提交文本未通过运行时事件队列同步\n";
        return 15;
    }

    arrange::juce::DiagnosticsScene diagnosticsScene;
    const auto errorOps = diagnosticsScene.buildErrorScreen({0, 0, 320, 180}, arrange::makeErrorScreenModel(arrange::ErrorSource::ScriptRuntime, "diagnostics scene smoke", "details"), true);
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
    diagnosticsConfig.logLevel = arrange::juce::LogLevel::Warn;
    DiagnosticsState.configure(std::move(diagnosticsConfig));
    arrange::juce::DiagnosticEventInput debugEvent;
    debugEvent.level = arrange::juce::LogLevel::Debug;
    debugEvent.category = arrange::juce::DiagnosticCategory::RuntimeScript;
    debugEvent.code = "debug.filtered";
    debugEvent.message = "debug event still enters recent ring";
    if (DiagnosticsState.emit(std::move(debugEvent))) return 33;
    if (DiagnosticsState.recentEvents().empty() || DiagnosticsState.recentEvents().back().code != "debug.filtered") return 34;
    DiagnosticsState.setCategoryEnabled(arrange::juce::DiagnosticCategory::RuntimeScript, false);
    if (DiagnosticsState.categoryEnabled(arrange::juce::DiagnosticCategory::RuntimeScript)) return 35;
    DiagnosticsState.setToastsEnabled(false);
    arrange::juce::DiagnosticEventInput toastDisabledEvent;
    toastDisabledEvent.level = arrange::juce::LogLevel::Error;
    toastDisabledEvent.category = arrange::juce::DiagnosticCategory::Diagnostics;
    toastDisabledEvent.code = "toast.disabled";
    toastDisabledEvent.message = "toast disabled still logged";
    toastDisabledEvent.toast = true;
    if (DiagnosticsState.emit(std::move(toastDisabledEvent))) return 36;
    if (DiagnosticsState.recentEvents().back().code != "toast.disabled") return 37;
    if (DiagnosticsState.hasActiveToasts()) return 38;
    DiagnosticsState.setError(arrange::makeErrorScreenModel(arrange::ErrorSource::ScriptRuntime, "prepared diagnostics frame smoke", "details"));
    if (!DiagnosticsState.prepareFrame({0, 0, 320, 180}, true, badge)) return 26;
    if (DiagnosticsState.errorOpsSnapshot().empty() || DiagnosticsState.badgeOpsSnapshot().empty()) return 27;
    if (DiagnosticsState.prepareFrame({0, 0, 320, 180}, true, badge)) return 28;
    DiagnosticsState.clearError();
    if (!DiagnosticsState.prepareFrame({0, 0, 320, 180}, true, badge)) return 29;
    if (!DiagnosticsState.errorOpsSnapshot().empty()) return 30;

    const auto resourceDir = std::filesystem::temp_directory_path() / "arrange-resource-prepare-smoke";
    std::filesystem::create_directories(resourceDir);
    const auto acquire = arrange::juce::packagePainterLoader(resourceDir);
    const auto missing = acquire("missing.png").get();
    if (missing.error.empty() || missing.content) return 21;
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
    const auto prepared = acquire("valid.png").get();
    if (!prepared.error.empty() || !prepared.content || prepared.content->intrinsicSize != arrange::core::Size{2, 2}) return 24;
    const std::vector validOps{painterOp(prepared.content)};
    {
        ::juce::Graphics graphics(canvas);
        if (painter.paint(graphics, validOps).error) return 25;
    }
    if (canvas.getPixelAt(4, 4) != ::juce::Colours::red) {
        std::cerr << "Painter 绘制像素不匹配：" << canvas.getPixelAt(4, 4).toString() << "，跳过操作：" << painter.counters().opsSkipped << '\n';
        return 25;
    }

    const auto validSvg = resourceDir / "play.svg";
    {
        std::ofstream svg(validSvg);
        svg << "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#000000\" d=\"M8 5v14l11-7z\"/></svg>";
    }
    const auto iconPrepared = acquire("play.svg").get();
    if (!iconPrepared.error.empty() || !iconPrepared.content || iconPrepared.content->intrinsicSize != arrange::core::Size{24, 24}) return 31;
    const std::vector iconOps{painterOp(iconPrepared.content, true)};
    ::juce::Graphics graphics(canvas);
    const auto iconPaint = painter.paint(graphics, iconOps);
    if (iconPaint.error) return 32;

    auto raster = std::make_shared<arrange::juce::JucePainterContent>();
    raster->image = ::juce::Image(::juce::Image::ARGB, 4, 2, true, ::juce::SoftwareImageType{});
    raster->image.clear(raster->image.getBounds(), ::juce::Colours::red);
    auto vector = std::make_shared<arrange::juce::JucePainterContent>();
    auto rectangle = ::juce::XmlDocument::parse("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"4\" height=\"2\" viewBox=\"0 0 4 2\"><rect width=\"4\" height=\"2\" fill=\"red\"/></svg>");
    vector->vector = ::juce::Drawable::createFromSVG(*rectangle);
    for (const auto extent : {2.0f, 8.0f}) {
        for (const auto* scale : {"Fit", "Crop", "FillBounds", "FillWidth", "FillHeight", "Inside", "None"}) {
            for (const auto* alignment : {"TopStart", "Center", "BottomEnd"}) {
                for (const auto tinted : {false, true}) {
                    const auto render = [&](std::shared_ptr<const arrange::core::PainterContent> content) {
                        ::juce::Image output(::juce::Image::ARGB, 16, 16, true, ::juce::SoftwareImageType{});
                        auto op = painterOp(std::move(content), tinted);
                        op.rect = {2, 2, extent, extent};
                        op.contentScale = scale;
                        op.alignment = alignment;
                        {
                            ::juce::Graphics target(output);
                            painter.paint(target, std::vector{op});
                        }
                        return output;
                    };
                    const auto bitmap = render(raster);
                    const auto svg = render(vector);
                    for (int y = 0; y < 16; ++y)
                        for (int x = 0; x < 16; ++x) {
                            const auto a = bitmap.getPixelAt(x, y), b = svg.getPixelAt(x, y);
                            // 位图插值与矢量覆盖率在半像素边界最多相差一级量化值
                            if (std::abs(int(a.getAlpha()) - int(b.getAlpha())) <= 1 && std::abs(int(a.getRed()) - int(b.getRed())) <= 1 && std::abs(int(a.getGreen()) - int(b.getGreen())) <= 1 && std::abs(int(a.getBlue()) - int(b.getBlue())) <= 1) continue;
                            std::cerr << "Painter 位图与矢量缩放不一致：" << scale << '/' << alignment << "，着色=" << tinted << "，像素=" << x << ',' << y << "，位图=" << bitmap.getPixelAt(x, y).toString() << "，矢量=" << svg.getPixelAt(x, y).toString() << '\n';
                            return 39;
                        }
                }
            }
        }
    }

    std::cout << "ArrangeRuntime 计数、滚动与输入事件队列烟雾测试通过\n";
    return 0;
#endif
}
