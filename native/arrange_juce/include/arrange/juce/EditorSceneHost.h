#pragma once

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <functional>
#include <memory>
#include <arrange/juce/WheelInput.h>
#include <arrange/core/Geometry.h>
#include <arrange/core/PointerGesture.h>
#include <string>
#include <string_view>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct EditorConfig;
    using PointerPlatformEffects = arrange::core::PointerPlatformEffects;

    class EditorSceneHost final {
       public:
        EditorSceneHost();
        ~EditorSceneHost();

        EditorSceneHost(const EditorSceneHost&) = delete;
        EditorSceneHost& operator=(const EditorSceneHost&) = delete;

        void setWorkAvailable(std::function<void()> callback);
        void configure(const EditorConfig& config);
        void reload();
        void reloadFromDevServer();
        void manualReload(bool toggleLive);

        [[nodiscard]] bool triggerManualDiagnosticError();
        [[nodiscard]] bool pushManualDiagnosticToast();
        [[nodiscard]] bool copyDiagnosticsToClipboard();

        void repaintDirty(::juce::Component& owner);
        [[nodiscard]] bool wantsVBlank() const;
        [[nodiscard]] bool pumpFrame(double nowMillis);
        [[nodiscard]] bool ready() const;
        [[nodiscard]] std::string windowTitle(std::string_view baseTitle) const;

        void resized(int width, int height);
        void paint(::juce::Graphics& g, ::juce::Rectangle<int> bounds);

        void pointerMove(const ::juce::MouseEvent& event);
        void pointerExit();
        void cancelPointer();
        [[nodiscard]] arrange::core::PointerIcon pointerIcon() const;
        [[nodiscard]] PointerPlatformEffects takePointerEffects();
        [[nodiscard]] bool pointerDragging() const;
        void pointerDown(const ::juce::MouseEvent& event);
        [[nodiscard]] bool pointerDrag(const ::juce::MouseEvent& event);
        void pointerUp(const ::juce::MouseEvent& event);
        [[nodiscard]] bool wheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel);
        [[nodiscard]] bool wheelMove(arrange::core::Point point, const WheelInput& input);
        void cancelWheel();

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
        [[nodiscard]] bool keyStateChanged(const std::function<bool(int)>& isDown);
        void modifierKeysChanged(const ::juce::ModifierKeys& modifiers);
        [[nodiscard]] bool hasKeyboardFocusTarget() const;

       private:
        static constexpr std::string_view TAG = "EditorSceneHost";
        class Impl;
        std::unique_ptr<Impl> impl_;
    };

#endif
}
