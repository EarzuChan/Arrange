#include <arrange/core/PointerInputProcessor.h>
#include <arrange/core/Modifier.h>

namespace arrange::core {
    PointerDispatchResult PointerInputProcessor::pointerDown(const HitTestSnapshot& snapshot, Point point, int pointerId) {
        const auto hit = hitTester_.hitTestClickable(snapshot, point);
        if (!hit.hit) {
            activePointerId_ = -1;
            pressed_ = {};
            pressedEventSlot_ = {};
            return {};
        }

        activePointerId_ = pointerId;
        pressed_ = {hit.node, hit.generation};
        pressedEventSlot_ = hit.eventSlot;
        pressedModifier_ = hit.modifier;
        return {true, false, hit.node, pressedEventSlot_};
    }

    PointerDispatchResult PointerInputProcessor::pointerUp(const HitTestSnapshot& snapshot, Point point, int pointerId) {
        if (activePointerId_ != pointerId || !pressed_.id) return {};

        const auto pressed = pressed_;
        const auto eventSlot = pressedEventSlot_;
        activePointerId_ = -1;
        pressed_ = {};
        pressedEventSlot_ = {};

        const auto hit = hitTester_.hitTestClickable(snapshot, point);
        if (hit.hit && hit.node == pressed.id && hit.generation == pressed.generation && hit.modifier == pressedModifier_ && hit.eventSlot.valid()) return {true, true, pressed.id, hit.eventSlot};
        return {true, false, pressed.id, eventSlot};
    }

    PointerDispatchResult PointerInputProcessor::pointerDown(const LayoutTree& tree, NodeId root, Point point, int pointerId) {
        return pointerDown(buildHitTestSnapshot(tree, root), point, pointerId);
    }

    PointerDispatchResult PointerInputProcessor::pointerUp(const LayoutTree& tree, NodeId root, Point point, int pointerId) {
        return pointerUp(buildHitTestSnapshot(tree, root), point, pointerId);
    }

    PointerDispatchResult PointerInputProcessor::pointerCancel(int pointerId) noexcept {
        if (activePointerId_ != pointerId || !pressed_.id) return {};
        const auto pressed = pressed_.id;
        const auto eventSlot = pressedEventSlot_;
        activePointerId_ = -1;
        pressed_ = {};
        pressedEventSlot_ = {};
        return {true, false, pressed, eventSlot};
    }
}
