#pragma once

#include <arrange/core/Painter.h>
#include <arrange/core/UiPackage.h>
#include <filesystem>
#include <cstddef>
#include <string>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>

namespace arrange::juce {
    struct JucePainterContent final : arrange::core::PainterContent {
        ::juce::Image image;
        std::unique_ptr<::juce::Drawable> vector;
        ::juce::Rectangle<float> vectorViewport;
    };

    struct PainterResourceLimits {
        static constexpr std::size_t MaxResourceBytes = 16 * 1024 * 1024;
        static constexpr int MaxTimeoutMs = 5000;
        std::size_t maxBytes = MaxResourceBytes;
        int timeoutMs = MaxTimeoutMs;
    };

    arrange::core::PainterLoader packagePainterLoader(std::filesystem::path packageDir);
    arrange::core::PainterLoader packagePainterLoader(std::shared_ptr<const core::UiPackage> package);
    arrange::core::PainterLoader livePainterLoader(std::string devServerUrl, PainterResourceLimits limits = {});
    core::AssetLoader packageAssetLoader(std::shared_ptr<const core::UiPackage> package);
    core::AssetLoader liveAssetLoader(std::string devServerUrl);
}
#endif
