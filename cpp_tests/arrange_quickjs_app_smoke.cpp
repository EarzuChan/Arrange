#include <arrange/core/EventSlot.h>
#include <arrange/core/Layout.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Mutation.h>
#include <arrange/core/Paint.h>
#include <arrange/core/Scroll.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <cstdint>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string_view>
#include <string>
#include <variant>
#include <vector>

namespace {
    bool treeContainsText(const arrange::core::LayoutTree& tree, const std::string& text) {
        for (arrange::core::NodeId id = 1; id < 512; ++id) {
            if (!tree.contains(id)) continue;
            if (tree.node(id).text == text) return true;
        }
        return false;
    }

    bool treeContainsBackgroundColor(const arrange::core::LayoutTree& tree, arrange::core::NodeId root, std::uint32_t color) {
        arrange::core::DrawOpsBuilder paint;
        for (const auto& op : paint.collect(tree, root)) {
            if (op.type == arrange::core::DrawOpType::FillRect && op.color == color) return true;
        }
        return false;
    }

    std::optional<arrange::core::EventSlotId> firstEventSlotInTree(
        const arrange::core::LayoutTree& tree,
        arrange::core::EventSlotKind kind) {
        for (arrange::core::NodeId id = 1; id < 512; ++id) {
            if (!tree.contains(id)) continue;
            const auto& modifier = tree.node(id).modifier;
            if (kind == arrange::core::EventSlotKind::Click && modifier.input.clickEventSlot.valid()) return modifier.input.clickEventSlot;
            if (kind == arrange::core::EventSlotKind::VerticalScroll && modifier.scroll.verticalEventSlot.valid()) return modifier.scroll.verticalEventSlot;
            if (kind == arrange::core::EventSlotKind::HorizontalScroll && modifier.scroll.horizontalEventSlot.valid()) return modifier.scroll.horizontalEventSlot;
        }
        return std::nullopt;
    }

    std::optional<arrange::core::EventSlotId> firstInputSubmitEventSlot(const arrange::core::LayoutTree& tree) {
        for (arrange::core::NodeId id = 1; id < 512; ++id) {
            if (!tree.contains(id)) continue;
            const auto& node = tree.node(id);
            if (node.type != arrange::core::NodeType::Input) continue;
            if (const auto slot = node.eventSlots.find(arrange::core::EventSlotKind::InputSubmit); slot != node.eventSlots.end() && slot->second.valid()) return slot->second;
        }
        return std::nullopt;
    }

    bool hasInitialDemoVisuals(const arrange::core::LayoutTree& tree) {
        return treeContainsBackgroundColor(tree, 1, 0xff000000u) &&
            treeContainsBackgroundColor(tree, 1, 0xff3a7afeu) &&
            treeContainsBackgroundColor(tree, 1, 0xffffb020u);
    }

    bool hasInitialDemoEventSlots(const arrange::core::LayoutTree& tree) {
        const auto click = firstEventSlotInTree(tree, arrange::core::EventSlotKind::Click);
        const auto scroll = firstEventSlotInTree(tree, arrange::core::EventSlotKind::VerticalScroll);
        const auto submit = firstInputSubmitEventSlot(tree);
        return click && click->valid() && scroll && scroll->valid() && submit && submit->valid();
    }

    std::optional<std::vector<arrange::core::TreeMutation>> takeTreeMutations(arrange::quickjs::QuickJsScriptHost& host) {
        auto transaction = host.takePendingTransaction();
        if (!transaction || !transaction->hasTreeMutations()) return std::nullopt;
        return std::move(transaction->treeMutations);
    }

    bool transactionContainsTypedModifier(const std::vector<arrange::core::TreeMutation>& mutations) {
        for (const auto& mutation : mutations) {
            if (std::holds_alternative<arrange::core::SetModifierMutation>(mutation)) return true;
        }
        return false;
    }

    std::string strictModifierSmokeSource(std::string_view modifierExpression) {
        return std::string("const native = globalThis.__ARRANGE_NATIVE__;\n") +
            "native.createNode(1, 'Box');\n" +
            "if (!native.setModifier) throw new Error('native.setModifier missing');\n" +
            "native.setModifier(1, " + std::string(modifierExpression) + ");\n" +
            "native.createNode(2, 'Box');\n" +
            "native.setModifier(2, { elements: [] });\n" +
            "native.insertChild(1, 2, 0);\n";
    }

