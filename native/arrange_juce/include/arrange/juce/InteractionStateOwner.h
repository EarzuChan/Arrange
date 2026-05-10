#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/juce/TextInputOwner.h>
#include <arrange/juce/PointerInputState.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct InteractionPointerUpResult {
        bool clickTriggered = false;
        arrange::core::EventSlotId eventSlot;
    };

    struct InteractionWheelResult {
        arrange::core::ScrollResult scroll;
        bool horizontal = false;
    };

    class InteractionStateOwner final {
    public:
        explicit InteractionStateOwner(arrange::core::TextLayoutService& textLayoutService) noexcept;

        void reset();

        [[nodiscard]] const std::optional<arrange::core::NodeId>& focusedNode() const noexcept;
        [[nodiscard]] float viewportX() const noexcept;

        void pointerDown(
            arrange::core::LayoutTree& tree,
            arrange::core::NodeId root,
            float x,
            float y,
            const TextInputCallbacks& callbacks);
        [[nodiscard]] bool pointerDrag(
            arrange::core::LayoutTree& tree,
            bool runtimeReady,
            float x,
            float y,
            const TextInputCallbacks& callbacks);
        [[nodiscard]] InteractionPointerUpResult pointerUp(
            arrange::core::LayoutTree& tree,
            arrange::core::NodeId root,
            float x,
            float y);
        [[nodiscard]] InteractionWheelResult wheel(
            arrange::core::LayoutTree& tree,
            arrange::core::NodeId root,
            float x,
            float y,
            float deltaX,
            float deltaY);

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

        void updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady);
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildFocusedInputOps(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady) const;

    private:
        PointerInputState pointer_;
        TextInputOwner input_;
    };

#endif
} // namespace arrange::juce
