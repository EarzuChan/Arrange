#include "TextFixtures.h"
#include <arrange/core/EventSlot.h>
#include <arrange/core/Layout.h>
#include <arrange/core/NativeScene.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Mutation.h>
#include <arrange/core/Paint.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>
#include <arrange/juce/PainterResources.h>

#include <cstdint>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string_view>
#include <string>
#include <variant>

namespace {
    bool treeContainsBackgroundColor(const arrange::core::LayoutTree& tree, arrange::core::NodeId root, std::uint32_t color) {
        arrange::core::DrawOpsBuilder paint;
        for (const auto& op : paint.exportScene(tree, root)) {
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == color) return true;
        }
        return false;
    }

    std::optional<arrange::core::EventSlotId> firstEventSlotInTree(const arrange::core::LayoutTree& tree, arrange::core::EventSlotKind kind) {
        for (const auto id : tree.nodeIds()) {
            for (const auto& instance : tree.node(id).modifier.elements()) {
                arrange::core::EventSlotId slot;
                if (const auto* input = std::get_if<arrange::core::InputModifierSemantics>(&instance.descriptor.value)) slot = input->eventSlot;
                if (const auto* input = std::get_if<arrange::core::LayoutModifierSemantics>(&instance.descriptor.value)) slot = input->eventSlot;
                if (slot.kind == kind && slot.valid()) return slot;
            }
        }
        return std::nullopt;
    }

    std::optional<arrange::core::EventSlotId> firstInputSubmitEventSlot(const arrange::core::LayoutTree& tree) {
        for (const auto id : tree.nodeIds()) {
            const auto& node = tree.node(id);
            const auto slot = test_support::event(node, arrange::core::EventSlotKind::InputSubmit);
            if (slot.valid()) return slot;
        }
        return std::nullopt;
    }

    bool hasInitialDemoVisuals(const arrange::core::LayoutTree& tree) {
        return treeContainsBackgroundColor(tree, 1, 0xff0e1722u) && treeContainsBackgroundColor(tree, 1, 0xff3a7afeu) && treeContainsBackgroundColor(tree, 1, 0xffffb020u);
    }

    bool hasInitialDemoEventSlots(const arrange::core::LayoutTree& tree) {
        const auto click = firstEventSlotInTree(tree, arrange::core::EventSlotKind::Click);
        const auto scroll = firstEventSlotInTree(tree, arrange::core::EventSlotKind::VerticalScroll);
        const auto submit = firstInputSubmitEventSlot(tree);
        return click && click->valid() && scroll && scroll->valid() && submit && submit->valid();
    }

    bool transactionContainsTypedModifier(const arrange::core::MutationTransaction& transaction) {
        for (const auto& operation : transaction.operations) {
            const auto* update = std::get_if<arrange::core::SlotUpdate>(&operation);
            if (update && std::holds_alternative<arrange::core::ModifierDescriptors>(update->value)) return true;
        }
        return false;
    }

    std::string strictModifierSmokeSource(std::string_view modifierExpression) {
        return std::string("const native = globalThis.__ARRANGE_NATIVE__;\n") + "native.createNode(1, 'LayoutNode');\n" + "if (!native.setModifier) throw new Error('缺少 native.setModifier');\n" + "native.setModifier(1, " + std::string(modifierExpression) + ");\n" + "native.createNode(2, 'LayoutNode');\n" + "native.setModifier(2, { elements: [] });\n" + "native.insertChild(1, 2, 0);\n";
    }

    bool expectScriptDiagnostics(arrange::quickjs::QuickJsScriptHost& host) {
        const auto source =
            "const native = globalThis.__ARRANGE_NATIVE__;\n"
            "console.warn('控制台测试');\n"
            "native.diagnosticsLog('debug', { category: 'app', code: 'app.debug', message: '调试日志', detail: '详情' });\n"
            "native.diagnosticsToast({ category: 'diagnostics', code: 'toast', message: '提示日志' });\n"
            "native.diagnosticsSetLogLevel('error');\n"
            "native.diagnosticsSetCategoryEnabled('runtime.script', false);\n"
            "native.diagnosticsSetToastsEnabled(false);\n"
            "native.diagnosticsRequestReload({ path: 'src/App.sfa', timestamp: 12 });\n"
            "native.createNode(1, 'LayoutNode');\n"
            "native.createNode(2, 'LayoutNode');\n"
            "native.setModifier(2, { elements: [] });\n"
            "native.insertChild(1, 2, 0);\n";
        const auto result = host.executeModule("diagnostics-smoke.js", source);
        if (!result.ok) {
            std::cerr << result.error << "\n";
            return false;
        }
        auto events = host.takeDiagnosticEvents();
        auto actions = host.takeDiagnosticActions();
        if (events.size() != 3) return false;
        if (events[0].level != arrange::quickjs::QuickJsDiagnosticLevel::Warn || events[0].category != arrange::quickjs::QuickJsDiagnosticCategory::RuntimeScript || events[0].code != "console.warn" || events[0].message.find("控制台测试") == std::string::npos) return false;
        if (events[1].level != arrange::quickjs::QuickJsDiagnosticLevel::Debug || events[1].category != arrange::quickjs::QuickJsDiagnosticCategory::App || events[1].code != "app.debug" || events[1].detail != "详情") return false;
        if (events[2].level != arrange::quickjs::QuickJsDiagnosticLevel::Info || events[2].category != arrange::quickjs::QuickJsDiagnosticCategory::Diagnostics || !events[2].toast || events[2].code != "toast") return false;
        if (actions.size() != 4) return false;
        if (actions[0].kind != arrange::quickjs::QuickJsDiagnosticActionKind::SetLogLevel || actions[0].level != arrange::quickjs::QuickJsDiagnosticLevel::Error) return false;
        if (actions[1].kind != arrange::quickjs::QuickJsDiagnosticActionKind::SetCategoryEnabled || actions[1].category != arrange::quickjs::QuickJsDiagnosticCategory::RuntimeScript || actions[1].enabled) return false;
        if (actions[2].kind != arrange::quickjs::QuickJsDiagnosticActionKind::SetToastsEnabled || actions[2].enabled) return false;
        if (actions[3].kind != arrange::quickjs::QuickJsDiagnosticActionKind::RequestReload || actions[3].path != "src/App.sfa" || actions[3].timestamp != 12.0) return false;
        if (host.hasPendingDiagnostics()) return false;
        return true;
    }

    bool expectScriptDiagnosticsRejection(arrange::quickjs::QuickJsScriptHost& host) {
        {
            const auto result = host.executeModule("diagnostics-invalid-level-smoke.js",
                                                   "const native = globalThis.__ARRANGE_NATIVE__;\n"
                                                   "native.createNode(1, 'LayoutNode');\n"
                                                   "native.setModifier(1, { elements: [] });\n"
                                                   "native.diagnosticsLog('verbose', { category: 'app', message: '非法测试' });\n");
            if (result.ok || result.error.find("log level") == std::string::npos || !host.takeDiagnosticEvents().empty()) {
                std::cerr << "非法日志级别调用结果=" << (result.ok ? "true" : "false") << " 错误=[" << result.error << "]\n";
                return false;
            }
        }
        {
            const auto result = host.executeModule("diagnostics-invalid-category-smoke.js",
                                                   "const native = globalThis.__ARRANGE_NATIVE__;\n"
                                                   "native.createNode(1, 'LayoutNode');\n"
                                                   "native.setModifier(1, { elements: [] });\n"
                                                   "native.diagnosticsSetCategoryEnabled('runtime.fake', true);\n");
            if (result.ok || result.error.find("category") == std::string::npos || !host.takeDiagnosticActions().empty()) {
                std::cerr << "非法分类调用结果=" << (result.ok ? "true" : "false") << " 错误=[" << result.error << "]\n";
                return false;
            }
        }
        return true;
    }
}  // namespace

