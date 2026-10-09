#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/juce/TextInputOwner.h>
#include <arrange/juce/PointerInputState.h>
#include <arrange/juce/FocusOwner.h>

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

    using InteractionWheelResult = WheelDispatchResult;

    class InteractionStateOwner final {
       public:
        explicit InteractionStateOwner(arrange::core::TextLayoutService& textLayoutService) noexcept;

        void reset();

        void commitState(InteractionStateOwner&& candidate) noexcept {
            pointer_ = std::move(candidate.pointer_);
            focus_ = std::move(candidate.focus_);
            preparedInputEvents_ = std::move(candidate.preparedInputEvents_);
            pendingLazyFocus_ = std::move(candidate.pendingLazyFocus_);
            lazyFocusVersion_ = candidate.lazyFocusVersion_;
            input_.commitState(std::move(candidate.input_));
        }

        [[nodiscard]] const std::optional<arrange::core::NodeId>& focusedNode() const noexcept;
        [[nodiscard]] float viewportX() const noexcept;

        [[nodiscard]] float viewportY() const noexcept {
            return input_.viewportY();
        }

        const std::optional<arrange::core::NodeId>& textFocusedNode() const noexcept {
            return input_.focusedNode();
        }

        void synchronizePublishedFocus(const arrange::core::LayoutTree& tree, bool runtimeReady, const std::vector<arrange::core::FocusCommand>& commands = {});
        void dispatchCommittedFocus(arrange::core::LayoutTree& tree, const TextInputCallbacks& callbacks);

        void dispatchPendingTextEdits(const arrange::core::LayoutTree& tree, const TextInputCallbacks& callbacks) {
            input_.dispatchPendingTextEdits(tree, callbacks);
        }

        void setFocusNavigationHook(std::function<bool(arrange::core::NodeId, arrange::core::FocusDirection)> hook) {
            navigationHook_ = std::move(hook);
        }

        void setFocusChangedHook(std::function<void(std::optional<arrange::core::NodeId>)> hook) {
            focusChangedHook_ = std::move(hook);
        }

        bool requestFocus(arrange::core::LayoutTree& tree, arrange::core::NodeId node, const TextInputCallbacks& callbacks);
        bool moveFocus(arrange::core::LayoutTree& tree, arrange::core::FocusDirection direction, const TextInputCallbacks& callbacks);
        void clearFocus(arrange::core::LayoutTree& tree, const TextInputCallbacks& callbacks);
        void prepareLazyInteraction(arrange::core::LayoutTree& tree) const;

        bool hasPendingLazyFocus() const noexcept {
            return pendingLazyFocus_.has_value();
        }

        std::optional<arrange::core::NodeId> pendingLazyContainer() const noexcept {
            return pendingLazyFocus_ ? std::optional<arrange::core::NodeId>{pendingLazyFocus_->container.id} : std::nullopt;
        }

        [[nodiscard]] arrange::core::ModifierHandle focusedModifier() const noexcept {
            return input_.focusedModifier();
        }

        void pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, const TextInputCallbacks& callbacks);
        [[nodiscard]] bool pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const TextInputCallbacks& callbacks);
        [[nodiscard]] InteractionPointerUpResult pointerUp(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y);
        [[nodiscard]] InteractionWheelResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, float x, float y, float deltaX, float deltaY, std::uint64_t publishedRevision = 0, float pixelsPerWheelUnit = 48.0f);

        [[nodiscard]] InteractionWheelResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, float x, float y, const WheelInput& input, std::uint64_t publishedRevision = 0);

        void cancelWheel() {
            pointer_.cancelWheel();
        }

        [[nodiscard]] bool isTextInputActive(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] ::juce::Range<int> highlightedRegion(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] bool setHighlightedRegion(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range, const TextInputCallbacks& callbacks);
        [[nodiscard]] bool setTemporaryUnderlining(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Array<::juce::Range<int>>& ranges, const TextInputCallbacks& callbacks);
        [[nodiscard]] ::juce::String textInRange(const arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range) const;
        [[nodiscard]] bool insertTextAtCaret(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::String& textToInsert, const TextInputCallbacks& callbacks);
        [[nodiscard]] int caretPosition(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] int totalNumChars(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] int charIndexForPoint(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Point<int> point) const;
        [[nodiscard]] ::juce::Rectangle<int> caretRectangleForCharIndex(const arrange::core::LayoutTree& tree, bool runtimeReady, int characterIndex) const;
        [[nodiscard]] ::juce::RectangleList<int> textBounds(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Range<int> range) const;
        [[nodiscard]] bool keyPressed(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::KeyPress& key, const TextInputCallbacks& callbacks);

        void synchronizePublishedInput(const arrange::core::LayoutTree& tree, bool runtimeReady) {
            pointer_.synchronizePublishedWheel(tree, runtimeReady);
            input_.synchronizePublishedInput(tree, runtimeReady);
            focus_.synchronize(tree, runtimeReady);
        }

        void updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady);
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildFocusedInputOps(const arrange::core::LayoutTree& tree, bool runtimeReady) const;

       private:
        PointerInputState pointer_;
        TextInputOwner input_;
        FocusOwner focus_;
        std::vector<std::pair<arrange::core::EventSlotId, std::string>> preparedInputEvents_;
        std::function<bool(arrange::core::NodeId, arrange::core::FocusDirection)> navigationHook_;
        std::function<void(std::optional<arrange::core::NodeId>)> focusChangedHook_;

        struct LazyFocusRequest {
            arrange::core::NodeHandle container;
            std::string key;
            arrange::core::FocusDirection direction = arrange::core::FocusDirection::Next;
            std::uint64_t version = 0;
        };

        std::optional<LazyFocusRequest> pendingLazyFocus_;
        std::uint64_t lazyFocusVersion_ = 0;
        bool navigateLazy(arrange::core::LayoutTree& tree, arrange::core::FocusDirection direction, const TextInputCallbacks& callbacks);
        void resolveLazyFocus(const arrange::core::LayoutTree& tree);
    };

#endif
}
