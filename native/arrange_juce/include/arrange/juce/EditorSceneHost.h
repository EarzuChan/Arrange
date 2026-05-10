#pragma once

#include <arrange/juce/EditorTimerDriver.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <memory>
#include <string>
#include <string_view>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct EditorConfig;

    class EditorSceneHost final {
    public:
        EditorSceneHost();
        ~EditorSceneHost();

        EditorSceneHost(const EditorSceneHost&) = delete;
        EditorSceneHost& operator=(const EditorSceneHost&) = delete;

        void configure(const EditorConfig& config);
        void reload();
        void reloadFromDevServer();
        void manualReload(bool toggleLive);

        [[nodiscard]] bool triggerManualDiagnosticError();
        [[nodiscard]] bool pushManualDiagnosticToast();
        [[nodiscard]] bool copyDiagnosticsToClipboard();

        void repaintDirty(::juce::Component& owner, bool fullIfNoBounds);
        [[nodiscard]] bool consumeDevReloadRequested();
        [[nodiscard]] EditorTimerDemand timerDemand() const;
        [[nodiscard]] bool pumpFrame(double nowMillis);
        [[nodiscard]] std::string windowTitle(std::string_view baseTitle) const;

        void resized(int width, int height);
        void paint(::juce::Graphics& g, ::juce::Rectangle<int> bounds);

        void pointerDown(const ::juce::MouseEvent& event);
        [[nodiscard]] bool pointerDrag(const ::juce::MouseEvent& event);
        void pointerUp(const ::juce::MouseEvent& event);
        [[nodiscard]] bool wheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel);

        [[nodiscard]] bool isTextInputActive() const;
        [[nodiscard]] ::juce::Range<int> highlightedRegion() const;
        [[nodiscard]] bool setHighlightedRegion(const ::juce::Range<int>& range);
        [[nodiscard]] bool setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& ranges);
        [[nodiscard]] ::juce::String textInRange(const ::juce::Range<int>& range) const;
        [[nodiscard]] bool insertTextAtCaret(const ::juce::String& textToInsert);
        [[nodiscard]] int caretPosition() const;
        [[nodiscard]] int totalNumChars() const;
        [[nodiscard]] int charIndexForPoint(::juce::Point<int> point) const;
        [[nodiscard]] ::juce::Rectangle<int> caretRectangleForCharIndex(int characterIndex) const;
        [[nodiscard]] ::juce::RectangleList<int> textBounds(::juce::Range<int> range) const;
        [[nodiscard]] bool keyPressed(const ::juce::KeyPress& key);

    private:
        class Impl;
        std::unique_ptr<Impl> impl_;
    };

#endif
} // namespace arrange::juce

