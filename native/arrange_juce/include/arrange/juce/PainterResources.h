#pragma once

#include <arrange/core/Painter.h>
#include <filesystem>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>

namespace arrange::juce {
    struct JucePainterContent final : arrange::core::PainterContent {
        ::juce::Image image;
        std::unique_ptr<::juce::Drawable> vector;
        ::juce::Rectangle<float> vectorViewport;
    };

    arrange::core::PainterLoader packagePainterLoader(std::filesystem::path packageDir);
}  // namespace arrange::juce
#endif
