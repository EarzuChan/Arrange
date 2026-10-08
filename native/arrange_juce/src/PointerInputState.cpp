#include <arrange/juce/PointerInputState.h>
#include "ScrollProbe.h"

#include <cmath>

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

    WheelDispatchResult PointerInputState::wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, float deltaX, float deltaY, std::uint64_t publishedRevision, float pixelsPerWheelUnit) {
        if (scrollRevision_ != publishedRevision) {
            if (ScrollProbe::active()) {
                for (const auto& [identity, value] : pendingScrollValues_) {
                    ScrollProbe::Sample sample;
                    sample.kind = ScrollProbe::Kind::PredictionReset;
                    sample.previousRevision = scrollRevision_;
                    sample.revision = publishedRevision;
                    sample.modifierIdentity = identity;
                    sample.value = value;
                    sample.queueDepth = pendingScrollValues_.size();
                    ScrollProbe::record(sample);
                }
            }
            pendingScrollValues_.clear();
            scrollRevision_ = publishedRevision;
        }
        WheelDispatchResult result;
        result.horizontal = std::abs(deltaX) > std::abs(deltaY);
        const auto dispatch = [&](bool horizontal) {
            return horizontal ? scroll_.horizontalWheel(tree, root, point, deltaX, pixelsPerWheelUnit, &pendingScrollValues_) : scroll_.verticalWheel(tree, root, point, deltaY, pixelsPerWheelUnit, &pendingScrollValues_);
        };
        result.scroll = dispatch(result.horizontal);
        // 主轴没有容器时才使用另一轴；到达边界不能让次轴噪声带动另一方向的容器。
        if (!result.scroll.target && (result.horizontal ? deltaY : deltaX) != 0.0f) {
            result.horizontal = !result.horizontal;
            result.scroll = dispatch(result.horizontal);
        }
        if (result.scroll.consumed) pendingScrollValues_[result.scroll.modifier.identity] = result.scroll.value;
        return result;
    }
}
