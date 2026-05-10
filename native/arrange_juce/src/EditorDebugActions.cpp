#include <arrange/juce/EditorDebugActions.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/core/InputIntent.h>

#include <utility>

namespace arrange::juce {
    EditorActionResult EditorDebugActions::triggerManualDiagnosticError(
        DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        ArrangeRuntime& runtime,
        const std::filesystem::path& relatedPath) const {
#if defined(NDEBUG)
        (void)diagnostics;
        (void)interaction;
        (void)runtime;
        (void)relatedPath;
        return {};
#else
        if (diagnostics.hasError()) {
            return {true, false};
        }

        interaction.reset();
        diagnostics.setError(makeErrorScreenModel(
            ErrorSource::ScriptRuntime,
            "Manual debug error triggered by F7.",
            "This is an intentional Arrange diagnostic error probe for testing error screen, retry/reload, copy diagnostics and repaint recovery.",
            relatedPath,
            true));
        emitDiagnostic(
            diagnostics,
            runtime,
            LogLevel::Error,
            "Manual debug error",
            "F7 intentionally opened the Arrange error screen.",
            true);
        return {true, true};
#endif
    }

    bool EditorDebugActions::pushManualDiagnosticToast(
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime) const {
#if defined(NDEBUG)
        (void)diagnostics;
        (void)runtime;
        return false;
#else
        const auto time = DiagnosticsState::currentLocalTimeLabel();
        emitDiagnostic(
            diagnostics,
            runtime,
            LogLevel::Info,
            "Manual toast probe",
            "F6 at " + time,
            true,
            false);
        return true;
#endif
    }

    bool EditorDebugActions::copyDiagnosticsToClipboard(
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime,
        DiagnosticsTextContext context) const {
        if (!diagnostics.copyErrorDiagnosticsToClipboard(std::move(context))) {
            return false;
        }
        emitDiagnostic(
            diagnostics,
            runtime,
            LogLevel::Info,
            "Copied diagnostics",
            "Error diagnostics copied to clipboard.",
            true);
        return true;
    }

    void EditorDebugActions::emitDiagnostic(
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime,
        LogLevel level,
        std::string title,
        std::string message,
        bool toast,
        bool coalesceToast) {
        if (diagnostics.emit(level, std::move(title), std::move(message), toast, coalesceToast)) {
            runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("editor diagnostic event"));
        }
    }
} // namespace arrange::juce

#endif
