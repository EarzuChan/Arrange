#include <arrange/juce/InteractionStateOwner.h>

#if ARRANGE_JUCE_WITH_JUCE

namespace arrange::juce {
    InteractionStateOwner::InteractionStateOwner(arrange::core::TextLayoutService& textLayoutService) noexcept
        : input_(textLayoutService) {}

    void InteractionStateOwner::reset() {
        input_.reset();
    }

    const std::optional<arrange::core::NodeId>& InteractionStateOwner::focusedNode() const noexcept {
        return input_.focusedNode();
    }

    float InteractionStateOwner::viewportX() const noexcept {
        return input_.viewportX();
    }

    void InteractionStateOwner::pointerDown(
        arrange::core::LayoutTree& tree,
        arrange::core::NodeId root,
        float x,
        float y,
        const TextInputCallbacks& callbacks) {
        const auto point = arrange::core::Point{x, y};
        const auto pointerResult = pointer_.pointerDown(tree, root, point, 0);
        input_.pointerDown(tree, pointerResult.hit, x, y, callbacks);
    }

    bool InteractionStateOwner::pointerDrag(
        arrange::core::LayoutTree& tree,
        bool runtimeReady,
        float x,
        float y,
        const TextInputCallbacks& callbacks) {
        return input_.pointerDrag(tree, runtimeReady, x, y, callbacks);
    }

    InteractionPointerUpResult InteractionStateOwner::pointerUp(
        arrange::core::LayoutTree& tree,
        arrange::core::NodeId root,
        float x,
        float y) {
        input_.cancelDrag();
        const auto result = pointer_.pointerUp(tree, root, {x, y}, 0);
        return {result.clickTriggered, result.eventSlot};
    }

    InteractionWheelResult InteractionStateOwner::wheel(
        arrange::core::LayoutTree& tree,
        arrange::core::NodeId root,
        float x,
        float y,
        float deltaX,
        float deltaY) {
        const auto result = pointer_.wheel(tree, root, {x, y}, deltaX, deltaY);
        return {result.scroll, result.horizontal};
    }

    bool InteractionStateOwner::isTextInputActive(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.isTextInputActive(tree, runtimeReady);
    }

    ::juce::Range<int> InteractionStateOwner::highlightedRegion(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.highlightedRegion(tree, runtimeReady);
    }

    bool InteractionStateOwner::setHighlightedRegion(
        arrange::core::LayoutTree& tree,
        bool runtimeReady,
        const ::juce::Range<int>& range,
        const TextInputCallbacks& callbacks) {
        return input_.setHighlightedRegion(tree, runtimeReady, range, callbacks);
    }

    bool InteractionStateOwner::setTemporaryUnderlining(
        arrange::core::LayoutTree& tree,
        bool runtimeReady,
        const ::juce::Array<::juce::Range<int>>& ranges,
        const TextInputCallbacks& callbacks) {
        return input_.setTemporaryUnderlining(tree, runtimeReady, ranges, callbacks);
    }

    ::juce::String InteractionStateOwner::textInRange(
        const arrange::core::LayoutTree& tree,
        bool runtimeReady,
        const ::juce::Range<int>& range) const {
        return input_.textInRange(tree, runtimeReady, range);
    }

    bool InteractionStateOwner::insertTextAtCaret(
        arrange::core::LayoutTree& tree,
        bool runtimeReady,
        const ::juce::String& textToInsert,
        const TextInputCallbacks& callbacks) {
        return input_.insertTextAtCaret(tree, runtimeReady, textToInsert, callbacks);
    }

    int InteractionStateOwner::caretPosition(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.caretPosition(tree, runtimeReady);
    }

    int InteractionStateOwner::totalNumChars(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return input_.totalNumChars(tree, runtimeReady);
    }

    int InteractionStateOwner::charIndexForPoint(
        const arrange::core::LayoutTree& tree,
        bool runtimeReady,
        ::juce::Point<int> point) const {
        return input_.charIndexForPoint(tree, runtimeReady, point);
    }

    ::juce::Rectangle<int> InteractionStateOwner::caretRectangleForCharIndex(
        const arrange::core::LayoutTree& tree,
        bool runtimeReady,
        int characterIndex) const {
        return input_.caretRectangleForCharIndex(tree, runtimeReady, characterIndex);
    }

    ::juce::RectangleList<int> InteractionStateOwner::textBounds(
        const arrange::core::LayoutTree& tree,
        bool runtimeReady,
        ::juce::Range<int> range) const {
        return input_.textBounds(tree, runtimeReady, range);
    }

    bool InteractionStateOwner::keyPressed(
        arrange::core::LayoutTree& tree,
        bool runtimeReady,
        const ::juce::KeyPress& key,
        const TextInputCallbacks& callbacks) {
        return input_.keyPressed(tree, runtimeReady, key, callbacks);
    }

    void InteractionStateOwner::updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady) {
        input_.updateFocusedInputViewport(tree, runtimeReady);
    }

    std::vector<arrange::core::DrawOp> InteractionStateOwner::buildFocusedInputOps(
        const arrange::core::LayoutTree& tree,
        bool runtimeReady) const {
        return input_.buildFocusedInputOps(tree, runtimeReady);
    }
} // namespace arrange::juce

#endif
