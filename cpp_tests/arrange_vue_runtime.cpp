#include <arrange/core/Modifier.h>
#include <arrange/core/PropValue.h>
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
#include <algorithm>
#include <chrono>
#include <numeric>
#include "AllocationProbe.h"

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    NodeId findText(const NativeScene& scene, const std::string& value) {
        std::vector<NodeId> pending{1};
        while (!pending.empty()) {
            const auto id = pending.back();
            pending.pop_back();
            if (!scene.contains(id)) continue;
            if (scene.node(id).text == value) return id;
            const auto& children = scene.node(id).children;
            pending.insert(pending.end(), children.begin(), children.end());
        }
        throw std::runtime_error("未找到文本：" + value);
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
        const auto counter = findText(runtime.scene(), "撅了啊 0 次");
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
        const auto steadyBindings = runtime.scene().bindingCount();
        command("text");
        check(runtime.frameCounters().measures == baseline.measures + 1, "Text change skipped measurement");
        check(findText(runtime.scene(), "撅了啊 1 次") == counter, "文本变化错误替换了宿主节点");
        command("validate");
        for (int index = 0; index < 12; ++index) {
            command("color");
            command("offset");
            command("validate");
        }
        check(runtime.frameCounters().measures == baseline.measures + 1, "Repeated value updates accumulated measure work");
        check(runtime.scene().bindingCount() == steadyBindings && hostView->eventSlotCount() == callbacks, "Repeated value updates leaked native resources");
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
        const auto galleryBaselineBindings = runtime.scene().bindingCount();
        const auto galleryBaselineCallbacks = runtime.scene().eventSlotCount();
        const auto galleryBaselineNodes = runtime.scene().tree().size();
        command("lifetime-baseline");
        command("async-start");
        check(runtime.hasPendingAnimationFrame(), "异步加载延迟没有请求宿主帧");
        command("baseline");
        command("baseline");
        findText(runtime.scene(), "延迟加载提示");
        command("async-finish");
        findText(runtime.scene(), "延迟加载完成");
        check(!runtime.hasPendingAnimationFrame(), "加载完成后保留了延迟帧需求");
        command("async-remove");
        command("async-start");
        for (int index = 0; index < 7; ++index) command("baseline");
        findText(runtime.scene(), "延迟加载超时");
        check(!runtime.hasPendingAnimationFrame(), "加载超时后保留了延迟帧需求");
        command("async-remove");
        command("async-start");
        command("async-remove");
        command("async-finish");
        check(runtime.scene().bindingCount() == galleryBaselineBindings && !runtime.hasPendingAnimationFrame(), "卸载后的迟到加载重新挂载或保留了帧需求");

        command("gallery");
        command("gallery:baseline");
        const auto colorBaseline = runtime.frameCounters();
        command("gallery:color");
        for (int i = 0; i < 24; ++i) {
            const auto sample = runtime.pumpFrame(1, constraints, timestamp += 16);
            if (!sample.ok) throw std::runtime_error(sample.error);
        }
        command("gallery:validate-color");
        check(runtime.frameCounters().measures == colorBaseline.measures && runtime.frameCounters().placements == colorBaseline.placements, "real gallery color animation ran geometry phases");
        check(runtime.frameCounters().paintBuilds > colorBaseline.paintBuilds + 10, "real gallery did not publish intermediate animation samples");
        check(runtime.frameCounters().paintWork.layersBuilt - colorBaseline.paintWork.layersBuilt <= 24, "gallery color rebuilt unrelated Modifier layers");
        NodeId focusedInput = 0;
        for (NodeId id = 1; id < 1024; ++id) if (runtime.scene().contains(id) && runtime.scene().node(id).type == NodeType::Input && stringProp(runtime.scene().node(id), "modelValue", "") == "编辑我，如果我彻底离场会被重置") focusedInput = id;
        check(focusedInput != 0, "gallery focus input is missing");
        auto inputTree = runtime.scene().tree();
        const auto inputBounds = inputTree.node(focusedInput).contentBounds;
        interaction.pointerDown(inputTree, *runtime.publishedFrame().content.hitTest, inputBounds.x + 10, inputBounds.y + 10, {});
        check(interaction.focusedNode() == focusedInput, "gallery input could not acquire focus");
        command("gallery:all");
        interaction.synchronizePublishedInput(runtime.scene().tree(), true);
        check(!interaction.focusedNode(), "exiting AnimatedVisibility retained native input focus");
        for (const auto& region : runtime.publishedFrame().content.hitTest->regions) check(region.target.node != focusedInput, "exiting AnimatedVisibility retained hit regions");
        for (int i = 0; i < 4; ++i) {
            const auto sample = runtime.pumpFrame(1, constraints, timestamp += 16);
            if (!sample.ok) throw std::runtime_error(sample.error);
        }
        check(runtime.scene().tree().activeAnimationCount() > 0, "gallery content-size animation did not join native frame clock");
        command("reorder");
        command("gallery:visibility"); // reverse an exit before retirement
        for (int i = 0; i < 180 && runtime.hasPendingFrameWork(); ++i) {
            const auto sample = runtime.pumpFrame(1, constraints, timestamp += 16);
            if (!sample.ok) throw std::runtime_error(sample.error);
        }
        command("gallery:validate-settled");
        check(!runtime.hasPendingAnimationFrame() && runtime.scene().tree().activeAnimationCount() == 0, "gallery did not release animation frame demand");
        command("gallery:all");
        command("gallery-remove");
        check(!runtime.hasPendingAnimationFrame(), "removing gallery retained animated scopes");
        check(runtime.scene().bindingCount() == galleryBaselineBindings && runtime.scene().eventSlotCount() == galleryBaselineCallbacks, "gallery removal leaked binding or callback resources");

        command("showcase");
        const auto firstTrack = findText(runtime.scene(), "001  音轨 1");
        const auto trackHandles = handles(runtime.scene().node(firstTrack));
        command("showcase:reverse");
        check(findText(runtime.scene(), "001  音轨 1") == firstTrack && handles(runtime.scene().node(firstTrack)) == trackHandles, "真实列表重排丢失节点或 Modifier 身份");

        command("showcase:editor");
        const auto retainedCount = runtime.scene().bindingCount();
        command("showcase:list");
        command("showcase:editor");
        check(runtime.scene().bindingCount() == retainedCount, "KeepAlive 激活累计了原生绑定");
        command("showcase:async");
        findText(runtime.scene(), "详情正在等待，点击完成加载");
        command("showcase:resolve");
        findText(runtime.scene(), "详情已就绪 2");
        command("showcase:list");

        std::vector<double> durations;
        durations.reserve(240);
        arrange::test::AllocationStats nativeAllocations;
        command("perf-baseline");
        const auto memoryBefore = hostView->memoryStats();
        const auto workBefore = runtime.frameCounters();
        for (int index = 0; index < 240; ++index) {
            arrange::test::beginAllocationProbe();
            const auto started = std::chrono::steady_clock::now();
            if (index % 60 == 0) command("showcase:restore");
            else if (index % 48 == 0) command("showcase:remove");
            else if (index % 36 == 0) command("showcase:reverse");
            else if (index % 24 == 0) command("showcase:tone");
            else if (index % 12 == 0) command("showcase:select");
            else {
                const auto frame = runtime.pumpFrame(1, constraints, timestamp += 16);
                if (!frame.ok) throw std::runtime_error(frame.error);
            }
            const auto elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
            const auto allocations = arrange::test::endAllocationProbe();
            nativeAllocations.count += allocations.count;
            nativeAllocations.bytes += allocations.bytes;
            durations.push_back(elapsed);
        }
        const auto memoryAfter = hostView->memoryStats();
        const auto workAfter = runtime.frameCounters();
        command("perf-report");
        for (const auto& event : hostView->takeDiagnosticEvents()) {
            if (event.message.starts_with("M23_JS_PERF ")) std::cout << event.message << '\n';
        }
        std::sort(durations.begin(), durations.end());
        std::cout << "M23_PERF {\"frames\":" << durations.size() << ",\"mean_ms\":" << std::accumulate(durations.begin(), durations.end(), 0.0) / durations.size() << ",\"p95_ms\":" << durations[durations.size() * 95 / 100] << ",\"max_ms\":" << durations.back() << ",\"cpp_new_count\":" << nativeAllocations.count << ",\"cpp_new_bytes\":" << nativeAllocations.bytes << ",\"js_allocations\":" << memoryAfter.allocations - memoryBefore.allocations << ",\"js_allocated_bytes\":" << memoryAfter.allocatedBytes - memoryBefore.allocatedBytes << ",\"js_live_bytes\":" << memoryAfter.liveBytes << ",\"measure\":" << workAfter.measures - workBefore.measures << ",\"place\":" << workAfter.placements - workBefore.placements << ",\"paint\":" << workAfter.paintBuilds - workBefore.paintBuilds << ",\"hit\":" << workAfter.hitBuilds - workBefore.hitBuilds << ",\"copied_nodes\":" << workAfter.candidateNodesCopied - workBefore.candidateNodesCopied << "}\n";

        command("showcase:async");
        command("showcase-remove");
        check(runtime.scene().bindingCount() == galleryBaselineBindings && runtime.scene().eventSlotCount() == galleryBaselineCallbacks, "整页删除后绑定和回调未回落");
        check(runtime.scene().tree().activeAnimationCount() == 0 && !runtime.hasPendingAnimationFrame(), "整页删除后动画仍请求下一帧");
        check(runtime.scene().tree().size() == galleryBaselineNodes, "整页删除后原生节点及其 Modifier 实例未退休");
        command("lifetime-check");
        const auto performance = runtime.frameCounters();
        std::cout << "Gallery work: measured=" << performance.layoutWork.measuredNodes << ", measure-cache=" << performance.layoutWork.measureCacheHits
                  << ", paint-layers=" << performance.paintWork.layersBuilt << ", layer-cache=" << performance.paintWork.layerCacheHits
                  << ", measure-ms=" << performance.measureMillis << ", paint-ms=" << performance.paintBuildMillis << '\n';
        arrange::juce::RuntimeSessionState session;
        arrange::juce::DiagnosticsState diagnostics;
        arrange::juce::PassivePaintRenderer paint;
        arrange::juce::RuntimePackageBinder binder;
        arrange::juce::FramePumpDriver driver;
        session.resize(520, 380, runtime);
        auto oldSubmit = submit;
        for (int iteration = 0; iteration < 4; ++iteration) {
            // Replace a live context while JS and native animations own resources.
            runtime.enqueueStringEvent(oldSubmit, "gallery");
            auto running = runtime.pumpFrame(1, constraints, timestamp += 16);
            if (!running.ok) throw std::runtime_error(running.error);
            runtime.enqueueStringEvent(oldSubmit, "gallery:all");
            running = runtime.pumpFrame(1, constraints, timestamp += 16);
            if (!running.ok) throw std::runtime_error(running.error);
            check(runtime.hasPendingAnimationFrame(), "HMR setup did not start animation");
            for (const auto* operation : {"showcase", "showcase:tone", "showcase:async", "async-start"}) {
                runtime.enqueueStringEvent(oldSubmit, operation);
                running = runtime.pumpFrame(1, constraints, timestamp += 16);
                if (!running.ok) throw std::runtime_error(running.error);
            }
            auto nextHost = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
            auto* nextView = nextHost.get();
            arrange::quickjs::AppScriptLoader nextLoader(*nextHost);
            const auto nextLoaded = nextLoader.loadEntry(std::filesystem::path(argv[1]));
            if (!nextLoaded.ok) throw std::runtime_error(nextLoaded.error);
            arrange::juce::PackageLoadOutcome outcome;
            outcome.loaded = true;
            outcome.packageDir = std::filesystem::path(argv[1]).parent_path();
            outcome.intentKind = arrange::juce::PackageLoadOutcome::IntentKind::HmrReload;
            outcome.initialTransaction = nextHost->takePendingTransaction();
            outcome.scriptHost = std::move(nextHost);
            binder.apply(std::move(outcome), session, runtime, diagnostics, interaction, paint);
            runtime.enqueueStringEvent(oldSubmit, "text");
            check(driver.pumpFrame(runtime, session, diagnostics, interaction, paint, 1, {}, {0, 0, 520, 380}, true, {}, timestamp += 16),
                  "HMR did not publish through the production host driver");
            check(!diagnostics.hasError() && findText(runtime.scene(), "撅了啊 0 次") != 0, "stale HMR event reached fresh context");
            check(runtime.scene().bindingCount() == bindings && nextView->bindingCount() == bindings && nextView->eventSlotCount() == callbacks,
                  "HMR retained previous context bindings/callbacks");
            check(runtime.publishedFrame().revision == 1 && runtime.frameCounters().publications >= 1, "HMR attachments caused extra publication");
            for (const auto& slot : runtime.scene().activeEventSlots()) if (slot.kind == EventSlotKind::InputSubmit) oldSubmit = slot;
        }
        runtime.enqueueStringEvent(oldSubmit, "bad-resource");
        (void)driver.pumpFrame(runtime, session, diagnostics, interaction, paint, 1, {}, {0, 0, 520, 380}, true, {}, timestamp += 16);
        check(diagnostics.hasError() && diagnostics.error()->summary.find("FrameApp.vue:") != std::string::npos && diagnostics.error()->summary.find("missing-m23-image.png") != std::string::npos, "资源准备失败丢失了资源路径或 SFC 来源");
        check(runtime.publishedFrame().content.errorFrame.has_value(), "资源错误没有经过正式发布边界");
        std::cout << "SFC/Vite/QuickJS/native: value phases, component props, computed/helper/slots, keyed order and retirement passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