int main(int argc, char** argv) {
#if !ARRANGE_WITH_QUICKJS_NG
    (void)argc;
    (void)argv;
    std::cerr << "未启用 ARRANGE_WITH_QUICKJS_NG\n";
    return 2;
#else
    if (argc < 2) {
        std::cerr << "用法：arrange_quickjs_app_smoke <ui/app.js> [测试选项]\n";
        return 2;
    }

    arrange::quickjs::QuickJsScriptHost host;
    if (argc >= 3 && std::string(argv[2]) == "--expect-script-diagnostics") {
        if (!expectScriptDiagnostics(host)) return 43;
        std::cout << "QuickJS 诊断测试产生正确的结构化事件与操作\n";
        return 0;
    }
    if (argc >= 3 && std::string(argv[2]) == "--expect-script-diagnostics-rejection") {
        if (!expectScriptDiagnosticsRejection(host)) return 44;
        std::cout << "QuickJS 诊断测试拒绝非法级别和分类\n";
        return 0;
    }
    if (argc >= 4 && std::string(argv[2]) == "--expect-strict-modifier-ok") {
        const auto source = strictModifierSmokeSource(argv[3]);
        const auto result = host.executeModule("strict-modifier-smoke.js", source);
        if (!result.ok) {
            std::cerr << result.error << "\n";
            return 38;
        }
        const auto transaction = host.takePendingTransaction();
        if (!transaction) return 39;
        std::uint32_t modifiers = 0;
        for (const auto& operation : transaction->operations) {
            const auto* update = std::get_if<arrange::core::SlotUpdate>(&operation);
            if (update && std::holds_alternative<arrange::core::ModifierDescriptors>(update->value)) ++modifiers;
        }
        if (modifiers != 2) return 40;
        std::cout << "QuickJS Modifier 测试接受合法直接对象\n";
        return 0;
    }
    if (argc >= 4 && std::string(argv[2]) == "--expect-strict-modifier-error") {
        const auto result = host.executeModule("strict-modifier-smoke.js", strictModifierSmokeSource(argv[3]));
        if (result.ok) {
            std::cerr << "Modifier 应拒绝表达式：" << argv[3] << "\n";
            return 41;
        }
        if (result.error.find("TypeError:") == std::string::npos || result.error.find("setModifier") == std::string::npos) {
            std::cerr << result.error << "\n";
            return 42;
        }
        std::cout << "QuickJS Modifier 已拒绝：" << result.error.substr(0, result.error.find('\n')) << "\n";
        return 0;
    }

    if (argc != 2) {
        std::cerr << "未知或不完整的测试选项：" << argv[2] << "\n";
        return 37;
    }

    host.setPainterLoader(arrange::juce::packagePainterLoader(std::filesystem::path(argv[1]).parent_path()));
    arrange::quickjs::AppScriptLoader loader(host);
    const auto loaded = loader.loadEntry(std::filesystem::path(argv[1]));
    if (!loaded.ok) {
        std::cerr << loaded.error << "\n";
        return 3;
    }

    auto initialTransaction = host.takePendingTransaction();
    if (!initialTransaction || !initialTransaction->hasTreeMutations()) return 4;
    const auto initialEventSlotUpdates = std::count_if(initialTransaction->operations.begin(), initialTransaction->operations.end(), [](const auto& op) { return std::holds_alternative<arrange::core::RegisterEventSlot>(op); });
    if (initialEventSlotUpdates == 0 || static_cast<std::size_t>(initialEventSlotUpdates) != host.eventSlotCount()) {
        std::cerr << "初始事务的事件槽注册与宿主账本不一致\n";
        return 21;
    }

    if (!transactionContainsTypedModifier(*initialTransaction)) return 6;

    arrange::core::NativeScene scene;
    scene.apply(*initialTransaction);
    auto& tree = scene.tree();
    arrange::core::LayoutEngine layout;
    layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
    if (!tree.contains(1) || !hasInitialDemoVisuals(tree) || !hasInitialDemoEventSlots(tree)) return 7;

    host.publishScene(scene);
    if (const auto result = host.completeRearrange(initialTransaction->rearrange); !result.ok) throw std::runtime_error(result.error);

    std::cout << "QuickJS 应用加载与类型化事务验证通过，操作数=" << initialTransaction->operations.size() << "\n";
    return 0;
#endif
}
