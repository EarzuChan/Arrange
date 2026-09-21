#include "TextFixtures.h"
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/RuntimeSessionState.h>
#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/EditorSceneHost.h>
#include <arrange/juce/TextInputOwner.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/core/ModifierGeometry.h>
#include <arrange/quickjs/AppScriptLoader.h>
#include <arrange/quickjs/QuickJsScriptHost.h>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    bool hasText(const NativeScene& scene, const std::string& text) {
        for (const auto id : scene.tree().nodeIds())
            if (test_support::textOf(scene.node(id)) == text) return true;
        return false;
    }
}

int main(int argc, char** argv) {
    try {
        ::juce::ScopedJuceInitialiser_GUI juce;
        check(argc == 2, "需要视口 SFA 夹具路径");
        auto script = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        const auto loaded = arrange::quickjs::AppScriptLoader(*script).loadEntry(argv[1]);
        check(loaded.ok, "视口夹具加载失败");
        auto initial = script->takePendingTransaction();
        check(!initial.has_value(), "视口夹具绕过首帧授权");
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService textService(measurer);
        arrange::juce::ArrangeRuntime runtime{SceneFramePipeline{LayoutEngine{textService}}};
        arrange::juce::RuntimeSessionState session;
        runtime.setScriptHost(std::move(script));
        if (initial) runtime.enqueue(std::move(*initial));
        session.resize(200, 100, runtime);
        double time = 0;
        const auto tick = [&] {
            const auto result = runtime.pumpFrame(1, session.constraints(), time += 16);
            if (!result.ok) throw std::runtime_error(result.error);
        };
        const auto settle = [&] {
            for (int count = 0; count < 12 && runtime.hasPendingFrameWork(); ++count) tick();
            check(!runtime.hasPendingFrameWork(), "滚动范围反馈没有稳定，存在回传循环");
        };
        settle();
        check(hasText(runtime.scene(), "450/500/100/600"), "首次布局没有通过真实 ScrollState 更新模板");
        NodeId scrollNode = 0;
        EventSlotId submit;
        for (const auto id : runtime.scene().tree().nodeIds()) {
            if (ScrollDispatcher::hasVerticalScroll(runtime.scene().node(id))) scrollNode = id;
            const auto slot = test_support::event(runtime.scene().node(id), EventSlotKind::InputSubmit);
            if (slot.valid()) submit = slot;
        }
        check(scrollNode && submit.valid(), "夹具缺少滚动实例或输入槽");
        const auto original = runtime.scene().node(scrollNode).modifier.elements().back().handle;
        const auto measureBefore = runtime.frameCounters().measures;

        session.resize(200, 100, runtime);
        check(!runtime.hasPendingFrameWork(), "相同视口重复制造了帧需求");
        session.resize(210, 150, runtime);
        session.resize(220, 180, runtime);
        session.resize(240, 200, runtime);
        check(runtime.hasPendingFrameWork(), "空闲后的视口变化没有唤醒帧");
        tick();
        check(runtime.frameCounters().measures == measureBefore + 1, "同帧视口变化没有按最新尺寸合并布局");
        check(ScrollDispatcher::verticalScrollValue(runtime.scene().node(scrollNode)) == 400, "视口放大后的第一帧没有立即限制滚动偏移");
        settle();
        check(hasText(runtime.scene(), "400/400/200/600"), "视口放大没有反应式回传范围和修正值");
        check(runtime.scene().node(scrollNode).modifier.elements().back().handle == original, "视口变化替换了滚动实例");

        session.resize(300, 700, runtime);
        tick();
        check(ScrollDispatcher::verticalScrollValue(runtime.scene().node(scrollNode)) == 0, "内容可完全显示时没有立即回到合法位置");
        settle();
        check(hasText(runtime.scene(), "0/0/700/700"), "扩展后的视口范围未回传");
        session.resize(200, 100, runtime);
        settle();
        runtime.enqueueStringEvent(submit, "缩短");
        settle();
        check(hasText(runtime.scene(), "0/0/100/100"), "内容尺寸变化没有更新滚动范围");
        runtime.enqueueStringEvent(submit, "越界");
        settle();
        check(hasText(runtime.scene(), "0/0/100/100"), "代码设置的越界滚动没有经过统一布局反馈修正");

        runtime.enqueueStringEvent(submit, "密度");
        settle();
        check(hasText(runtime.scene(), "0/500/100/600"), "DP 转换后的滚动范围没有以 PX 回传");
        NodeId inputNode = 0;
        for (const auto id : runtime.scene().tree().nodeIds())
            if (test_support::editable(runtime.scene().node(id))) inputNode = id;
        const auto& node = runtime.scene().node(inputNode);
        const auto* field = test_support::editable(node);
        const auto& descriptor = std::get<TextFieldModifier>(field->descriptor.value);
        check(node.bounds.width == 160 && node.bounds.height == 60 && descriptor.presentation.style.fontSize == 30, "DP 与 SP 未分别转换到原生 PX");
        auto& tree = runtime.scene().tree();
        const auto point = nodeContentToRoot(tree, inputNode, {node.contentBounds.x + 1, node.contentBounds.y + 1});
        const auto hit = HitTester{}.hitTest(*runtime.publishedFrame().content.hitTest, point);
        check(hit.hit && hit.node == inputNode, "非恒等 Density 的输入命中坐标不一致");
        arrange::juce::TextInputOwner input(textService);
        input.pointerDown(tree, hit, point.x, point.y, {});
        const auto caret = input.caretRectangleForCharIndex(tree, true, 1);
        check(input.charIndexForPoint(tree, true, caret.getCentre()) == 1, "非恒等 Density 的 IME 与文字几何不一致");

        arrange::juce::EditorSceneHost editor;
        arrange::juce::EditorConfig config;
        config.app.useDist(std::filesystem::path(argv[1]).parent_path());
        config.diagnostics.badge = arrange::juce::DiagnosticVisibility::Hidden;
        config.diagnostics.toasts = arrange::juce::DiagnosticVisibility::Hidden;
        editor.configure(config);
        editor.resized(200, 100);
        for (int count = 0; count < 12 && editor.wantsVBlank(); ++count) (void)editor.pumpFrame(time += 16);
        check(!editor.wantsVBlank(), "宿主空闲后仍持续请求帧");
        editor.resized(300, 200);
        check(editor.wantsVBlank() && editor.pumpFrame(time += 16), "宿主尺寸通知没有发布新画面");
        ::juce::Image image(::juce::Image::ARGB, 300, 200, true, ::juce::SoftwareImageType{});
        {
            ::juce::Graphics graphics(image);
            editor.paint(graphics, {0, 0, 300, 200});
        }
        check(image.getPixelAt(290, 190).getARGB() == 0xff336699, "放大后的新区域仍未绘制内容");
        std::cout << "视口、内容尺寸、滚动范围、响应式回传及宿主绘制链路通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
