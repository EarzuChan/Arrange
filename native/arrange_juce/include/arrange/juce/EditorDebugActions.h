#pragma once

#include <arrange/juce/DiagnosticsTypes.h>

#include <filesystem>
#include <string>
#include <string_view>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;

    struct EditorActionResult {
        bool handled = false;
        bool clearLoaded = false;
    };

    class EditorDebugActions final {
       public:
        [[nodiscard]] EditorActionResult triggerManualDiagnosticError(DiagnosticsState& diagnostics, InteractionStateOwner& interaction, ArrangeRuntime& runtime, const std::filesystem::path& relatedPath) const;

        [[nodiscard]] bool pushManualDiagnosticToast(DiagnosticsState& diagnostics, ArrangeRuntime& runtime) const;

        [[nodiscard]] bool copyDiagnosticsToClipboard(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, DiagnosticsTextContext context) const;

       private:
        static constexpr std::string_view TAG = "EditorDebugActions";
        static void emitToast(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, LogLevel level, std::string title, std::string message = {}, bool coalesce = true);
    };

#endif
}  // namespace arrange::juce
