#pragma once

#include <arrange/core/Node.h>
#include <arrange/juce/DiagnosticsOverlay.h>

#include <filesystem>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;
    class RuntimeSessionState;

    class FramePumpDriver final {
    public:
        [[nodiscard]] bool pumpFrame(
            ArrangeRuntime& runtime,
            RuntimeSessionState& session,
            DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            arrange::core::NodeId root,
            const std::filesystem::path& frameErrorPath,
            ::juce::Rectangle<int> diagnosticsBounds,
            bool detailedErrorScreen,
            const DiagnosticsBadgeModel& badgeModel,
            double nowMillis) const;

    private:
        [[nodiscard]] static bool prepareInteractionFrame(
            ArrangeRuntime& runtime,
            RuntimeSessionState& session,
            DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction);
        [[nodiscard]] static bool tickDiagnostics(
            DiagnosticsState& diagnostics,
            ArrangeRuntime& runtime,
            double nowMillis);
        [[nodiscard]] static bool validateLoadedScene(
            ArrangeRuntime& runtime,
            RuntimeSessionState& session,
            DiagnosticsState& diagnostics,
            arrange::core::NodeId root);
        [[nodiscard]] static bool prepareDiagnosticsFrame(
            ArrangeRuntime& runtime,
            DiagnosticsState& diagnostics,
            ::juce::Rectangle<int> diagnosticsBounds,
            bool detailedErrorScreen,
            const DiagnosticsBadgeModel& badgeModel);
    };

#endif
} // namespace arrange::juce
