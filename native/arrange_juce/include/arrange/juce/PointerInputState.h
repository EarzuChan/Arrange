#pragma once

#include <arrange/core/Geometry.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/LayoutNode.h>
#include <arrange/core/PointerInputProcessor.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>

namespace arrange::juce {
    struct PointerDownResult {
        arrange::core::HitTestResult hit;
    };

    struct WheelDispatchResult {
        arrange::core::ScrollResult scroll;
        bool horizontal = false;
    };

    class PointerInputState {
    public:
        void reset();
        [[nodiscard]] PointerDownResult pointerDown(
            const arrange::core::HitTestSnapshot& snapshot,
            arrange::core::Point point,
            std::uint32_t pointerId = 0);

        [[nodiscard]] arrange::core::PointerDispatchResult pointerUp(
            const arrange::core::HitTestSnapshot& snapshot,
            arrange::core::Point point,
            std::uint32_t pointerId = 0);

        [[nodiscard]] WheelDispatchResult wheel(
            arrange::core::LayoutTree& tree,
            arrange::core::NodeId root,
            arrange::core::Point point,
            float deltaX,
            float deltaY,
            std::uint64_t publishedRevision = 0);

    private:
        arrange::core::HitTester hitTester_;
        arrange::core::PointerInputProcessor pointer_;
        arrange::core::ScrollDispatcher scroll_;
        arrange::core::PendingScrollValues pendingScrollValues_;
        std::uint64_t scrollRevision_ = 0;
    };
} // namespace arrange::juce
