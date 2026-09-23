#include <arrange/juce/EditorDebugActions.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/core/InputIntent.h>

#include <utility>

namespace arrange::juce {
    EditorActionResult EditorDebugActions::triggerManualDiagnosticError(DiagnosticsState& diagnostics, InteractionStateOwner& interaction, ArrangeRuntime& runtime, const std::filesystem::path& relatedPath) const {
#if defined(NDEBUG)
        (void)diagnostics;
        (void)interaction;
        (void)runtime;
        (void)relatedPath;
        return {};
#else
if (diagnostics.hasError()) return {true, false};

interaction.reset();
diagnostics.setError (makeErrorScreenModel(ErrorSource::ScriptRuntime, "已按下 F7 手动触发调试错误", "此操作用于检查错误屏、重试、重新加载、复制诊断信息和重绘恢复", relatedPath, true));
emitToast(diagnostics, runtime, LogLevel::Error, "手动触发调试错误", "F7 已打开 Arrange 错误屏");
        return {true, true};
#endif
}

bool EditorDebugActions::pushManualDiagnosticToast(DiagnosticsState& diagnostics, ArrangeRuntime& runtime) const {

#if defined(NDEBUG)
(void)diagnostics;
(void)runtime;
        return false;
#else
const auto time = DiagnosticsState::currentLocalTimeLabel();
emitToast(diagnostics, runtime, LogLevel::Info, "手动提示测试", "触发时间 " + time, false);
        return true;
#endif
}

bool EditorDebugActions::copyDiagnosticsToClipboard(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, DiagnosticsTextContext context) const {
    if (!diagnostics.copyErrorDiagnosticsToClipboard(std::move(context))) return false;
    emitToast(diagnostics, runtime, LogLevel::Info, "已复制诊断信息", "错误诊断已复制到剪贴板");
    return true;
}

void EditorDebugActions::emitToast(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, LogLevel level, std::string title, std::string message, bool coalesce) {
    if (DiagnosticsToast::show(diagnostics, level, TAG, std::move(title), std::move(message), coalesce)) runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("editor toast"));
}
} // namespace arrange::juce

#endif
