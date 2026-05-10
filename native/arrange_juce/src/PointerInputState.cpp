#include <arrange/juce/PointerInputState.h>

namespace arrange::juce {
    PointerDownResult PointerInputState::pointerDown(
        arrange::core::LayoutTree& tree,
        arrange::core::NodeId root,
        arrange::core::Point point,
        std::uint32_t pointerId) {
        PointerDownResult result;
        result.hit = hitTester_.hitTest(tree, root, point);
        (void)pointer_.pointerDown(tree, root, point, pointerId);
        return result;
    }

    arrange::core::PointerDispatchResult PointerInputState::pointerUp(
        arrange::core::LayoutTree& tree,
        arrange::core::NodeId root,
        arrange::core::Point point,
        std::uint32_t pointerId) {
        return pointer_.pointerUp(tree, root, point, pointerId);
    }

    WheelDispatchResult PointerInputState::wheel(
        arrange::core::LayoutTree& tree,
        arrange::core::NodeId root,
        arrange::core::Point point,
        float deltaX,
        float deltaY) {
        WheelDispatchResult result;
        result.horizontal = deltaX != 0.0f;
        result.scroll = result.horizontal
                            ? scroll_.horizontalWheel(tree, root, point, deltaX)
                            : scroll_.verticalWheel(tree, root, point, deltaY);
        return result;
    }
} // namespace arrange::juce
