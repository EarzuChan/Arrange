#pragma once

#include <arrange/core/Geometry.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/LayoutNode.h>
#include <arrange/core/PointerGesture.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/WheelInput.h>
#include <optional>

namespace arrange::juce {
    struct PointerDownResult {
        arrange::core::HitTestResult hit;
    };

    struct WheelDispatchResult {
        arrange::core::ScrollResult scroll;
        bool horizontal = false;
        std::uint64_t sessionId = 0;
        bool locked = false;
        bool sessionStarted = false;
        bool sessionCancelled = false;
        // 会话锁定到 onWheel 受体时的交付，单位为逻辑 PX，向上 / 向左滚为正
        std::optional<arrange::core::PointerGestureEvent> wheelEvent;
    };

    class PointerInputState {
       public:
        void reset();
        void resetForSceneChange();
        [[nodiscard]] PointerDownResult pointerDown(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, const arrange::core::PointerSample& sample, int clicks, arrange::core::PointerGestureOutput& out);
        void pointerDrag(const arrange::core::LayoutTree& tree, const arrange::core::PointerSample& sample, arrange::core::PointerGestureOutput& out);
        void pointerUp(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, const arrange::core::PointerSample& sample, arrange::core::PointerGestureOutput& out);

        arrange::core::PointerGestureSession& gesture() noexcept {
            return gesture_;
        }

        const arrange::core::PointerGestureSession& gesture() const noexcept {
            return gesture_;
        }

        [[nodiscard]] WheelDispatchResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, float deltaX, float deltaY, std::uint64_t publishedRevision = 0, float pixelsPerWheelUnit = 48.0f);

        [[nodiscard]] WheelDispatchResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, const WheelInput& input, std::uint64_t publishedRevision = 0, const arrange::core::HitTestSnapshot* snapshot = nullptr);
        void cancelWheel();
        void synchronizePublishedWheel(const arrange::core::LayoutTree& tree, bool interactive);

        std::optional<arrange::core::NodeId> capturedNode(const arrange::core::LayoutTree& tree) const {
            return gesture_.capturedNode(tree);
        }

       private:
        struct WheelSession {
            std::uint64_t id = 0;
            bool active = false;
            bool nativePhases = false;
            bool preparing = false;
            bool cancelled = false;
            double lastInputMillis = 0;
            arrange::core::ScrollHitPath initialPath;
            std::optional<arrange::core::ScrollTarget> target;
            // 起手命中链上最近的 onWheel 受体，选定后整个会话交给它
            std::optional<arrange::core::HitTestResult> candidate;
            std::optional<arrange::core::HitTestResult> receptor;
        };

        WheelSession wheelSession_;
        std::uint64_t nextWheelSessionId_ = 0;
        arrange::core::HitTester hitTester_;
        arrange::core::PointerGestureSession gesture_;
        arrange::core::ScrollDispatcher scroll_;
        arrange::core::PendingScrollValues pendingScrollValues_;
        std::uint64_t scrollRevision_ = 0;
    };
}
