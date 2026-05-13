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
