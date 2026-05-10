#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/InputEditing.h>
#include <arrange/core/Paint.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/juce/TextInputLayoutModel.h>
#include <arrange/juce/InputTextSession.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <functional>
#include <string>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct TextInputCallbacks {
        std::function<void(arrange::core::NodeId, std::string)> setModelValue;
        std::function<void(
            const arrange::core::ArrangeNode&,
            arrange::core::EventSlotKind,
            const char*,
            const char*,
            const std::string&)> invokeStringEvent;
        std::function<void(arrange::core::NodeId, arrange::core::DirtyFlag, std::string)> invalidateNativeState;
        std::function<void(arrange::core::NodeId, std::string)> enqueueKeyIntent;
        std::function<void(arrange::core::NodeId, std::string)> enqueueTextInputIntent;
        std::function<void(arrange::core::NodeId, std::string)> enqueueImeCompositionIntent;
    };

    class TextInputOwner final {
    public:
        explicit TextInputOwner(arrange::core::TextLayoutService& textLayoutService) noexcept;

        void reset();
        void cancelDrag() noexcept;

        [[nodiscard]] const std::optional<arrange::core::NodeId>& focusedNode() const noexcept;
        [[nodiscard]] float viewportX() const noexcept;

        void pointerDown(
            arrange::core::LayoutTree& tree,
            const arrange::core::HitTestResult& hit,
            float x,
            float y,
            const TextInputCallbacks& callbacks);
        [[nodiscard]] bool pointerDrag(
            arrange::core::LayoutTree& tree,
            bool runtimeReady,
            float x,
            float y,
            const TextInputCallbacks& callbacks);

        [[nodiscard]] bool isTextInputActive(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] ::juce::Range<int> highlightedRegion(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] bool setHighlightedRegion(
            arrange::core::LayoutTree& tree,
            bool runtimeReady,
            const ::juce::Range<int>& range,
            const TextInputCallbacks& callbacks);
        [[nodiscard]] bool setTemporaryUnderlining(
            arrange::core::LayoutTree& tree,
            bool runtimeReady,
            const ::juce::Array<::juce::Range<int>>& ranges,
            const TextInputCallbacks& callbacks);
        [[nodiscard]] ::juce::String textInRange(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady,
            const ::juce::Range<int>& range) const;
        [[nodiscard]] bool insertTextAtCaret(
            arrange::core::LayoutTree& tree,
            bool runtimeReady,
            const ::juce::String& textToInsert,
            const TextInputCallbacks& callbacks);
        [[nodiscard]] int caretPosition(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] int totalNumChars(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] int charIndexForPoint(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady,
            ::juce::Point<int> point) const;
        [[nodiscard]] ::juce::Rectangle<int> caretRectangleForCharIndex(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady,
            int characterIndex) const;
        [[nodiscard]] ::juce::RectangleList<int> textBounds(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady,
            ::juce::Range<int> range) const;

        [[nodiscard]] bool keyPressed(
            arrange::core::LayoutTree& tree,
            bool runtimeReady,
            const ::juce::KeyPress& key,
            const TextInputCallbacks& callbacks);

        void finishFocusedInput(
            arrange::core::LayoutTree& tree,
            bool submit,
            const TextInputCallbacks& callbacks);
        void updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady);
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildFocusedInputOps(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady) const;

    private:
        [[nodiscard]] const arrange::core::ArrangeNode* activeInputNode(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady) const;
        [[nodiscard]] arrange::core::ArrangeNode* activeInputNode(
            arrange::core::LayoutTree& tree,
            bool runtimeReady);
        [[nodiscard]] ::juce::RectangleList<int> textBoundsForByteRange(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady,
            std::size_t start,
            std::size_t end) const;
        [[nodiscard]] std::string normalizeInsertionText(const arrange::core::ArrangeNode& node, std::string text) const;
        [[nodiscard]] bool applyEdit(
            arrange::core::ArrangeNode& node,
            const arrange::core::InputEditResult& edit,
            const TextInputCallbacks& callbacks);

        TextInputLayoutModel text_;
        InputTextSession session_;
    };

#endif
} // namespace arrange::juce
