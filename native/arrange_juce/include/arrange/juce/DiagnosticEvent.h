#pragma once

#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct DiagnosticsBadgeModel {
        std::string text;
        ::juce::Colour dot = ::juce::Colour(0xffef4444);
    };

    struct DiagnosticsToastModel {
        LogLevel level = LogLevel::Info;
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

    enum class DiagnosticCategory {
        App,
        HostLive,
        HostDist,
        HostHmr,
        RuntimeScript,
        RuntimeTransaction,
        PipelineFrame,
        PipelineLayout,
        PipelinePaint,
        InputPointer,
        InputKey,
        InputIme,
        InputScroll,
        ResourcePackage,
        ResourceImage,
        ResourceIcon,
        Diagnostics,
    };

    struct DiagnosticEvent {
        std::uint64_t id = 0;
        std::chrono::system_clock::time_point timestamp;
        LogLevel level = LogLevel::Info;
        DiagnosticCategory category = DiagnosticCategory::Diagnostics;
        std::string code;
        std::string message;
        std::string detail;
        std::string source;
        std::string pathOrUrl;
        bool toastRequested = false;
    };

    [[nodiscard]] const char* diagnosticCategoryName(DiagnosticCategory category) noexcept;
    [[nodiscard]] const char* logLevelName(LogLevel level) noexcept;
    [[nodiscard]] int logLevelRank(LogLevel level) noexcept;
    [[nodiscard]] bool diagnosticVisibilityEnabled(DiagnosticVisibility visibility) noexcept;

    struct DiagnosticEventInput {
        LogLevel level = LogLevel::Info;
        DiagnosticCategory category = DiagnosticCategory::Diagnostics;
        std::string code;
        std::string message;
        std::string detail;
        std::string source;
        std::string pathOrUrl;
        bool toast = false;
        bool coalesceToast = true;
    };

    class DiagnosticEventStore final {
    public:
        void configure(std::size_t recentLimit);
        void clear();
        DiagnosticEvent append(DiagnosticEventInput input);
        [[nodiscard]] const std::vector<DiagnosticEvent>& recentEvents() const noexcept { return events_; }

    private:
        std::uint64_t nextId_ = 1;
        std::size_t recentLimit_ = 64;
        std::vector<DiagnosticEvent> events_;
    };

    class DiagnosticLogger final {
    public:
        void configure(DiagnosticsConfig config);
        [[nodiscard]] const DiagnosticsConfig& config() const noexcept { return config_; }
        void setLogLevel(LogLevel level) noexcept { config_.logLevel = level; }
        void setCategoryEnabled(DiagnosticCategory category, bool enabled);
        [[nodiscard]] bool categoryEnabled(DiagnosticCategory category) const;
        [[nodiscard]] bool shouldWrite(const DiagnosticEvent& event) const noexcept;
        void write(const DiagnosticEvent& event) const;

    private:
        DiagnosticsConfig config_;
        std::unordered_map<DiagnosticCategory, bool> categoryEnabled_;
    };

#endif
} // namespace arrange::juce
