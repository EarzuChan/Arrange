#pragma once

#include <arrange/core/LayoutNode.h>
#include <arrange/juce/DiagnosticsTypes.h>

#include <filesystem>
#include <string_view>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class PassivePaintRenderer;
    class DiagnosticsState;
    class InteractionStateOwner;
    class RuntimeSessionState;

    class FramePumpDriver final {
       public:
        [[nodiscard]] bool pumpFrame(ArrangeRuntime& runtime, RuntimeSessionState& session, DiagnosticsState& diagnostics, InteractionStateOwner& interaction, PassivePaintRenderer& paint, arrange::core::NodeId root, const std::filesystem::path& frameErrorPath, ::juce::Rectangle<int> diagnosticsBounds, bool detailedErrorScreen, const DiagnosticsBadgeModel& badgeModel, double nowMillis) const;

       private:
        static constexpr std::string_view TAG = "FramePumpDriver";
        [[nodiscard]] static bool tickDiagnostics(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, double nowMillis);
    };

#endif
}  // namespace arrange::juce
