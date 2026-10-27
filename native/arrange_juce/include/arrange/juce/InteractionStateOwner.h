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
        arrange::core::PointerGestureOutput gesture;
    };

    using InteractionWheelResult = WheelDispatchResult;

    using PointerPlatformEffects = arrange::core::PointerPlatformEffects;

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

        arrange::core::PointerGestureOutput pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, const TextInputCallbacks& callbacks, TextPointerDownOptions options = {}, arrange::core::KeyModifierState modifiers = {});
        [[nodiscard]] bool pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const TextInputCallbacks& callbacks, arrange::core::PointerGestureOutput* gesture = nullptr, arrange::core::KeyModifierState modifiers = {});
        [[nodiscard]] InteractionPointerUpResult pointerUp(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, arrange::core::KeyModifierState modifiers = {});
        arrange::core::PointerGestureOutput pointerMove(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y);
        arrange::core::PointerGestureOutput pointerExit(const arrange::core::LayoutTree& tree);
        arrange::core::PointerGestureOutput contextClick(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, arrange::core::KeyModifierState modifiers);
        // 统一取消：按下、文本拖选、拖动与滚轮会话
        arrange::core::PointerGestureOutput cancelPointer(const arrange::core::LayoutTree& tree);

        [[nodiscard]] arrange::core::PointerIcon pointerIcon() const noexcept {
            return pointer_.gesture().icon();
        }

        [[nodiscard]] bool pointerDragging() const noexcept {
            return pointer_.gesture().dragging();
        }

        void notePointerEffects(const arrange::core::PointerGestureOutput& output) noexcept {
            if (output.lockPointer) {
                effects_.lockPointer = true;
                effects_.unlockPointer = false;
            }
            if (output.unlockPointer) {
                effects_.unlockPointer = true;
                effects_.lockPointer = false;
                effects_.restorePoint = output.restorePoint;
            }
        }

        PointerPlatformEffects takePointerEffects() noexcept {
            return std::exchange(effects_, {});
        }

        void setTouchSlop(float px) noexcept {
            pointer_.gesture().setTouchSlop(px);
        }

        [[nodiscard]] InteractionWheelResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, float x, float y, float deltaX, float deltaY, std::uint64_t publishedRevision = 0, float pixelsPerWheelUnit = 48.0f);

        [[nodiscard]] InteractionWheelResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, float x, float y, const WheelInput& input, std::uint64_t publishedRevision = 0, const arrange::core::HitTestSnapshot* snapshot = nullptr);

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
        // 为已不在按下状态的键交付 key up；isDown 为空时视为全部抬起（失焦补发）
        [[nodiscard]] bool keyStateChanged(arrange::core::LayoutTree& tree, bool runtimeReady, const std::function<bool(int)>& isDown, const TextInputCallbacks& callbacks);
        void modifierKeysChanged(arrange::core::LayoutTree& tree, bool runtimeReady, arrange::core::KeyModifierState modifiers, const TextInputCallbacks& callbacks);

        void synchronizePublishedInput(const arrange::core::LayoutTree& tree, bool runtimeReady) {
            pointer_.synchronizePublishedWheel(tree, runtimeReady);
            arrange::core::PointerGestureOutput ignored;
            if (runtimeReady)
                pointer_.gesture().revalidate(tree, ignored);
            else
                pointer_.gesture().cancel(tree, ignored);
            input_.synchronizePublishedInput(tree, runtimeReady);
            focus_.synchronize(tree, runtimeReady);
        }

        void updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady);
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildFocusedInputOps(const arrange::core::LayoutTree& tree, bool runtimeReady) const;

       private:
        PointerInputState pointer_;
        PointerPlatformEffects effects_;

        struct PressedKey {
            int keyCode = 0;
            std::string key;
            std::string text;
            // 只有交付过 key down 的键才交付 key up
            bool delivered = false;
        };

        struct KeyActivation {
            int keyCode = 0;
            arrange::core::NodeId node = 0;
        };

        std::vector<PressedKey> pressedKeys_;
        std::optional<KeyActivation> activation_;
        arrange::core::KeyModifierState modifiers_;
        bool bubbleKey(const arrange::core::LayoutTree& tree, const arrange::core::KeyEventPayload& payload, const TextInputCallbacks& callbacks) const;
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
