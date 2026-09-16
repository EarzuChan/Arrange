#pragma once

#include <arrange/core/SceneFramePipeline.h>
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
        void prepareResources(const arrange::core::PublishedFrameContent& content);

        void paint(::juce::Graphics& g, const arrange::core::PublishedFrame& frame);

    private:

        JuceDrawOpsPainter drawOpsPainter_;
        ImageResourceCache imageResources_;
    };

#endif
} // namespace arrange::juce
