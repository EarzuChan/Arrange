#include "TextFixtures.h"
#include "JuceTestApplication.h"
#include <arrange/core/PointerGesture.h>
#include <arrange/core/EventSlot.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/Log.h>
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
#include <sstream>
#include <memory>
#include <optional>
#include <string>

namespace {
    std::optional<arrange::core::EventSlotId> modifierEventSlot(const arrange::core::LayoutNode& node, arrange::core::EventSlotKind kind) {
        for (const auto& instance : node.modifier.elements()) {
            arrange::core::EventSlotId slot;
            if (const auto* input = std::get_if<arrange::core::InputModifierSemantics>(&instance.descriptor.value)) slot = input->eventSlot;
            if (const auto* input = std::get_if<arrange::core::LayoutModifierSemantics>(&instance.descriptor.value)) slot = input->eventSlot;
            if (slot.kind == kind && slot.valid()) return slot;
        }
        return std::nullopt;
    }

    std::optional<arrange::core::EventSlotId> firstModifierEventSlot(const arrange::core::LayoutTree& tree, arrange::core::EventSlotKind kind) {
        for (const auto id : tree.nodeIds())
            if (const auto slot = modifierEventSlot(tree.node(id), kind)) return slot;
        return std::nullopt;
    }

    // 从给定文本的节点向上找最近的可点击节点，覆盖点击修饰挂在容器上的卡片与按钮
    std::optional<arrange::core::EventSlotId> clickSlotForText(const arrange::core::LayoutTree& tree, const std::string& text) {
        for (const auto id : tree.nodeIds()) {
            if (test_support::textOf(tree.node(id)) != text) continue;
            for (std::optional<arrange::core::NodeId> current = id; current; current = tree.parentOf(*current))
                if (const auto slot = modifierEventSlot(tree.node(*current), arrange::core::EventSlotKind::Click)) return slot;
        }
        return std::nullopt;
    }