    bool expectScriptDiagnostics(arrange::quickjs::QuickJsScriptHost& host) {
        const auto source =
            "const native = globalThis.__ARRANGE_NATIVE__;\n"
            "console.warn('from console');\n"
            "native.diagnosticsLog('debug', { category: 'app', code: 'app.debug', message: 'debug log', detail: 'detail' });\n"
            "native.diagnosticsToast({ category: 'diagnostics', code: 'toast', message: 'toast log' });\n"
            "native.diagnosticsSetLogLevel('error');\n"
            "native.diagnosticsSetCategoryEnabled('runtime.script', false);\n"
            "native.diagnosticsSetToastsEnabled(false);\n"
            "native.diagnosticsRequestReload({ path: 'src/App.vue', timestamp: 12 });\n"
            "native.createNode(1, 'Box');\n"
            "native.createNode(2, 'Box');\n"
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
        if (events[0].level != arrange::quickjs::QuickJsDiagnosticLevel::Warn ||
            events[0].category != arrange::quickjs::QuickJsDiagnosticCategory::RuntimeScript ||
            events[0].code != "console.warn" ||
            events[0].message.find("from console") == std::string::npos) return false;
        if (events[1].level != arrange::quickjs::QuickJsDiagnosticLevel::Debug ||
            events[1].category != arrange::quickjs::QuickJsDiagnosticCategory::App ||
            events[1].code != "app.debug" ||
            events[1].detail != "detail") return false;
        if (events[2].level != arrange::quickjs::QuickJsDiagnosticLevel::Info ||
            events[2].category != arrange::quickjs::QuickJsDiagnosticCategory::Diagnostics ||
            !events[2].toast ||
            events[2].code != "toast") return false;
        if (actions.size() != 4) return false;
        if (actions[0].kind != arrange::quickjs::QuickJsDiagnosticActionKind::SetLogLevel ||
            actions[0].level != arrange::quickjs::QuickJsDiagnosticLevel::Error) return false;
        if (actions[1].kind != arrange::quickjs::QuickJsDiagnosticActionKind::SetCategoryEnabled ||
            actions[1].category != arrange::quickjs::QuickJsDiagnosticCategory::RuntimeScript ||
            actions[1].enabled) return false;
        if (actions[2].kind != arrange::quickjs::QuickJsDiagnosticActionKind::SetToastsEnabled ||
            actions[2].enabled) return false;
        if (actions[3].kind != arrange::quickjs::QuickJsDiagnosticActionKind::RequestReload ||
            actions[3].path != "src/App.vue" ||
            actions[3].timestamp != 12.0) return false;
        if (!host.reloadRequested() || host.reloadRequest().path != "src/App.vue") return false;
        return true;
    }

    bool expectScriptDiagnosticsRejection(arrange::quickjs::QuickJsScriptHost& host) {
        {
            const auto result = host.executeModule(
                "diagnostics-invalid-level-smoke.js",
                "const native = globalThis.__ARRANGE_NATIVE__;\n"
                "native.createNode(1, 'Box');\n"
                "native.setModifier(1, { elements: [] });\n"
                "native.diagnosticsLog('verbose', { category: 'app', message: 'bad' });\n");
            if (result.ok || result.error.find("log level") == std::string::npos || !host.takeDiagnosticEvents().empty()) {
                std::cerr << "invalid level result ok=" << (result.ok ? "true" : "false") << " error=[" << result.error << "]\n";
                return false;
            }
        }
        {
            const auto result = host.executeModule(
                "diagnostics-invalid-category-smoke.js",
                "const native = globalThis.__ARRANGE_NATIVE__;\n"
                "native.createNode(1, 'Box');\n"
                "native.setModifier(1, { elements: [] });\n"
                "native.diagnosticsSetCategoryEnabled('runtime.fake', true);\n");
            if (result.ok || result.error.find("category") == std::string::npos || !host.takeDiagnosticActions().empty()) {
                std::cerr << "invalid category result ok=" << (result.ok ? "true" : "false") << " error=[" << result.error << "]\n";
                return false;
            }
        }
        return true;
    }
}

