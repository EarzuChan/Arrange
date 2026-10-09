#pragma once

#include <arrange/core/Geometry.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/LayoutNode.h>
#include <arrange/core/PointerInputProcessor.h>
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
    };

    class PointerInputState {
       public:
        void reset();
        void resetForSceneChange();
        [[nodiscard]] PointerDownResult pointerDown(const arrange::core::HitTestSnapshot& snapshot, arrange::core::Point point, std::uint32_t pointerId = 0);

        [[nodiscard]] arrange::core::PointerDispatchResult pointerUp(const arrange::core::HitTestSnapshot& snapshot, arrange::core::Point point, std::uint32_t pointerId = 0);

        [[nodiscard]] WheelDispatchResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, float deltaX, float deltaY, std::uint64_t publishedRevision = 0, float pixelsPerWheelUnit = 48.0f);

        [[nodiscard]] WheelDispatchResult wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, const WheelInput& input, std::uint64_t publishedRevision = 0);
        void cancelWheel();
        void synchronizePublishedWheel(const arrange::core::LayoutTree& tree, bool interactive);

        std::optional<arrange::core::NodeId> capturedNode(const arrange::core::LayoutTree& tree) const {
            return pointer_.capturedNode(tree);
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
        };

        WheelSession wheelSession_;
        std::uint64_t nextWheelSessionId_ = 0;
        arrange::core::HitTester hitTester_;
        arrange::core::PointerInputProcessor pointer_;
        arrange::core::ScrollDispatcher scroll_;
        arrange::core::PendingScrollValues pendingScrollValues_;
        std::uint64_t scrollRevision_ = 0;
    };
}