    // 无文字的图标按钮按语义标签查找点击槽
    std::optional<arrange::core::EventSlotId> clickSlotForLabel(const arrange::core::LayoutTree& tree, const std::string& label) {
        for (const auto id : tree.nodeIds())
            for (const auto& instance : tree.node(id).modifier.elements())
                if (const auto* semantics = std::get_if<arrange::core::SemanticsModifier>(&instance.descriptor.value); semantics && semantics->label == label) return modifierEventSlot(tree.node(id), arrange::core::EventSlotKind::Click);
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
}

int runSmoke() {
    {
        std::ostringstream captured;
        auto* previous = std::clog.rdbuf(captured.rdbuf());
        arrange::Log::i("RuntimeSmoke", "日志正文", "多个参数");
        arrange::Log::w("RuntimeSmoke", "换行", "已清理\n后续内容");
        std::clog.rdbuf(previous);
        const auto output = captured.str();
        if (output.find(" - A - RuntimeSmoke \x1b[32m[I]\x1b[0m > \x1b[32m日志正文 多个参数\x1b[0m\n") == std::string::npos) return 39;
        if (output.find(" - A - RuntimeSmoke \x1b[33m[W]\x1b[0m > \x1b[33m换行 已清理 后续内容\x1b[0m\n") == std::string::npos) return 40;
    }
#if !ARRANGE_WITH_QUICKJS_NG || !ARRANGE_JUCE_WITH_JUCE
    std::cerr << "Arrange JUCE 运行时烟雾测试需要 QuickJS 和 JUCE\n";
    return 2;
#else
    ::juce::ScopedJuceInitialiser_GUI juceInitialiser;

    if (!verifyScriptEventDispatcherRequiresTypedSlotContract()) {
        std::cerr << "脚本事件分发器生成了虚假事件槽，或未能读取类型化事件槽\n";
        return 18;
    }

    const auto parameters = ::juce::JUCEApplication::getCommandLineParameterArray();
    if (parameters.isEmpty()) return 1;
    const auto packagePath = parameters[0].toStdString();
    const auto entry = std::filesystem::absolute(std::filesystem::path(std::u8string(packagePath.begin(), packagePath.end())));

    auto host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
    host->setPainterLoader(arrange::juce::packagePainterLoader(entry.parent_path()));
    arrange::quickjs::AppScriptLoader loader(*host);
    const auto loaded = loader.loadEntry(entry);
    if (!loaded.ok) {
        std::cerr << loaded.error << "\n";
        return 3;
    }

    auto initial = host->takePendingTransaction();
    if (initial) return 4;

    arrange::juce::JuceTextMeasurer textMeasurer;
    arrange::core::TextLayoutService textLayoutService(textMeasurer);
    arrange::juce::ArrangeRuntime runtime{
        arrange::core::SceneFramePipeline(arrange::core::LayoutEngine(textLayoutService)),
    };
    runtime.setScriptHost(std::move(host));
    if (initial) runtime.enqueue(std::move(*initial));

    // 计数器在页首无需滚动即可命中；视口低于页面内容，整页滚动才有可写的范围
    const arrange::core::Constraints constraints{0.0f, 960.0f, 0.0f, 700.0f};
    const auto firstFrame = runtime.pumpFrame(1, constraints, 0.0);
    if (!firstFrame.ok || !firstFrame.pipelineRan || !runtime.scene().contains(1)) {
        std::cerr << "运行时初始帧失败：" << firstFrame.error << "\n";
        return 7;
    }

    // 经命中测试点在槽位区域中心，按真实指针手势派发点击
    arrange::core::PointerGestureSession pointer;
    auto frameTime = 0.0;
    const auto click = [&](arrange::core::EventSlotId slot) -> int {
        const auto& snapshot = *runtime.publishedFrame().content.hitTest;
        auto region = std::find_if(snapshot.regions.begin(), snapshot.regions.end(), [&](const auto& candidate) { return candidate.target.eventSlot == slot; });
        if (region == snapshot.regions.end()) return 20;
        const arrange::core::Point point{region->bounds.x + region->bounds.width / 2, region->bounds.y + region->bounds.height / 2};
        arrange::core::PointerGestureOutput down;
        arrange::core::PointerGestureOutput clicked;
        pointer.primaryDown(runtime.scene().tree(), snapshot, {point}, 1, down);
        pointer.primaryUp(runtime.scene().tree(), snapshot, {point}, clicked);
        const auto event = std::find_if(clicked.events.begin(), clicked.events.end(), [&](const auto& candidate) { return candidate.slot == slot; });
        if (event == clicked.events.end()) return 21;
        runtime.enqueueEvent(event->slot);
        frameTime += 16.0;
        const auto frame = runtime.pumpFrame(1, constraints, frameTime);
        if (!frame.ok) {
            std::cerr << "点击事件帧失败：" << frame.error << "\n";
            return 8;
        }
        return 0;
    };
    const auto settle = [&]() -> bool {
        if (!runtime.hasPendingTransactions() && !runtime.hasPendingIntents()) return true;
        frameTime += 16.0;
        const auto frame = runtime.pumpFrame(1, constraints, frameTime);
        return frame.ok && frame.pipelineRan;
    };

    // 主页滚动位置由 App 持有：先滚到中段，进出主题页后应回到原处
    const auto homeScrollSlot = firstModifierEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::VerticalScroll);
    if (!homeScrollSlot) return 41;
    const auto homeScrollValue = [&]() -> float {
        const auto slot = firstModifierEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::VerticalScroll);
        return slot ? arrange::core::ScrollDispatcher::verticalScrollValue(runtime.scene().tree().node(slot->node)) : -1.0f;
    };
    {
        arrange::core::ScrollResult home;
        home.consumed = true;
        home.target = homeScrollSlot->node;
        home.value = 150.0f;
        home.eventSlot = *homeScrollSlot;
        runtime.enqueueScrollSnapshotEvent(*homeScrollSlot, home);
        if (!runtime.pumpFrame(1, constraints, frameTime += 16.0).ok || !settle()) return 42;
        if (homeScrollValue() != 150.0f) {
            std::cerr << "主页滚动值未写入：" << homeScrollValue() << "\n";
            return 43;
        }
    }

    const auto openSlot = clickSlotForText(runtime.scene().tree(), "组合与状态");
    if (!openSlot) {
        std::cerr << "Demo 首页未找到「组合与状态」展项卡的点击槽\n";
        return 5;
    }
    if (const auto failed = click(*openSlot)) return failed;
    if (!settle()) return 23;

    const auto clickSlot = clickSlotForText(runtime.scene().tree(), "撅了啊 0 次");
    if (!clickSlot) {
        std::cerr << "「组合与状态」页未找到计数器的点击槽\n";
        return 5;
    }
    const auto scrollSlot = firstModifierEventSlot(runtime.scene().tree(), arrange::core::EventSlotKind::VerticalScroll);
    if (!scrollSlot || !scrollSlot->valid()) {
        std::cerr << "实际布局节点中未找到 VerticalScroll 事件槽\n";
        return 6;
    }

    for (int index = 0; index < 13; ++index)
        if (const auto failed = click(*clickSlot)) return failed;

    // 动画与事件可在已有候选等待 apply 时失效，回执后的候选由下一次宿主帧消费
    if (runtime.hasPendingTransactions() || runtime.hasPendingIntents()) {
        if (!runtime.hasPendingFrameWork()) return 22;
        const auto frame = runtime.pumpFrame(1, constraints, frameTime += 16.0);
        if (!frame.ok || !frame.pipelineRan) return 23;
    }
    if (!treeContainsText(runtime.scene().tree(), "撅了啊 13 次")) {
        std::cerr << "计数器文本未达到预期的「撅了啊 13 次」\n";
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
    const auto scrollFrame = runtime.pumpFrame(1, constraints, frameTime += 16.0);
    if (!scrollFrame.ok) {
        std::cerr << "滚动快照帧失败：" << scrollFrame.error << "\n";
        return 10;
    }
    if (runtime.hasPendingTransactions() || runtime.hasPendingIntents()) {
        const auto applied = runtime.pumpFrame(1, constraints, frameTime += 16.0);
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
    const auto inputFrame = runtime.pumpFrame(1, constraints, frameTime += 16.0);
    if (!inputFrame.ok) {
        std::cerr << "输入提交帧失败：" << inputFrame.error << "\n";
        return 14;
    }
    if (runtime.hasPendingTransactions() || runtime.hasPendingIntents()) {
        const auto applied = runtime.pumpFrame(1, constraints, frameTime += 16.0);
        if (!applied.ok || !applied.pipelineRan) return 25;
    }

    if (!treeContainsText(runtime.scene().tree(), "提交：Runtime Smoke")) {
        std::cerr << "输入提交文本未通过运行时事件队列同步\n";
        return 15;
    }

    const auto backSlot = clickSlotForLabel(runtime.scene().tree(), "返回");
    if (!backSlot) {
        std::cerr << "主题页未找到「返回」按钮的点击槽\n";
        return 44;
    }
    if (const auto failed = click(*backSlot)) return failed;
    if (!settle()) return 45;
    if (!treeContainsText(runtime.scene().tree(), "组合与状态")) return 46;
    if (homeScrollValue() != 150.0f) {
        std::cerr << "返回主页后滚动位置没有恢复：" << homeScrollValue() << "\n";
        return 47;
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
    DiagnosticsState.configure(std::move(diagnosticsConfig));
    arrange::Log::d("RuntimeSmoke", "调试日志输出");
    DiagnosticsState.setToastsEnabled(false);
    arrange::juce::DiagnosticsToast::e(DiagnosticsState, "RuntimeSmoke", "测试气泡", "气泡关闭仍应日志输出");
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
    const auto validPath = resourceDir / "valid.png";
    {
        ::juce::Image validImage(::juce::Image::RGB, 2, 2, true);
        validImage.clear(validImage.getBounds(), ::juce::Colours::red);
        ::juce::PNGImageFormat png;
        ::juce::FileOutputStream out(::juce::File(validPath.string()));
        if (!out.openedOk() || !png.writeImageToStream(validImage, out)) return 22;
    }
    const auto validSvg = resourceDir / "play.svg";
    {
        std::ofstream svg(validSvg);
        svg << "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#000000\" d=\"M8 5v14l11-7z\"/></svg>";
    }
    // SVG 解析要取消息线程锁；应用发出的 SVG 请求可能正占着工作线程，阻塞等待会互锁
    // 派发循环停下后不能再次进入，三个请求一并发出，在同一次循环里等全部完成
    auto remaining = std::make_shared<int>(3);
    const auto wake = [remaining] {
        ::juce::MessageManager::callAsync([remaining] {
            if (--*remaining == 0) ::juce::MessageManager::getInstance()->stopDispatchLoop();
        });
    };
    auto missingRequest = acquire("missing.png", wake);
    auto validRequest = acquire("valid.png", wake);
    auto iconRequest = acquire("play.svg", wake);
    ::juce::MessageManager::getInstance()->runDispatchLoop();

    const auto missing = missingRequest.get();
    if (missing.error.empty() || missing.content) return 21;

    arrange::juce::JuceDrawOpsPainter painter;
    ::juce::Image canvas(::juce::Image::RGB, 16, 16, true);
    const auto prepared = validRequest.get();
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

    const auto iconPrepared = iconRequest.get();
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
                        op.contentScale = *arrange::core::parseContentScale(scale);
                        op.alignment = *arrange::core::parseImageAlignment(alignment);
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

using RuntimeSmokeApplication = arrange::test::JuceTestApplication<runSmoke>;
START_JUCE_APPLICATION(RuntimeSmokeApplication)
