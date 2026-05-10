#include <arrange/core/Layout.h>
#include <arrange/core/Paint.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/EventSlot.h>
#include <arrange/core/Scroll.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <cstdint>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string>

namespace {
    bool treeContainsText(const arrange::core::LayoutTree& tree, const std::string& text) {
        for (arrange::core::NodeId id = 1; id < 128; ++id) {
            if (!tree.contains(id)) continue;
            if (tree.node(id).text == text) return true;
        }
        return false;
    }

    bool mutationsHaveTypedModifierPayloadsWithoutExpandedProps(const arrange::core::BridgeBatch& batch) {
        bool sawModifierPayload = false;
        for (const auto& op : batch.ops) {
            if (op.opcode == arrange::core::BridgeOpcode::SetModifier && !op.modifierPayload.empty()) sawModifierPayload = true;
            if (op.opcode == arrange::core::BridgeOpcode::SetProp && (op.key == "__arrangeModifierCount" || op.key.starts_with("__arrangeModifier."))) {
                std::cerr << "expanded modifier prop leaked into production batch: " << op.key << "\n";
                return false;
            }
        }
        return sawModifierPayload;
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

    std::optional<arrange::core::EventSlotId> firstClickEventSlot(const arrange::core::LayoutTree& tree) {
        return firstEventSlotInTree(tree, arrange::core::EventSlotKind::Click);
    }

    std::optional<arrange::core::EventSlotId> firstVerticalScrollEventSlot(const arrange::core::LayoutTree& tree) {
        return firstEventSlotInTree(tree, arrange::core::EventSlotKind::VerticalScroll);
    }

    std::optional<arrange::core::EventSlotId> firstInputSubmitEventSlot(const arrange::core::LayoutTree& tree) {
        for (arrange::core::NodeId id = 1; id < 512; ++id) {
            if (!tree.contains(id)) continue;
            const auto& node = tree.node(id);
            if (node.type != arrange::core::NodeType::Input) continue;
            if (const auto generated = node.props.find("__arrangeEventSlot.onSubmit"); generated != node.props.end()) {
                auto slot = arrange::core::parseEventSlotId(generated->second);
                if (slot.valid()) return slot;
            }
            if (const auto prop = node.props.find("onSubmit"); prop != node.props.end()) {
                auto slot = arrange::core::parseEventSlotId(prop->second);
                if (slot.valid()) return slot;
            }
        }
        return std::nullopt;
    }

    bool batchContainsForbiddenScrollProp(const arrange::core::BridgeBatch& batch) {
        const std::string verticalKey = std::string("__arrange") + "VerticalScrollValue";
        const std::string horizontalKey = std::string("__arrange") + "HorizontalScrollValue";
        for (const auto& op : batch.ops) {
            if (op.opcode == arrange::core::BridgeOpcode::SetProp && (op.key == verticalKey || op.key == horizontalKey)) return true;
        }
        return false;
    }

    std::optional<arrange::core::BridgeBatch> takeTransactionTree(arrange::quickjs::QuickJsScriptHost& host) {
        auto transaction = host.takePendingTransaction();
        if (!transaction || !transaction->hasTreeMutations()) return std::nullopt;
        return std::move(transaction->treeMutations);
    }

    std::uint32_t parseColor(std::string_view text) {
        const auto value = std::string(text);
        const int base = value.starts_with("0x") || value.starts_with("0X") ? 16 : 10;
        return static_cast<std::uint32_t>(std::stoul(value, nullptr, base));
    }

    bool treeContainsBackgroundColor(const arrange::core::LayoutTree& tree, arrange::core::NodeId root, std::uint32_t color) {
        arrange::core::DrawOpsBuilder paint;
        for (const auto& op : paint.collect(tree, root)) { if (op.type == arrange::core::DrawOpType::FillRect && op.color == color) return true; }
        return false;
    }

    bool treeContainsInitialDemoModifierVisuals(const arrange::core::LayoutTree& tree) {
        return treeContainsBackgroundColor(tree, 1, 0xff000000u) &&
            treeContainsBackgroundColor(tree, 1, 0xff3a7afeu) &&
            treeContainsBackgroundColor(tree, 1, 0xffffb020u);
    }

    bool treeHasInitialDemoEventSlots(const arrange::core::LayoutTree& tree) {
        const auto click = firstClickEventSlot(tree);
        const auto verticalScroll = firstVerticalScrollEventSlot(tree);
        const auto inputSubmit = firstInputSubmitEventSlot(tree);
        return click && click->valid() &&
            verticalScroll && verticalScroll->valid() &&
            inputSubmit && inputSubmit->valid();
    }

} // namespace

int main(int argc, char** argv) {
#if !ARRANGE_WITH_QUICKJS_NG
    (void)argc;
    (void)argv;
    std::cerr << "ARRANGE_WITH_QUICKJS_NG is not enabled\n";
    return 2;
#else
    if (argc < 2) {
        std::cerr <<
            "usage: arrange_quickjs_app_smoke <ui/app.js> [--expect-text text] [--expect-reload substring] [--expect-event-slot-count n] [--expect-current-transaction-event-slot-updates n] [--invoke-first-click-slot-repeated-transaction count [expected-text]] [--invoke-first-vertical-scroll-slot value] [--invoke-first-input-submit-slot value [expected-text]] [--set-frame-time ms] [--reload-entry app.js]\n";
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
    if (!initialTransaction) return 4;
    const auto initialEventSlotUpdates = initialTransaction->eventSlotUpdates.size();
    auto lastMutations = std::optional<arrange::core::BridgeBatch>(std::move(initialTransaction->treeMutations));
    if (lastMutations->ops.empty()) return 5;
    if (!mutationsHaveTypedModifierPayloadsWithoutExpandedProps(*lastMutations)) return 27;

    arrange::core::LayoutTree tree;
    tree.apply(*lastMutations);
    if (!tree.contains(1)) return 6;
    arrange::core::LayoutEngine layout;
    layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
    if (tree.node(1).text.size() != 0) { return 7; }
    if (!treeContainsInitialDemoModifierVisuals(tree)) {
        std::cerr << "initial QuickJS mount lost Modifier visuals; expected root/meter background FillRect ops\n";
        return 28;
    }
    if (!treeHasInitialDemoEventSlots(tree)) {
        std::cerr << "initial QuickJS mount lost compiled modifier event slots; expected click and vertical scroll slots\n";
        return 29;
    }

    int callbackArg = 2;
    if (argc >= 4 && std::string(argv[2]) == "--expect-text") {
        if (!treeContainsText(tree, argv[3])) return 11;
        callbackArg = 4;
    }
    if (argc >= callbackArg + 2 && std::string(argv[callbackArg]) == "--expect-reload") {
        if (!host.reloadRequested()) return 12;
        if (host.reloadPayloadJson().find(argv[callbackArg + 1]) == std::string::npos) return 13;
        callbackArg += 2;
    }

    while (argc > callbackArg && std::string(argv[callbackArg]).starts_with("--")) {
        const std::string flag(argv[callbackArg]);
        if (flag == "--expect-event-slot-count" && argc >= callbackArg + 2) {
            const auto expected = static_cast<std::size_t>(std::stoul(argv[callbackArg + 1]));
            if (host.eventSlotCount() != expected) {
                std::cerr << "event slot count mismatch: expected " << expected << ", got " << host.eventSlotCount()
                    << "; explicit initial bridge ops register native modifier slots lazily through props\n";
                return 31;
            }
            callbackArg += 2;
            continue;
        }
        if (flag == "--invoke-first-click-slot-repeated-transaction" && argc >= callbackArg + 2) {
            const auto repeatCount = static_cast<int>(std::stoi(argv[callbackArg + 1]));
            auto expectedEnd = callbackArg + 2;
            std::string expectedText;
            while (expectedEnd < argc && !std::string(argv[expectedEnd]).starts_with("--")) {
                if (!expectedText.empty()) expectedText += " ";
                expectedText += argv[expectedEnd];
                ++expectedEnd;
            }
            if (expectedText.empty()) expectedText = "Clicks: " + std::to_string(repeatCount);
            const auto slot = firstClickEventSlot(tree);
            if (!slot || !slot->valid()) return 40;
            for (int i = 0; i < repeatCount; ++i) {
                const auto invoked = host.invokeEventSlot(*slot, {});
                if (!invoked.ok) {
                    std::cerr << invoked.error << "\n";
                    return 41;
                }
            }
            auto transaction = host.takePendingTransaction();
            if (!transaction) return 42;
            if (!transaction->hasTreeMutations()) {
                std::cerr << "expected transaction with tree mutations, got tree=" << transaction->hasTreeMutations()
                    << " updates=" << transaction->eventSlotUpdates.size()
                    << " retired=" << transaction->retiredEventSlots.size() << "\n";
                return 43;
            }
            lastMutations = transaction->treeMutations;
            tree.apply(*lastMutations);
            layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
            if (!treeContainsText(tree, expectedText)) return 44;
            callbackArg = expectedEnd;
            continue;
        }
        if (flag == "--expect-current-transaction-event-slot-updates" && argc >= callbackArg + 2) {
            const auto expected = static_cast<std::size_t>(std::stoul(argv[callbackArg + 1]));
            if (initialEventSlotUpdates != expected) {
                std::cerr << "current transaction event slot update mismatch: expected " << expected
                    << ", got " << initialEventSlotUpdates
                    << "; explicit initial bridge ops encode native modifier slots as props\n";
                return 45;
            }
            callbackArg += 2;
            continue;
        }
        if (flag == "--invoke-first-vertical-scroll-slot" && argc >= callbackArg + 2) {
            const auto scrollValue = std::stof(argv[callbackArg + 1]);
            const auto slot = firstVerticalScrollEventSlot(tree);
            if (!slot || !slot->valid()) return 46;
            arrange::core::ScrollResult scroll;
            scroll.consumed = true;
            scroll.target = slot->node;
            scroll.value = scrollValue;
            scroll.maxValue = scrollValue + 25.0f;
            scroll.viewportSize = 80.0f;
            scroll.contentSize = 120.0f;
            scroll.eventSlot = *slot;
            arrange::quickjs::CallbackInvokeOptions options;
            options.hasStringArgument = true;
            options.stringArgument = "{\"value\":" + std::to_string(scroll.value) + ",\"maxValue\":" + std::to_string(scroll.maxValue) + ",\"viewportSize\":80,\"contentSize\":120,\"isScrollInProgress\":false}";
            const auto invoked = host.invokeEventSlot(*slot, options);
            if (!invoked.ok) {
                std::cerr << invoked.error << "\n";
                return 47;
            }
            auto transaction = host.takePendingTransaction();
            if (!transaction) {
                std::cerr << "no transaction after scroll slot invoke\n";
                return 48;
            }
            if (!transaction->hasTreeMutations()) {
                std::cerr << "scroll transaction had no tree mutations updates=" << transaction->eventSlotUpdates.size()
                    << " retired=" << transaction->retiredEventSlots.size() << "\n";
                return 48;
            }
            if (batchContainsForbiddenScrollProp(transaction->treeMutations)) return 49;
            lastMutations = transaction->treeMutations;
            tree.apply(*lastMutations);
            if (tree.node(slot->node).modifier.scroll.verticalValue != scrollValue) {
                std::cerr << "scroll slot invoke did not update compiled modifier value\n";
                return 50;
            }
            callbackArg += 2;
            continue;
        }
        if (flag == "--invoke-first-input-submit-slot" && argc >= callbackArg + 2) {
            const std::string value = argv[callbackArg + 1];
            auto expectedEnd = callbackArg + 2;
            std::string expectedText;
            while (expectedEnd < argc && !std::string(argv[expectedEnd]).starts_with("--")) {
                if (!expectedText.empty()) expectedText += " ";
                expectedText += argv[expectedEnd];
                ++expectedEnd;
            }
            if (expectedText.empty()) expectedText = "Submitted: " + value;
            const auto slot = firstInputSubmitEventSlot(tree);
            if (!slot || !slot->valid()) return 51;
            arrange::quickjs::CallbackInvokeOptions options;
            options.hasStringArgument = true;
            options.stringArgument = value;
            const auto invoked = host.invokeEventSlot(*slot, options);
            if (!invoked.ok) {
                std::cerr << invoked.error << "\n";
                return 52;
            }
            auto transaction = host.takePendingTransaction();
            if (!transaction) return 53;
            if (!transaction->hasTreeMutations()) {
                std::cerr << "expected input submit transaction with tree mutations, got tree=" << transaction->hasTreeMutations()
                    << " updates=" << transaction->eventSlotUpdates.size()
                    << " retired=" << transaction->retiredEventSlots.size() << "\n";
                return 54;
            }
            lastMutations = transaction->treeMutations;
            tree.apply(*lastMutations);
            layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
            if (!treeContainsText(tree, expectedText)) return 55;
            callbackArg = expectedEnd;
            continue;
        }
        if (flag == "--set-frame-time" && argc >= callbackArg + 2) {
            host.setFrameTimeMillis(std::stod(argv[callbackArg + 1]));
            callbackArg += 2;
            continue;
        }
        if (flag == "--reload-entry" && argc >= callbackArg + 2) {
            const auto reloaded = loader.loadEntry(std::filesystem::path(argv[callbackArg + 1]));
            if (!reloaded.ok) {
                std::cerr << reloaded.error << "\n";
                return 15;
            }
            lastMutations = takeTransactionTree(host);
            if (!lastMutations) return 16;
            tree = {};
            tree.apply(*lastMutations);
            layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
            callbackArg += 2;
            continue;
        }
        std::cerr << "unknown smoke flag: " << flag << "\n";
        return 17;
    }

    std::cout << "QuickJS app smoke latest ops=" << lastMutations->ops.size() << "\n";
    return 0;
#endif
}
