#pragma once

#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/ErrorScreenModel.h>

#include <filesystem>
#include <string>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct DiagnosticsBadgeModel {
        std::string text;
        ::juce::Colour dot = ::juce::Colour(0xffef4444);
    };

    struct DiagnosticsToastModel {
        arrange::LogLevel level = arrange::LogLevel::Info;
        std::string title;
        std::string message;
    };

    struct DiagnosticsTextContext {
        std::string activeSource;
        bool liveRuntimeEnabled = false;
        bool hasLive = false;
        bool hasDist = false;
        std::string devServerUrl;
        std::filesystem::path appPath;
        const arrange::ErrorScreenModel* error = nullptr;
    };

    [[nodiscard]] bool diagnosticVisibilityEnabled(DiagnosticVisibility visibility) noexcept;

#endif
}  // namespace arrange::juce
