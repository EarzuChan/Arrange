#pragma once

#include <memory>
#include <string>
#include <utility>
#include <atomic>
#include "App.h"

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#endif

namespace arrange::juce {
    struct WindowConfig {
        std::string title = "Arrange Demo";
        bool resizable = false;
        bool useCornerResizer = false;
        int minWidth = 320;
        int minHeight = 200;
        int maxWidth = 4096;
        int maxHeight = 4096;
    };

    enum class DiagnosticVisibility {
        Hidden,
        DebugOnly,
        Always,
    };

    enum class LogLevel {
        Trace,
        Debug,
        Info,
        Warn,
        Error,
    };

    struct DiagnosticsConfig {
        DiagnosticVisibility badge = DiagnosticVisibility::DebugOnly;
        DiagnosticVisibility toasts = DiagnosticVisibility::DebugOnly;
        bool errorScreen = true;
        LogLevel logLevel = LogLevel::Info;
        std::string logFile;
        bool copyFullDiagnosticsInRelease = true;
    };

    struct EditorConfig {
        App app;
        bool preferDevServer = false;
        std::string devServerUrl;
        int width = 520;
        int height = 300;
        WindowConfig window;
        DiagnosticsConfig diagnostics;
    };

#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeEditor final : public ::juce::AudioProcessorEditor, public ::juce::TextInputTarget, private ::juce::Timer {
    public:
        explicit ArrangeEditor(::juce::AudioProcessor& processor);
        ArrangeEditor(::juce::AudioProcessor& processor, EditorConfig config);
        ~ArrangeEditor() override;

        void configure(EditorConfig config);
        void reload();
        const EditorConfig& config() const noexcept { return config_; }

        void paint(::juce::Graphics& g) override;
        void resized() override;
        void parentHierarchyChanged() override;
        void mouseDown(const ::juce::MouseEvent& event) override;
        void mouseDrag(const ::juce::MouseEvent& event) override;
        void mouseUp(const ::juce::MouseEvent& event) override;
        void mouseWheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) override;
        bool keyPressed(const ::juce::KeyPress& key) override;
        bool isTextInputActive() const override;
        ::juce::Range<int> getHighlightedRegion() const override;
        void setHighlightedRegion(const ::juce::Range<int>& newRange) override;
        void setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& underlinedRegions) override;
        ::juce::String getTextInRange(const ::juce::Range<int>& range) const override;
        void insertTextAtCaret(const ::juce::String& textToInsert) override;
        int getCaretPosition() const override;
        ::juce::Rectangle<int> getCaretRectangleForCharIndex(int characterIndex) const override;
        int getTotalNumChars() const override;
        int getCharIndexForPoint(::juce::Point<int> point) const override;
        ::juce::RectangleList<int> getTextBounds(::juce::Range<int> textRange) const override;

    private:
        class Surface;
        void timerCallback() override;
        void updateWindowTitle();
        void updateTimerState();

        EditorConfig config_;
        std::unique_ptr<Surface> surface_;
        int timerFrequencyHz_ = 0;
    };

#else

    class ArrangeEditor {
    public:
        template <class Processor>
        explicit ArrangeEditor(Processor&) {}

        template <class Processor>
        ArrangeEditor(Processor&, EditorConfig config) : config_(std::move(config)) {}

        void configure(EditorConfig config) { config_ = std::move(config); }
        void reload() {}
        const EditorConfig& config() const noexcept { return config_; }

    private:
        EditorConfig config_;
    };

#endif
} // namespace arrange::juce

namespace arrange {
    using ArrangeEditorConfig = juce::EditorConfig;
    using ArrangeEditor = juce::ArrangeEditor;
} // namespace arrange
