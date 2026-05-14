#pragma once

#include <arrange/core/Node.h>
#include <arrange/juce/DiagnosticEvent.h>
#include <arrange/juce/ImageResourceCache.h>
#include <arrange/juce/JuceDrawOpsPainter.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <filesystem>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;

    class PassivePaintRenderer final {
    public:
        void setPackageDir(const std::filesystem::path& packageDir);
        void clearResources();
        [[nodiscard]] bool prepareResources(
            ArrangeRuntime& runtime,
            DiagnosticsState& diagnostics);

        void paint(
            ::juce::Graphics& g,
            ::juce::Rectangle<int> bounds,
            const ArrangeRuntime& runtime,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction,
            arrange::core::NodeId root,
            bool loaded,
            bool detailedErrorScreen,
            const DiagnosticsBadgeModel& badgeModel);

    private:
        void paintDiagnostics(
            ::juce::Graphics& g,
            const ArrangeRuntime& runtime,
            const ImageResourceCache& imageResources) const;

        JuceDrawOpsPainter drawOpsPainter_;
        ImageResourceCache imageResources_;
    };

#endif
} // namespace arrange::juce
