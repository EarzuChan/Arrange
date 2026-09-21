#include <arrange/juce/PointerInputState.h>

namespace arrange::juce {
    void PointerInputState::reset() {
        pointer_ = {};
        pendingScrollValues_.clear();
        scrollRevision_ = 0;
    }

    PointerDownResult PointerInputState::pointerDown(const arrange::core::HitTestSnapshot& snapshot, arrange::core::Point point, std::uint32_t pointerId) {
        PointerDownResult result;
        result.hit = hitTester_.hitTest(snapshot, point);
        (void)pointer_.pointerDown(snapshot, point, pointerId);
        return result;
    }

    arrange::core::PointerDispatchResult PointerInputState::pointerUp(const arrange::core::HitTestSnapshot& snapshot, arrange::core::Point point, std::uint32_t pointerId) {
        return pointer_.pointerUp(snapshot, point, pointerId);
    }

    WheelDispatchResult PointerInputState::wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, float deltaX, float deltaY, std::uint64_t publishedRevision) {
        if (scrollRevision_ != publishedRevision) {
            pendingScrollValues_.clear();
            scrollRevision_ = publishedRevision;
        }
        WheelDispatchResult result;
        result.horizontal = deltaX != 0.0f;
        result.scroll = result.horizontal ? scroll_.horizontalWheel(tree, root, point, deltaX, 48.0f, &pendingScrollValues_) : scroll_.verticalWheel(tree, root, point, deltaY, 48.0f, &pendingScrollValues_);
        if (result.scroll.consumed) pendingScrollValues_[result.scroll.modifier.identity] = result.scroll.value;
        return result;
    }
}  // namespace arrange::juce