int main(int argc, char** argv) {
#if !ARRANGE_WITH_QUICKJS_NG
    (void)argc;
    (void)argv;
    std::cerr << "ARRANGE_WITH_QUICKJS_NG is not enabled\n";
    return 2;
#else
    if (argc < 2) {
        std::cerr << "usage: arrange_quickjs_app_smoke <ui/app.js> [flags]\n";
        return 2;
    }

    arrange::quickjs::QuickJsScriptHost host;
    if (argc >= 3 && std::string(argv[2]) == "--expect-script-diagnostics") {
        if (!expectScriptDiagnostics(host)) return 43;
        std::cout << "QuickJS diagnostics smoke produced structured events and actions\n";
        return 0;
    }
    if (argc >= 3 && std::string(argv[2]) == "--expect-script-diagnostics-rejection") {
        if (!expectScriptDiagnosticsRejection(host)) return 44;
        std::cout << "QuickJS diagnostics smoke rejected invalid level and category\n";
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
        for (const auto& mutation : transaction->treeMutations) {
            if (std::holds_alternative<arrange::core::SetModifierMutation>(mutation)) ++modifiers;
        }
        if (modifiers != 2) return 40;
        std::cout << "QuickJS strict modifier smoke accepted valid direct object path\n";
        return 0;
    }
    if (argc >= 4 && std::string(argv[2]) == "--expect-strict-modifier-error") {
        const auto result = host.executeModule("strict-modifier-smoke.js", strictModifierSmokeSource(argv[3]));
        if (result.ok) {
            std::cerr << "expected strict modifier rejection for expression: " << argv[3] << "\n";
            return 41;
        }
        if (result.error.find("Arrange native setModifier") == std::string::npos &&
            result.error.find("Arrange modifier") == std::string::npos) {
            std::cerr << result.error << "\n";
            return 42;
        }
        std::cout << "QuickJS strict modifier rejected: " << result.error.substr(0, result.error.find('\n')) << "\n";
        return 0;
    }

    arrange::quickjs::AppScriptLoader loader(host);
    const auto loaded = loader.loadEntry(std::filesystem::path(argv[1]));
    if (!loaded.ok) {
        std::cerr << loaded.error << "\n";
        return 3;
    }

    auto initialTransaction = host.takePendingTransaction();
    if (!initialTransaction || !initialTransaction->hasTreeMutations()) return 4;
    const auto initialEventSlotUpdates = initialTransaction->eventSlotUpdates.size();
    auto lastMutations = std::optional<std::vector<arrange::core::TreeMutation>>(std::move(initialTransaction->treeMutations));
    if (!lastMutations || lastMutations->empty()) return 5;
    if (!transactionContainsTypedModifier(*lastMutations)) return 6;

    arrange::core::LayoutTree tree;
    tree.apply(*lastMutations);
    arrange::core::LayoutEngine layout;
    layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
    if (!tree.contains(1) || !hasInitialDemoVisuals(tree) || !hasInitialDemoEventSlots(tree)) return 7;

    int arg = 2;
    if (argc >= 4 && std::string(argv[2]) == "--expect-text") {
        if (!treeContainsText(tree, argv[3])) return 11;
        arg = 4;
    }
    if (argc >= arg + 2 && std::string(argv[arg]) == "--expect-reload") {
        if (!host.reloadRequested()) return 12;
        const auto& request = host.reloadRequest();
        if (request.path.find(argv[arg + 1]) == std::string::npos) return 13;
        arg += 2;
    }

    while (argc > arg && std::string(argv[arg]).starts_with("--")) {
        const std::string flag(argv[arg]);
        if (flag == "--expect-event-slot-count" && argc >= arg + 2) {
            const auto expected = static_cast<std::size_t>(std::stoul(argv[arg + 1]));
            if (host.eventSlotCount() != expected) return 21;
            arg += 2;
            continue;
        }
        if (flag == "--expect-current-transaction-event-slot-updates" && argc >= arg + 2) {
            const auto expected = static_cast<std::size_t>(std::stoul(argv[arg + 1]));
            if (initialEventSlotUpdates != expected) return 22;
            arg += 2;
            continue;
        }
        if (flag == "--invoke-first-click-slot-repeated-transaction" && argc >= arg + 2) {
            const auto repeatCount = std::stoi(argv[arg + 1]);
            auto expectedEnd = arg + 2;
            std::string expectedText;
            while (expectedEnd < argc && !std::string(argv[expectedEnd]).starts_with("--")) {
                if (!expectedText.empty()) expectedText += " ";
                expectedText += argv[expectedEnd];
                ++expectedEnd;
            }
            if (expectedText.empty()) expectedText = "Clicks: " + std::to_string(repeatCount);
            const auto slot = firstEventSlotInTree(tree, arrange::core::EventSlotKind::Click);
            if (!slot || !slot->valid()) return 23;
            for (int index = 0; index < repeatCount; ++index) {
                const auto invoked = host.invokeEventSlot(*slot, arrange::quickjs::CallbackInvokeOptions{});
                if (!invoked.ok) {
                    std::cerr << invoked.error << "\n";
                    return 24;
                }
            }
            lastMutations = takeTreeMutations(host);
            if (!lastMutations) return 25;
            tree.apply(*lastMutations);
            layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
            if (!treeContainsText(tree, expectedText)) return 26;
            arg = expectedEnd;
            continue;
        }
        if (flag == "--invoke-first-vertical-scroll-slot" && argc >= arg + 2) {
            const auto scrollValue = std::stof(argv[arg + 1]);
            const auto slot = firstEventSlotInTree(tree, arrange::core::EventSlotKind::VerticalScroll);
            if (!slot || !slot->valid()) return 27;
            arrange::core::ScrollResult scroll;
            scroll.consumed = true;
            scroll.target = slot->node;
            scroll.value = scrollValue;
            scroll.maxValue = scrollValue + 25.0f;
            scroll.viewportSize = 80.0f;
            scroll.contentSize = 120.0f;
            scroll.eventSlot = *slot;
            const auto invoked = host.invokeEventSlot(*slot, scroll);
            if (!invoked.ok) {
                std::cerr << invoked.error << "\n";
                return 28;
            }
            lastMutations = takeTreeMutations(host);
            if (!lastMutations) return 29;
            tree.apply(*lastMutations);
            if (tree.node(slot->node).modifier.scroll.verticalValue != scrollValue) return 30;
            arg += 2;
            continue;
        }
        if (flag == "--invoke-first-input-submit-slot" && argc >= arg + 2) {
            const std::string value = argv[arg + 1];
            auto expectedEnd = arg + 2;
            std::string expectedText;
            while (expectedEnd < argc && !std::string(argv[expectedEnd]).starts_with("--")) {
                if (!expectedText.empty()) expectedText += " ";
                expectedText += argv[expectedEnd];
                ++expectedEnd;
            }
            if (expectedText.empty()) expectedText = "Submitted: " + value;
            const auto slot = firstInputSubmitEventSlot(tree);
            if (!slot || !slot->valid()) return 31;
            arrange::quickjs::CallbackInvokeOptions options;
            options.hasStringArgument = true;
            options.stringArgument = value;
            const auto invoked = host.invokeEventSlot(*slot, options);
            if (!invoked.ok) {
                std::cerr << invoked.error << "\n";
                return 32;
            }
            lastMutations = takeTreeMutations(host);
            if (!lastMutations) return 33;
            tree.apply(*lastMutations);
            layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
            if (!treeContainsText(tree, expectedText)) return 34;
            arg = expectedEnd;
            continue;
        }
        if (flag == "--set-frame-time" && argc >= arg + 2) {
            host.setFrameTimeMillis(std::stod(argv[arg + 1]));
            arg += 2;
            continue;
        }
        if (flag == "--reload-entry" && argc >= arg + 2) {
            const auto reloaded = loader.loadEntry(std::filesystem::path(argv[arg + 1]));
            if (!reloaded.ok) {
                std::cerr << reloaded.error << "\n";
                return 35;
            }
            lastMutations = takeTreeMutations(host);
            if (!lastMutations) return 36;
            tree = {};
            tree.apply(*lastMutations);
            layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
            arg += 2;
            continue;
        }
        std::cerr << "unknown smoke flag: " << flag << "\n";
        return 37;
    }

    std::cout << "QuickJS app smoke typed mutations=" << lastMutations->size() << "\n";
    return 0;
#endif
}

