#pragma once

#include "Geometry.h"
#include "HitTest.h"
#include "RenderTree.h"

namespace arrange::core {
    struct PointerDispatchResult {
        bool consumed = false;
        bool clickTriggered = false;
        NodeId target = 0;
        std::uint32_t callbackHandle = 0;
    };

    class PointerDispatcher {
    public:
        PointerDispatchResult pointerDown(const RenderTree& tree, NodeId root, Point point, int pointerId = 0);
        PointerDispatchResult pointerUp(const RenderTree& tree, NodeId root, Point point, int pointerId = 0);
        PointerDispatchResult pointerCancel(int pointerId = 0) noexcept;

    private:
        static std::uint32_t clickCallbackHandle(const ArrangeNode& node);

        int activePointerId_ = -1;
        NodeId pressedNode_ = 0;
        std::uint32_t pressedCallbackHandle_ = 0;
        HitTester hitTester_;
    };
} // namespace arrange::core
