#include <arrange/core/Layout.h>
#include <arrange/core/Paint.h>
#include <arrange/core/RenderTree.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>

namespace {
    bool treeContainsText(const arrange::core::RenderTree& tree, const std::string& text) {
        for (arrange::core::NodeId id = 1; id < 128; ++id) {
            if (!tree.contains(id)) continue;
            if (tree.node(id).text == text) return true;
        }
        return false;
    }

    bool mountedBatchHasTypedModifierProps(const arrange::core::BridgeBatch& batch) {
        for (const auto& op : batch.ops) {
            if (op.opcode != arrange::core::BridgeOpcode::SetModifier || op.modifierDebugJson.empty()) continue;
            bool hasCount = false;
            bool hasType = false;
            const auto typePrefix = std::string("__arrangeModifier.");
            for (const auto& candidate : batch.ops) {
                if (candidate.opcode != arrange::core::BridgeOpcode::SetProp || candidate.id != op.id) continue;
                if (candidate.key == "__arrangeModifierCount") hasCount = true;
                if (candidate.key.starts_with(typePrefix) && candidate.key.ends_with(".type")) hasType = true;
            }
            if (!hasCount || !hasType) {
                std::cerr << "setModifier op missing typed modifier props for id=" << op.id << "\n";
                return false;
            }
        }
        return true;
    }

    std::uint32_t parseColor(std::string_view text) {
        const auto value = std::string(text);
        const int base = value.starts_with("0x") || value.starts_with("0X") ? 16 : 10;
        return static_cast<std::uint32_t>(std::stoul(value, nullptr, base));
    }

    bool treeContainsBackgroundColor(const arrange::core::RenderTree& tree, arrange::core::NodeId root, std::uint32_t color) {
        arrange::core::PaintModel paint;
        for (const auto& op : paint.collect(tree, root)) { if (op.type == arrange::core::DrawOpType::FillRect && op.color == color) return true; }
        return false;
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
            "usage: arrange_quickjs_app_smoke <ui/app.mjs> [--expect-text text] [--expect-reload substring] [--expect-callback-count n] [--set-frame-time ms] [--reload-entry app.mjs] [--invoke-unmount handle] [callback-handle expected-text [callback-arg] [--expect-callback-count-after-invoke n] [--expect-callback-fails handle] [--expect-pending-raf] [--pump-frame ms --expect-background-color color] [--invoke-after handle expected-text [callback-arg]]]\n";
        return 2;
    }

    arrange::quickjs::QuickJsScriptHost host;
    arrange::quickjs::AppScriptLoader loader(host);
    const auto loaded = loader.loadEntry(std::filesystem::path(argv[1]));
    if (!loaded.ok) {
        std::cerr << loaded.error << "\n";
        return 3;
    }
    if (!host.mountedBatch()) return 4;
    if (host.mountedBatch()->ops.empty()) return 5;
    if (!mountedBatchHasTypedModifierProps(*host.mountedBatch())) return 27;

