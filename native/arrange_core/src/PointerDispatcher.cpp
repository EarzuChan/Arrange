#include <arrange/core/PointerDispatcher.h>
#include <arrange/core/Modifier.h>
#include <arrange/core/PropValue.h>

namespace arrange::core {
    namespace {
        std::uint32_t modifierCallbackHandle(const ArrangeNode& node) {
            for (const auto& element : parseModifierElements(node)) {
                if (element.type == "clickable") {
                    if (const auto handle = element.handle("onClick.callbackHandle"); handle != 0) return handle;
                    if (const auto handle = element.handle("callbackHandle"); handle != 0) return handle;
                }
            }
            return 0;
        }
    }

    std::uint32_t PointerDispatcher::clickCallbackHandle(const ArrangeNode& node) {
        if (const auto handle = encodedHandleProp(node, "__arrangeClickCallback"); handle != 0) return handle;
        return modifierCallbackHandle(node);
    }

    PointerDispatchResult PointerDispatcher::pointerDown(const RenderTree& tree, NodeId root, Point point, int pointerId) {
        const auto hit = hitTester_.hitTestClickable(tree, root, point);
        if (!hit.hit) {
            activePointerId_ = -1;
            pressedNode_ = 0;
            pressedCallbackHandle_ = 0;
            return {};
        }

        activePointerId_ = pointerId;
        pressedNode_ = hit.node;
        pressedCallbackHandle_ = clickCallbackHandle(tree.node(hit.node));
        return {true, false, hit.node, pressedCallbackHandle_};
    }

    PointerDispatchResult PointerDispatcher::pointerUp(const RenderTree& tree, NodeId root, Point point, int pointerId) {
        if (activePointerId_ != pointerId || pressedNode_ == 0) return {};

        const auto pressed = pressedNode_;
        const auto callbackHandle = pressedCallbackHandle_;
        activePointerId_ = -1;
        pressedNode_ = 0;
        pressedCallbackHandle_ = 0;

        const auto hit = hitTester_.hitTestClickable(tree, root, point);
        if (hit.hit && hit.node == pressed) return {true, true, pressed, callbackHandle};
        return {true, false, pressed, callbackHandle};
    }

    PointerDispatchResult PointerDispatcher::pointerCancel(int pointerId) noexcept {
        if (activePointerId_ != pointerId || pressedNode_ == 0) return {};
        const auto pressed = pressedNode_;
        const auto callbackHandle = pressedCallbackHandle_;
        activePointerId_ = -1;
        pressedNode_ = 0;
        pressedCallbackHandle_ = 0;
        return {true, false, pressed, callbackHandle};
    }
} // namespace arrange::core
