#include <arrange/juce/PointerInputState.h>
#include "ScrollProbe.h"

#include <cmath>
#include <juce_core/juce_core.h>

namespace arrange::juce {
    void PointerInputState::reset() {
        pointer_ = {};
        wheelSession_ = {};
        nextWheelSessionId_ = 0;
        pendingScrollValues_.clear();
        scrollRevision_ = 0;
    }

    void PointerInputState::resetForSceneChange() {
        pointer_ = {};
        pendingScrollValues_.clear();
        scrollRevision_ = 0;
        // reload 清场景状态，但旧手势的剩余输入仍应留在取消会话中
        cancelWheel();
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

    void PointerInputState::cancelWheel() {
        if (!wheelSession_.active) return;
        wheelSession_.cancelled = true;
        wheelSession_.target.reset();
    }

    void PointerInputState::synchronizePublishedWheel(const arrange::core::LayoutTree& tree, bool interactive) {
        if (!interactive || (wheelSession_.target && !arrange::core::ScrollDispatcher::targetWheel(tree, *wheelSession_.target, 0, 1).target)) cancelWheel();
    }

    WheelDispatchResult PointerInputState::wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, float deltaX, float deltaY, std::uint64_t publishedRevision, float pixelsPerWheelUnit) {
        WheelInput input;
        input.timeMillis = ::juce::Time::getMillisecondCounterHiRes();
        input.deltaX = deltaX * pixelsPerWheelUnit;
        input.deltaY = deltaY * pixelsPerWheelUnit;
        return wheel(tree, root, point, input, publishedRevision);
    }

    WheelDispatchResult PointerInputState::wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, const WheelInput& input, std::uint64_t publishedRevision) {
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
        const auto begin = [&] {
            wheelSession_ = {};
            wheelSession_.id = ++nextWheelSessionId_;
            wheelSession_.active = true;
            wheelSession_.nativePhases = input.nativePhases;
            wheelSession_.lastInputMillis = input.timeMillis;
            // 只在起手冻结命中链，零位移 began 也不能把初始落点拖到下一次输入
            wheelSession_.initialPath = arrange::core::ScrollDispatcher::hitPath(tree, root, point);
            result.sessionStarted = true;
        };
        const auto isCancellation = input.phase == WheelPhase::Cancelled || input.momentumPhase == WheelPhase::Cancelled;
        const auto hasDelta = (std::isfinite(input.deltaX) && input.deltaX != 0) || (std::isfinite(input.deltaY) && input.deltaY != 0);
        if (input.phase == WheelPhase::MayBegin) {
            begin();
            wheelSession_.preparing = true;
        } else if (input.phase == WheelPhase::Began) {
            if (!wheelSession_.active || !wheelSession_.preparing || wheelSession_.cancelled) begin();
            wheelSession_.preparing = false;
        } else if (input.nativePhases) {
            // 失效或取消的会话保留墓碑；剩余 changed / 惯性不能重新命中其他容器
            if (!wheelSession_.active && input.momentumPhase == WheelPhase::None && !isCancellation && input.phase == WheelPhase::Changed) begin();
        } else if (!(input.inertial && wheelSession_.nativePhases)) {
            const auto gap = input.timeMillis - wheelSession_.lastInputMillis;
            if (hasDelta && (!wheelSession_.active || wheelSession_.nativePhases || gap > wheelSequenceGapMillis || gap < 0)) begin();
        }

        result.sessionId = wheelSession_.id;
        if (isCancellation) {
            cancelWheel();
            result.sessionCancelled = true;
        }
        if (wheelSession_.active) wheelSession_.lastInputMillis = input.timeMillis;
        if (!wheelSession_.active || wheelSession_.cancelled) return result;

        const auto dispatch = [&](const arrange::core::ScrollTarget& target) {
            const auto unit = target.horizontal ? input.unitX : input.unitY;
            const auto delta = target.horizontal ? input.deltaX : input.deltaY;
            auto scale = unit == WheelUnit::Lines ? scrollLineDistance : 1.0f;
            if (unit == WheelUnit::Pages) scale = arrange::core::ScrollDispatcher::targetWheel(tree, target, 0, 1, &pendingScrollValues_).viewportSize;
            return arrange::core::ScrollDispatcher::targetWheel(tree, target, std::isfinite(delta) ? delta : 0.0f, scale, &pendingScrollValues_);
        };
        if (wheelSession_.target) {
            result.horizontal = wheelSession_.target->horizontal;
            result.scroll = dispatch(*wheelSession_.target);
            if (!result.scroll.target) {
                cancelWheel();
                result.sessionCancelled = true;
            }
        } else if (hasDelta) {
            const auto axisMagnitude = [](float delta, WheelUnit unit) { return std::isfinite(delta) ? std::abs(delta) * (unit == WheelUnit::Lines ? scrollLineDistance : 1.0f) : 0.0f; };
            result.horizontal = axisMagnitude(input.deltaX, input.unitX) > axisMagnitude(input.deltaY, input.unitY);
            const auto hasAxis = [&](bool horizontal) {
                for (const auto& target : wheelSession_.initialPath) if (target.horizontal == horizontal && arrange::core::ScrollDispatcher::targetWheel(tree, target, 0, 1).target) return true;
                return false;
            };
            // 主轴没有容器才允许改用次轴；边界不能让次轴噪声接管手势
            if (!hasAxis(result.horizontal) && (result.horizontal ? input.deltaY : input.deltaX) != 0) result.horizontal = !result.horizontal;
            for (auto it = wheelSession_.initialPath.rbegin(); it != wheelSession_.initialPath.rend(); ++it) {
                if (it->horizontal != result.horizontal) continue;
                const auto candidate = dispatch(*it);
                if (!candidate.target) continue;
                result.scroll = candidate;
                wheelSession_.target = *it;
                if (candidate.consumed) break;
            }
            // 全部到边界时保留最外层实例，之后反向也不能偷回子层
        }
        if (result.scroll.consumed) pendingScrollValues_[result.scroll.modifier.identity] = result.scroll.value;
        if (input.momentumPhase == WheelPhase::Ended) wheelSession_.active = false;
        // 手指 ended 后保留落点，系统惯性继续使用同一实例
        result.locked = wheelSession_.active && wheelSession_.target.has_value() && !wheelSession_.cancelled;
        return result;
    }
}