    arrange::core::RenderTree tree;
    tree.apply(*host.mountedBatch());
    if (!tree.contains(1)) return 6;
    arrange::core::LayoutEngine layout;
    layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
    if (tree.node(1).text.size() != 0) { return 7; }

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
        if (flag == "--expect-callback-count" && argc >= callbackArg + 2) {
            const auto expected = static_cast<std::size_t>(std::stoul(argv[callbackArg + 1]));
            if (host.callbackCount() != expected) return 14;
            callbackArg += 2;
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
            if (!host.mountedBatch()) return 16;
            callbackArg += 2;
            continue;
        }
        if (flag == "--invoke-unmount" && argc >= callbackArg + 2) {
            const auto handle = static_cast<std::uint32_t>(std::stoul(argv[callbackArg + 1]));
            const auto invoked = host.invokeCallback(handle, {});
            if (!invoked.ok) {
                std::cerr << invoked.error << "\n";
                return 24;
            }
            if (!host.mountedBatch()) return 25;
            tree.apply(*host.mountedBatch());
            if (tree.contains(1)) return 26;
            callbackArg += 2;
            continue;
        }
        std::cerr << "unknown smoke flag: " << flag << "\n";
        return 17;
    }

    if (argc >= callbackArg + 2) {
        const auto handle = static_cast<std::uint32_t>(std::stoul(argv[callbackArg]));
        const std::string expectedText(argv[callbackArg + 1]);
        arrange::quickjs::CallbackInvokeOptions options;
        int postInvokeArg = callbackArg + 2;
        if (argc > postInvokeArg && !std::string(argv[postInvokeArg]).starts_with("--")) {
            options.hasStringArgument = true;
            options.stringArgument = argv[postInvokeArg];
            ++postInvokeArg;
        }
        const auto invoked = host.invokeCallback(handle, options);
        if (!invoked.ok) {
            std::cerr << invoked.error << "\n";
            return 8;
        }
        if (expectedText == "--no-mounted-batch") {
            std::cout << "QuickJS callback smoke invoked handle=" << handle << "\n";
            return 0;
        }
        if (!host.mountedBatch()) return 9;
        tree.apply(*host.mountedBatch());
        if (!treeContainsText(tree, expectedText)) {
            std::cerr << "expected text after callback not found: " << expectedText
                << ", latest ops=" << host.mountedBatch()->ops.size() << "\n";
            for (const auto& op : host.mountedBatch()->ops) {
                if (!op.text.empty()) std::cerr << "text op id=" << op.id << " text=" << op.text << "\n";
                if (!op.key.empty()) std::cerr << "prop op id=" << op.id << " key=" << op.key << " value=" << op.value << "\n";
            }
            return 10;
        }

        while (argc > postInvokeArg && std::string(argv[postInvokeArg]).starts_with("--")) {
            const std::string flag(argv[postInvokeArg]);
            if (flag == "--expect-callback-count-after-invoke" && argc >= postInvokeArg + 2) {
                const auto expected = static_cast<std::size_t>(std::stoul(argv[postInvokeArg + 1]));
                if (host.callbackCount() != expected) return 18;
                postInvokeArg += 2;
                continue;
            }
            if (flag == "--expect-callback-fails" && argc >= postInvokeArg + 2) {
                const auto staleHandle = static_cast<std::uint32_t>(std::stoul(argv[postInvokeArg + 1]));
                const auto staleInvoked = host.invokeCallback(staleHandle, {});
                if (staleInvoked.ok) return 19;
                postInvokeArg += 2;
                continue;
            }
            if (flag == "--expect-pending-raf") {
                if (!host.hasPendingAnimationFrame()) return 28;
                ++postInvokeArg;
                continue;
            }
            if (flag == "--pump-frame" && argc >= postInvokeArg + 2) {
                const auto pumped = host.pumpAnimationFrame(std::stod(argv[postInvokeArg + 1]));
                if (!pumped.ok) {
                    std::cerr << pumped.error << "\n";
                    return 29;
                }
                if (host.mountedBatch()) {
                    tree.apply(*host.mountedBatch());
                    layout.layout(tree, 1, {0.0f, 520.0f, 0.0f, 300.0f});
                }
                postInvokeArg += 2;
                continue;
            }
            if (flag == "--expect-background-color" && argc >= postInvokeArg + 2) {
                const auto expectedColor = parseColor(argv[postInvokeArg + 1]);
                if (!treeContainsBackgroundColor(tree, 1, expectedColor)) {
                    std::cerr << "expected background color not found: " << argv[postInvokeArg + 1] << "\n";
                    return 30;
                }
                postInvokeArg += 2;
                continue;
            }
            if (flag == "--invoke-after" && argc >= postInvokeArg + 3) {
                const auto nextHandle = static_cast<std::uint32_t>(std::stoul(argv[postInvokeArg + 1]));
                const std::string nextExpectedText(argv[postInvokeArg + 2]);
                arrange::quickjs::CallbackInvokeOptions nextOptions;
                postInvokeArg += 3;
                if (argc > postInvokeArg && !std::string(argv[postInvokeArg]).starts_with("--")) {
                    nextOptions.hasStringArgument = true;
                    nextOptions.stringArgument = argv[postInvokeArg];
                    ++postInvokeArg;
                }
                const auto nextInvoked = host.invokeCallback(nextHandle, nextOptions);
                if (!nextInvoked.ok) {
                    std::cerr << nextInvoked.error << "\n";
                    return 20;
                }
                if (!host.mountedBatch()) return 21;
                tree.apply(*host.mountedBatch());
                if (!treeContainsText(tree, nextExpectedText)) return 22;
                continue;
            }
            std::cerr << "unknown post-invoke smoke flag: " << flag << "\n";
            return 23;
        }
    }

    std::cout << "QuickJS app smoke mounted ops=" << host.mountedBatch()->ops.size() << "\n";
    return 0;
#endif
}
