#include <arrange/core/Modifier.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/RuntimePackageBinder.h>
#include <arrange/juce/RuntimeSessionState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/FramePumpDriver.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    NodeId findText(const NativeScene& scene, const std::string& value) {
        for (NodeId id = 1; id < 1024; ++id) {
            if (scene.contains(id) && scene.node(id).text == value) return id;
        }
        throw std::runtime_error("Text not found: " + value);
    }

    std::vector<ModifierHandle> handles(const ArrangeNode& node) {
        std::vector<ModifierHandle> result;
        for (const auto& instance : node.modifier.elements()) result.push_back(instance.handle);
        return result;
    }
}

int main(int argc, char** argv) {
    try {
        ::juce::ScopedJuceInitialiser_GUI juceInitialiser;
        check(argc == 2, "Expected the compiled SFC fixture path");
        auto host = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        auto* hostView = host.get();
        arrange::quickjs::AppScriptLoader loader(*host);
        const auto loaded = loader.loadEntry(std::filesystem::path(argv[1]));
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        auto initialSubmission = host->takePendingTransaction();
        check(initialSubmission.has_value(), "SFC mount did not submit a scene");
        arrange::juce::ArrangeRuntime runtime;
        runtime.setScriptHost(std::move(host));
        runtime.enqueue(std::move(*initialSubmission));
        double timestamp = 0;
        const Constraints constraints{0, 520, 0, 380};
        const auto initial = runtime.pumpFrame(1, constraints, timestamp);
        if (!initial.ok) throw std::runtime_error(initial.error);
        const auto counter = findText(runtime.scene(), "撅: 0");
        const auto originalHandles = handles(runtime.scene().node(counter));
        EventSlotId submit;
        for (const auto& slot : runtime.scene().activeEventSlots()) {
            if (slot.kind == EventSlotKind::InputSubmit) submit = slot;
        }
        check(submit.valid(), "Compiled native @submit was not registered");
        const auto command = [&](const char* value) {
            runtime.enqueueStringEvent(submit, value);
            const auto frame = runtime.pumpFrame(1, constraints, timestamp += 16);
            if (!frame.ok) throw std::runtime_error(std::string(value) + ": " + frame.error);
        };
        command("baseline");
        const auto baseline = runtime.frameCounters();
        const auto bindings = runtime.scene().bindingCount();
        const auto callbacks = runtime.scene().eventSlotCount();
        auto hit = runtime.publishedFrame().content.hitTest;
        command("color");
        auto stats = runtime.frameCounters();
        check(stats.measures == baseline.measures && stats.placements == baseline.placements, "Color remeasured or replaced layout");
        check(stats.paintBuilds == baseline.paintBuilds + 1 && stats.hitBuilds == baseline.hitBuilds, "Color did not build paint independently");
        check(runtime.publishedFrame().content.hitTest == hit, "Color replaced hit snapshot");
        check(handles(runtime.scene().node(counter)) == originalHandles, "Color replaced Modifier instances");
        command("validate");
        command("offset");
        stats = runtime.frameCounters();
        check(stats.measures == baseline.measures && stats.placements == baseline.placements + 1, "Offset did not reuse measurement");
        check(runtime.publishedFrame().content.hitTest != hit, "Offset failed to rebuild hit geometry");
        command("validate");
        command("text");
        check(runtime.frameCounters().measures == baseline.measures + 1, "Text change skipped measurement");
        check(findText(runtime.scene(), "撅: 1") == counter, "Text change replaced the host");
        command("validate");
        for (int index = 0; index < 12; ++index) {
            command("color");
            command("offset");
            command("validate");
        }
        check(runtime.frameCounters().measures == baseline.measures + 1, "Repeated value updates accumulated measure work");
        check(runtime.scene().bindingCount() == bindings && hostView->eventSlotCount() == callbacks, "Repeated value updates leaked native resources");
        const auto first = findText(runtime.scene(), "A");
        const auto second = findText(runtime.scene(), "B");
        command("reorder");
        check(findText(runtime.scene(), "A") == first && findText(runtime.scene(), "B") == second, "Keyed reorder replaced hosts");
        const auto column = runtime.scene().node(1).children.front();
        const auto& children = runtime.scene().node(column).children;
        check(children.size() == 4 && children[1] == second && children[2] == first, "Fragment anchors affected native ordering");
        for (int index = 0; index < 12; ++index) {
            command("remove");
            check(runtime.scene().bindingCount() < bindings && runtime.scene().eventSlotCount() < callbacks, "Branch removal retained native resources");
            command("restore");
            check(runtime.scene().bindingCount() == bindings && hostView->eventSlotCount() == callbacks, "Branch restore leaked resources");
        }
        command("baseline");
        command("color");
        command("validate");
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService textService(measurer);
        arrange::juce::InteractionStateOwner interaction(textService);
        arrange::juce::RuntimeSessionState session;
        arrange::juce::DiagnosticsState diagnostics;
        arrange::juce::PassivePaintRenderer paint;
        arrange::juce::RuntimePackageBinder binder;
        arrange::juce::FramePumpDriver driver;
        session.resize(520, 380, runtime);
        auto oldSubmit = submit;
        for (int iteration = 0; iteration < 4; ++iteration) {
            auto nextHost = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
            auto* nextView = nextHost.get();
            arrange::quickjs::AppScriptLoader nextLoader(*nextHost);
            const auto nextLoaded = nextLoader.loadEntry(std::filesystem::path(argv[1]));
            if (!nextLoaded.ok) throw std::runtime_error(nextLoaded.error);
            arrange::juce::PackageLoadOutcome outcome;
            outcome.loaded = true;
            outcome.intentKind = arrange::juce::PackageLoadOutcome::IntentKind::HmrReload;
            outcome.initialTransaction = nextHost->takePendingTransaction();
            outcome.scriptHost = std::move(nextHost);
            binder.apply(std::move(outcome), session, runtime, diagnostics, interaction, paint);
            runtime.enqueueStringEvent(oldSubmit, "text");
            check(driver.pumpFrame(runtime, session, diagnostics, interaction, paint, 1, {}, {0, 0, 520, 380}, true, {}, timestamp += 16),
                  "HMR did not publish through the production host driver");
            check(!diagnostics.hasError() && findText(runtime.scene(), "撅: 0") != 0, "stale HMR event reached fresh context");
            check(runtime.scene().bindingCount() == bindings && nextView->bindingCount() == bindings && nextView->eventSlotCount() == callbacks,
                  "HMR retained previous context bindings/callbacks");
            check(runtime.publishedFrame().revision == 1 && runtime.frameCounters().publications >= 1, "HMR attachments caused extra publication");
            for (const auto& slot : runtime.scene().activeEventSlots()) if (slot.kind == EventSlotKind::InputSubmit) oldSubmit = slot;
        }
        std::cout << "SFC/Vite/QuickJS/native: value phases, component props, computed/helper/slots, keyed order and retirement passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
