#include "TextFixtures.h"
#include <arrange/core/LazyLayout.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/TextInputMutationSink.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <cmath>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <utility>

using namespace arrange::core;

namespace {
    void check(bool value, const char* message) {
        if (!value) throw std::runtime_error(message);
    }

    NodeId lazyNode(const NativeScene& scene) {
        for (auto id : scene.tree().nodeIds())
            if (std::holds_alternative<LazyMeasurePolicy>(scene.node(id).measurePolicy)) return id;
        throw std::runtime_error("Lazy 未经正式 Layout 创建");
    }

    bool containsText(const NativeScene& scene, const std::string& text) {
        for (auto id : scene.tree().nodeIds())
            if (test_support::textOf(scene.node(id)) == text) return true;
        return false;
    }

    void fixture(const char* path) {
        auto script = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        auto* host = script.get();
        const auto loaded = arrange::quickjs::AppScriptLoader(*script).loadEntry(path);
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        arrange::juce::ArrangeRuntime runtime;
        runtime.setScriptHost(std::move(script));
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService textLayout(measurer);
        arrange::juce::InteractionStateOwner interaction(textLayout);
        const auto callbacks = arrange::juce::TextInputMutationSink{}.callbacks(runtime);
        runtime.setInteractionPreparation([&](auto& tree) { interaction.prepareLazyInteraction(tree); });
        double time = 0;
        std::string step = "首次材料化";
        const auto tick = [&] {
            std::optional<arrange::juce::InteractionStateOwner> candidateInteraction;
            const auto result = runtime.pumpFrame(1, {0, 320, 0, 350}, time += 16, [&](const auto& scene, auto& frame) {
                candidateInteraction.emplace(interaction);
                candidateInteraction->synchronizePublishedInput(scene.tree(), true);
                candidateInteraction->synchronizePublishedFocus(scene.tree(), true);
                candidateInteraction->updateFocusedInputViewport(scene.tree(), true);
                frame.content.focusedInputNode = candidateInteraction->textFocusedNode();
                frame.content.focusedInputModifier = candidateInteraction->focusedModifier();
            });
            if (!result.ok) throw std::runtime_error(step + ": " + result.error);
            if (candidateInteraction) {
                interaction.commitState(std::move(*candidateInteraction));
                interaction.dispatchCommittedFocus(runtime.scene().tree(), callbacks);
            }
        };
        const auto settle = [&] {
            for (int count = 0; count < 32 && runtime.hasPendingFrameWork(); ++count) tick();
            check(!runtime.hasPendingFrameWork(), "Lazy 反馈或材料化未能稳定");
        };
        settle();
        auto id = lazyNode(runtime.scene());
        const auto& initial = runtime.scene().node(id);
        check(initial.lazy && initial.lazy->snapshot.totalItemsCount == 10000, "Lazy 未发布可见项元数据");
        check(initial.children.size() < 64 && runtime.scene().tree().size() < 260, "Lazy 首帧全量创建了离屏业务项");
        check(containsText(runtime.scene(), "项:0:0"), "Lazy 普通 SFA itemContent/显式 props 未创建");
        EventSlotId submit;
        EventSlotId click;
        for (auto node : runtime.scene().tree().nodeIds()) {
            const auto slot = test_support::event(runtime.scene().node(node), EventSlotKind::InputSubmit);
            if (slot.valid()) submit = slot;
            if (test_support::textOf(runtime.scene().node(node)) == "项:0:0") click = test_support::event(runtime.scene().node(node), EventSlotKind::Click);
        }
        check(submit.valid() && click.valid(), "Lazy 测试事件未注册");
        runtime.enqueueEvent(click);
        settle();
        check(containsText(runtime.scene(), "项:0:1"), "Lazy 业务局部状态未更新");
        const auto command = [&](const char* value) {
            step = value;
            runtime.enqueueStringEvent(submit, value);
            settle();
        };
        command("pixel");
        check(runtime.scene().node(id).lazy->snapshot.firstVisibleItemIndex > 1000, "PX 滚动未触发 Lazy 可见范围重新材料化");
        command("jump");
        id = lazyNode(runtime.scene());
        check(runtime.scene().node(id).lazy->snapshot.firstVisibleItemIndex == 9000, "大跳转未在同帧正确材料化请求项");
        check(std::abs(runtime.scene().node(id).lazy->snapshot.firstVisibleItemScrollOffset - 5) < 0.1f, "可变尺寸补测丢失跳转项偏移");
        check(runtime.scene().node(id).children.size() < 64, "大跳转创建了中间所有项");
        NodeId input = 0;
        for (const auto node : runtime.scene().tree().nodeIds())
            if (test_support::editable(runtime.scene().node(node)) && test_support::textOf(runtime.scene().node(node)) == "焦点9000") input = node;
        check(input && interaction.requestFocus(runtime.scene().tree(), input, callbacks), "稳定 key Input 无法获得焦点");
        check(interaction.setHighlightedRegion(runtime.scene().tree(), true, {0, 2}, callbacks), "重排前无法设置 Input 选区");
        check(interaction.insertTextAtCaret(runtime.scene().tree(), true, juce::String::fromUTF8("候选"), callbacks), "重排前无法设置 IME preedit");
        check(interaction.setTemporaryUnderlining(runtime.scene().tree(), true, juce::Array<juce::Range<int>>{juce::Range<int>{0, 2}}, callbacks), "重排前无法标记 IME preedit");
        check(interaction.setHighlightedRegion(runtime.scene().tree(), true, {0, 1}, callbacks), "重排前无法保留 IME 选区");
        const auto inputGeneration = runtime.scene().node(input).generation;
        const auto inputModifier = interaction.focusedModifier();
        const auto selection = interaction.highlightedRegion(runtime.scene().tree(), true);
        const auto checkFocusedIdentity = [&] {
            check(runtime.scene().contains(input) && runtime.scene().node(input).generation == inputGeneration && interaction.textFocusedNode() == input && interaction.focusedModifier() == inputModifier, "数据重排退挂了仍被焦点与 IME 持有的稳定 key Input");
            check(interaction.highlightedRegion(runtime.scene().tree(), true) == selection && interaction.textInRange(runtime.scene().tree(), true, {0, 6}) == juce::String::fromUTF8("候选9000"), "数据重排丢失了 Input 选区或 IME preedit");
        };
        command("insert");
        check(runtime.scene().node(id).lazy->snapshot.firstVisibleItemIndex == 9001 && containsText(runtime.scene(), "项:9000:0"), "前插项未保持稳定 key 锚点");
        checkFocusedIdentity();
        command("reverse");
        check(containsText(runtime.scene(), "项:9000:0") && runtime.scene().node(id).lazy->snapshot.firstVisibleItemIndex == 999, "重排未按 key 保持首项");
        checkFocusedIdentity();
        check(interaction.keyPressed(runtime.scene().tree(), true, juce::KeyPress(juce::KeyPress::escapeKey), callbacks) && interaction.textInRange(runtime.scene().tree(), true, {0, 6}) == juce::String::fromUTF8("焦点9000"), "重排后的 IME cancel 没有恢复原事务文本");
        interaction.clearFocus(runtime.scene().tree(), callbacks);
        command("start");
        check(runtime.scene().node(id).lazy->snapshot.firstVisibleItemIndex == 0, "返回首项失败");
        command("animate");
        check(runtime.scene().node(id).lazy->snapshot.firstVisibleItemIndex == 100, "Lazy 动画未复用帧时钟并最终校正到请求项");
        command("start");
        command("row");
        id = lazyNode(runtime.scene());
        check(std::get<LazyMeasurePolicy>(runtime.scene().node(id).measurePolicy).horizontal && !std::get<LazyMeasurePolicy>(runtime.scene().node(id).measurePolicy).grid, "LazyRow 未复用单一布局与滚动链路");
        command("verticalGrid");
        id = lazyNode(runtime.scene());
        check(runtime.scene().node(id).lazy->cells == 3 && std::get<LazyMeasurePolicy>(runtime.scene().node(id).measurePolicy).grid, "Fixed Lazy 网格列数错误");
        command("horizontalGrid");
        id = lazyNode(runtime.scene());
        check(runtime.scene().node(id).lazy->cells >= 1 && std::get<LazyMeasurePolicy>(runtime.scene().node(id).measurePolicy).horizontal, "Adaptive Lazy 网格未通过双通道单位解析");
        check(runtime.scene().tree().size() < 600 && host->bindingCount() < 2000, "Lazy 缓存未限制活动原生实例或绑定");
        const auto revision = runtime.publishedFrame().revision;
        const auto size = runtime.scene().tree().size();
        runtime.enqueueStringEvent(submit, "bad");
        const auto failed = runtime.pumpFrame(1, {0, 320, 0, 350}, time += 16);
        check(!failed.ok && runtime.publishedFrame().revision == revision && runtime.scene().tree().size() == size, "失败 Lazy 候选污染已发布帧");
    }
}

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI initialise;
    try {
        check(argc == 2, "需要 Lazy SFA 夹具路径");
        fixture(argv[1]);
        std::cout << "M3 Lazy 四容器、可变尺寸、key 锚点、缓存与原子提交通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
