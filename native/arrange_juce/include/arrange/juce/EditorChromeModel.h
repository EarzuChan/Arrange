#pragma once

#include <arrange/juce/DiagnosticEvent.h>

#include <string>
#include <string_view>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class DiagnosticsState;
    class PackageRuntimeSource;

    class EditorChromeModel final {
    public:
        [[nodiscard]] std::string windowTitle(
            std::string_view baseTitle,
            const PackageRuntimeSource& package,
            const DiagnosticsState& diagnostics) const;

        [[nodiscard]] DiagnosticsBadgeModel diagnosticsBadgeModel(
            const PackageRuntimeSource& package,
            const DiagnosticsState& diagnostics) const;

        [[nodiscard]] DiagnosticsTextContext diagnosticsTextContext(
            const PackageRuntimeSource& package,
            const DiagnosticsState& diagnostics) const;

    private:
        [[nodiscard]] static const char* buildModeLabel() noexcept;
    };

#endif
} // namespace arrange::juce
