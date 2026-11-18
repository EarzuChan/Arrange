#pragma once

#include "Geometry.h"
#include "HitTest.h"
#include "LayoutNode.h"
#include "PointerGesture.h"
#include "LayoutTree.h"
#include "Scroll.h"
#include "WheelInput.h"

#include <optional>

namespace arrange::core {
    struct PointerDownResult {
        HitTestResult hit;
    };

    struct WheelDispatchResult {
        ScrollResult scroll;
        bool locked = false;
        // 会话锁定到 onWheel 受体时的交付，单位为逻辑 PX，向上 / 向左滚为正
        std::optional<PointerGestureEvent> wheelEvent;
    };

    class PointerInputState {
       public:
        void reset();
        void resetForSceneChange();
        [[nodiscard]] PointerDownResult pointerDown(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, int clicks, PointerGestureOutput& out);
        void pointerDrag(const LayoutTree& tree, const PointerSample& sample, PointerGestureOutput& out);
        void pointerUp(const LayoutTree& tree, const HitTestSnapshot& snapshot, const PointerSample& sample, PointerGestureOutput& out);

        PointerGestureSession& gesture() noexcept {
            return gesture_;
        }

        const PointerGestureSession& gesture() const noexcept {
            return gesture_;
        }

        [[nodiscard]] WheelDispatchResult wheel(LayoutTree& tree, NodeId root, Point point, const WheelInput& input, std::uint64_t publishedRevision = 0, const HitTestSnapshot* snapshot = nullptr);
        void cancelWheel();
        void synchronizePublishedWheel(const LayoutTree& tree, bool interactive);

        std::optional<NodeId> capturedNode(const LayoutTree& tree) const {
            return gesture_.capturedNode(tree);
        }

       private:
        struct WheelSession {
            bool active = false;
            bool nativePhases = false;
            bool preparing = false;
            bool cancelled = false;
            double lastInputMillis = 0;
            ScrollHitPath initialPath;
            std::optional<ScrollTarget> target;
            // 起手命中链上最近的 onWheel 受体，选定后整个会话交给它
            std::optional<HitTestResult> candidate;
            std::optional<HitTestResult> receptor;
        };

        WheelSession wheelSession_;
        HitTester hitTester_;
        PointerGestureSession gesture_;
        ScrollDispatcher scroll_;
        PendingScrollValues pendingScrollValues_;
        std::uint64_t scrollRevision_ = 0;
    };
}
