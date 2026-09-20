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
        std::function<void(const arrange::core::EventSlotId&, const std::string&)> invokeStringEvent;
        std::function<void(arrange::core::NodeId, arrange::core::DirtyFlag, std::string)> invalidateNativeState;
        std::function<void(arrange::core::NodeId, std::string)> enqueueKeyIntent;
        std::function<void(arrange::core::NodeId, std::string)> enqueueTextInputIntent;
        std::function<void(arrange::core::NodeId, std::string)> enqueueImeCompositionIntent;
    };

    class TextInputOwner final {
    public:
        explicit TextInputOwner(arrange::core::TextLayoutService& textLayoutService) noexcept;

        void reset();
        void commitState(TextInputOwner&& candidate) noexcept {
            session_ = std::move(candidate.session_);
            focusedGeneration_ = candidate.focusedGeneration_;
            focusedModifier_ = candidate.focusedModifier_;
            publishedModelValue_ = std::move(candidate.publishedModelValue_);
        }
        void cancelDrag() noexcept;

        [[nodiscard]] const std::optional<arrange::core::NodeId>& focusedNode() const noexcept;
        [[nodiscard]] float viewportX() const noexcept;
        [[nodiscard]] arrange::core::ModifierHandle focusedModifier() const noexcept { return focusedModifier_; }

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
        void synchronizePublishedInput(const arrange::core::LayoutTree& tree, bool runtimeReady);
        void updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady);
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildFocusedInputOps(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady) const;

    private:
        [[nodiscard]] const arrange::core::LayoutNode* activeInputNode(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady) const;
        [[nodiscard]] arrange::core::LayoutNode* activeInputNode(
            arrange::core::LayoutTree& tree,
            bool runtimeReady);
        [[nodiscard]] ::juce::RectangleList<int> textBoundsForByteRange(
            const arrange::core::LayoutTree& tree,
            bool runtimeReady,
            std::size_t start,
            std::size_t end) const;
        [[nodiscard]] std::string normalizeInsertionText(const arrange::core::LayoutNode& node, std::string text) const;
        [[nodiscard]] bool applyEdit(
            arrange::core::LayoutNode& node,
            const arrange::core::InputEditResult& edit,
            const TextInputCallbacks& callbacks);

        TextInputLayoutModel text_;
        InputTextSession session_;
        std::uint64_t focusedGeneration_ = 0;
        arrange::core::ModifierHandle focusedModifier_;
        const arrange::core::ModifierInstance& inputInstance(const arrange::core::LayoutNode& node) const;
        std::string publishedModelValue_;
    };

#endif
} // namespace arrange::juce
