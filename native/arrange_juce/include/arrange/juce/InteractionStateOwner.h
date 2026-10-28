#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/InputSession.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/juce/TextInputOwner.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    // JUCE 按键翻译为平台无关按键
    arrange::core::KeyInput keyInput(const ::juce::KeyPress& key);

    // 只做 JUCE 翻译：坐标、时间戳与按键换成 core 类型后交给 InputSession；文本编辑与 IME 由 TextInputOwner 承担
    class InteractionStateOwner final {
       public:
        explicit InteractionStateOwner(arrange::core::TextLayoutService& textLayoutService) noexcept;

        void reset();

        void commitState(InteractionStateOwner&& candidate) noexcept {
            session_.commitState(std::move(candidate.session_));
            input_.commitState(std::move(candidate.input_));
        }

        [[nodiscard]] arrange::core::InputSession& session() noexcept {
            return session_;
        }

        [[nodiscard]] const arrange::core::InputSession& session() const noexcept {
            return session_;
        }

        [[nodiscard]] const std::optional<arrange::core::NodeId>& focusedNode() const noexcept {
            return session_.focusedNode();
        }

        [[nodiscard]] float viewportX() const noexcept {
            return input_.viewportX();
        }

        [[nodiscard]] float viewportY() const noexcept {
            return input_.viewportY();
        }

        const std::optional<arrange::core::NodeId>& textFocusedNode() const noexcept {
            return input_.focusedNode();
        }

        void synchronizePublishedFocus(const arrange::core::LayoutTree& tree, bool runtimeReady, const std::vector<arrange::core::FocusCommand>& commands = {}) {
            session_.synchronizePublishedFocus(tree, runtimeReady, input_, commands);
        }

        void dispatchCommittedFocus(arrange::core::LayoutTree& tree, const arrange::core::InputCallbacks& callbacks) {
            session_.dispatchCommittedFocus(tree, input_, callbacks);
        }

        void dispatchPendingTextEdits(const arrange::core::LayoutTree& tree, const arrange::core::InputCallbacks& callbacks) {
            input_.dispatchPendingTextEdits(tree, callbacks);
        }

        void setFocusNavigationHook(std::function<bool(arrange::core::NodeId, arrange::core::FocusDirection)> hook) {
            session_.setFocusNavigationHook(std::move(hook));
        }

        void setFocusChangedHook(std::function<void(std::optional<arrange::core::NodeId>)> hook) {
            session_.setFocusChangedHook(std::move(hook));
        }

        bool requestFocus(arrange::core::LayoutTree& tree, arrange::core::NodeId node, const arrange::core::InputCallbacks& callbacks) {
            return session_.requestFocus(tree, node, input_, callbacks);
        }

        bool moveFocus(arrange::core::LayoutTree& tree, arrange::core::FocusDirection direction, const arrange::core::InputCallbacks& callbacks) {
            return session_.moveFocus(tree, direction, input_, callbacks);
        }

        void clearFocus(arrange::core::LayoutTree& tree, const arrange::core::InputCallbacks& callbacks) {
            session_.clearFocus(tree, input_, callbacks);
        }

        void prepareLazyInteraction(arrange::core::LayoutTree& tree) const {
            session_.prepareLazyInteraction(tree);
        }

        bool hasPendingLazyFocus() const noexcept {
            return session_.hasPendingLazyFocus();
        }

        std::optional<arrange::core::NodeId> pendingLazyContainer() const noexcept {
            return session_.pendingLazyContainer();
        }

        [[nodiscard]] arrange::core::ModifierHandle focusedModifier() const noexcept {
            return input_.focusedModifier();
        }

        arrange::core::PointerGestureOutput pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, const arrange::core::InputCallbacks& callbacks, arrange::core::PointerDownOptions options = {}, arrange::core::KeyModifierState modifiers = {});
        [[nodiscard]] bool pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const arrange::core::InputCallbacks& callbacks, arrange::core::PointerGestureOutput* gesture = nullptr, arrange::core::KeyModifierState modifiers = {});
        [[nodiscard]] arrange::core::PointerUpResult pointerUp(arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, arrange::core::KeyModifierState modifiers = {});
        arrange::core::PointerGestureOutput pointerMove(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y);
        arrange::core::PointerGestureOutput contextClick(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, float x, float y, arrange::core::KeyModifierState modifiers);

        arrange::core::PointerGestureOutput pointerExit(const arrange::core::LayoutTree& tree) {
            return session_.pointerExit(tree);
        }

        arrange::core::PointerGestureOutput cancelPointer(const arrange::core::LayoutTree& tree) {
            return session_.cancelPointer(tree, input_);
        }

        [[nodiscard]] arrange::core::PointerIcon pointerIcon() const noexcept {
            return session_.pointerIcon();
        }

        [[nodiscard]] bool pointerDragging() const noexcept {
            return session_.pointerDragging();
        }

        void notePointerEffects(const arrange::core::PointerGestureOutput& output) noexcept {
            session_.notePointerEffects(output);
        }

        arrange::core::PointerPlatformEffects takePointerEffects() noexcept {
            return session_.takePointerEffects();
        }

        void setTouchSlop(float px) noexcept {
            session_.setTouchSlop(px);
        }

        [[nodiscard]] arrange::core::WheelDispatchResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, float x, float y, const arrange::core::WheelInput& input, std::uint64_t publishedRevision = 0, const arrange::core::HitTestSnapshot* snapshot = nullptr) {
            return session_.wheel(tree, root, {x, y}, input, publishedRevision, snapshot);
        }

        void cancelWheel() {
            session_.cancelWheel();
        }

        [[nodiscard]] bool isTextInputActive(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
            return input_.isTextInputActive(tree, runtimeReady);
        }

        [[nodiscard]] ::juce::Range<int> highlightedRegion(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
            return input_.highlightedRegion(tree, runtimeReady);
        }

        [[nodiscard]] bool setHighlightedRegion(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range, const arrange::core::InputCallbacks& callbacks) {
            return input_.setHighlightedRegion(tree, runtimeReady, range, callbacks);
        }

        [[nodiscard]] bool setTemporaryUnderlining(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Array<::juce::Range<int>>& ranges, const arrange::core::InputCallbacks& callbacks) {
            return input_.setTemporaryUnderlining(tree, runtimeReady, ranges, callbacks);
        }

        [[nodiscard]] ::juce::String textInRange(const arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range) const {
            return input_.textInRange(tree, runtimeReady, range);
        }

        [[nodiscard]] bool insertTextAtCaret(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::String& textToInsert, const arrange::core::InputCallbacks& callbacks) {
            return input_.insertTextAtCaret(tree, runtimeReady, textToInsert, callbacks);
        }

        [[nodiscard]] int caretPosition(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
            return input_.caretPosition(tree, runtimeReady);
        }

        [[nodiscard]] int totalNumChars(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
            return input_.totalNumChars(tree, runtimeReady);
        }

        [[nodiscard]] int charIndexForPoint(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Point<int> point) const {
            return input_.charIndexForPoint(tree, runtimeReady, point);
        }

        [[nodiscard]] ::juce::Rectangle<int> caretRectangleForCharIndex(const arrange::core::LayoutTree& tree, bool runtimeReady, int characterIndex) const {
            return input_.caretRectangleForCharIndex(tree, runtimeReady, characterIndex);
        }

        [[nodiscard]] ::juce::RectangleList<int> textBounds(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Range<int> range) const {
            return input_.textBounds(tree, runtimeReady, range);
        }

        [[nodiscard]] bool keyPressed(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::KeyPress& key, const arrange::core::InputCallbacks& callbacks) {
            return session_.keyDown(tree, runtimeReady, keyInput(key), input_, callbacks);
        }

        [[nodiscard]] bool keyStateChanged(arrange::core::LayoutTree& tree, bool runtimeReady, const std::function<bool(int)>& isDown, const arrange::core::InputCallbacks& callbacks) {
            return session_.keyStateChanged(tree, runtimeReady, isDown, callbacks);
        }

        void modifierKeysChanged(arrange::core::LayoutTree& tree, bool runtimeReady, arrange::core::KeyModifierState modifiers, const arrange::core::InputCallbacks& callbacks) {
            session_.modifierKeysChanged(tree, runtimeReady, modifiers, callbacks);
        }

        void synchronizePublishedInput(const arrange::core::LayoutTree& tree, bool runtimeReady) {
            session_.synchronizePublishedInput(tree, runtimeReady, input_);
        }

        void updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady) {
            input_.updateFocusedInputViewport(tree, runtimeReady);
        }

        [[nodiscard]] std::vector<arrange::core::DrawOp> buildFocusedInputOps(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
            return input_.buildFocusedInputOps(tree, runtimeReady);
        }

       private:
        arrange::core::InputSession session_;
        TextInputOwner input_;
    };

#endif
}
