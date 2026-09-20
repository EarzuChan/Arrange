#pragma once

#include <arrange/core/SceneFramePipeline.h>
#include <arrange/juce/DiagnosticEvent.h>
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
        explicit PassivePaintRenderer(const arrange::core::TextLayoutService& service) : textLayoutService_(service) {}
        void clearResources();
        void prepareResources(arrange::core::PublishedFrameContent& content);

        void paint(::juce::Graphics& g, const arrange::core::PublishedFrame& frame);
        void setCullingEnabled(bool enabled) noexcept { drawOpsPainter_.setCullingEnabled(enabled); }
        PaintReplayCounters replayCounters() const noexcept { return drawOpsPainter_.counters(); }
        double paintMillis() const noexcept { return paintMillis_; }
        double preparationMillis() const noexcept { return preparationMillis_; }
        std::uint64_t fullViewportPaints() const noexcept { return fullViewportPaints_; }
        const std::string& lastFullPaintReason() const noexcept { return lastFullPaintReason_; }

    private:

        const arrange::core::TextLayoutService& textLayoutService_;
        std::uint64_t fullViewportPaints_ = 0;
        std::string lastFullPaintReason_;
        double paintMillis_ = 0;
        double preparationMillis_ = 0;
        JuceDrawOpsPainter drawOpsPainter_;
    };

#endif
} // namespace arrange::juce
