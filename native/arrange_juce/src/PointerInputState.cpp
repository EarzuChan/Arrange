#include <arrange/juce/PointerInputState.h>
#include "ScrollProbe.h"

#include <algorithm>
#include <arrange/core/ModifierGeometry.h>
#include <cmath>
#include <juce_core/juce_core.h>

namespace arrange::juce {
    void PointerInputState::reset() {
        gesture_.reset();
        wheelSession_ = {};
        nextWheelSessionId_ = 0;
        pendingScrollValues_.clear();
        scrollRevision_ = 0;
    }

    void PointerInputState::resetForSceneChange() {
        gesture_.reset();
        pendingScrollValues_.clear();
        scrollRevision_ = 0;
        // reload 清场景状态，但旧手势的剩余输入仍应留在取消会话中
        cancelWheel();
    }

    PointerDownResult PointerInputState::pointerDown(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, const arrange::core::PointerSample& sample, int clicks, arrange::core::PointerGestureOutput& out) {
        PointerDownResult result;
        result.hit = hitTester_.hitTest(snapshot, sample.point);
        // 新的按下打断尚未结束的滚轮会话
        cancelWheel();
        gesture_.primaryDown(tree, snapshot, sample, clicks, out);
        return result;
    }

    void PointerInputState::pointerDrag(const arrange::core::LayoutTree& tree, const arrange::core::PointerSample& sample, arrange::core::PointerGestureOutput& out) {
        gesture_.drag(tree, sample, out);
    }

    void PointerInputState::pointerUp(const arrange::core::LayoutTree& tree, const arrange::core::HitTestSnapshot& snapshot, const arrange::core::PointerSample& sample, arrange::core::PointerGestureOutput& out) {
        gesture_.primaryUp(tree, snapshot, sample, out);
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

    WheelDispatchResult PointerInputState::wheel(arrange::core::LayoutTree& tree, arrange::core::NodeId root, arrange::core::Point point, const WheelInput& input, std::uint64_t publishedRevision, const arrange::core::HitTestSnapshot* snapshot) {
        // 拖动会话独占指针，滚轮直接丢弃且不开启会话
        if (gesture_.dragging()) {
            cancelWheel();
            return {};
        }
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
            if (snapshot)
                for (const auto& item : hitTester_.hitChain(*snapshot, point))
                    if (item.input == arrange::core::InputModifierKind::Wheel) {
                        wheelSession_.candidate = item;
                        break;
                    }
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
        const auto pixels = [&](float delta, WheelUnit unit) {
            return std::isfinite(delta) ? delta * (unit == WheelUnit::Lines ? scrollLineDistance : unit == WheelUnit::Pages ? scrollLineDistance * 8 : 1.0f) : 0.0f;
        };
        const auto& wheel = input;
        const auto deliver = [&](const arrange::core::HitTestResult& receptor) {
            const auto* modifier = arrange::core::liveInputModifier(tree, receptor);
            if (!modifier) return false;
            const auto deltaX = modifier->axis == arrange::core::DragAxis::Vertical ? 0.0f : pixels(wheel.deltaX, wheel.unitX);
            const auto deltaY = modifier->axis == arrange::core::DragAxis::Horizontal ? 0.0f : pixels(wheel.deltaY, wheel.unitY);
            if (deltaX != 0 || deltaY != 0) result.wheelEvent = arrange::core::PointerGestureEvent{modifier->eventSlot, arrange::core::WheelEventPayload{deltaX, deltaY, {}}};
            return true;
        };
        if (wheelSession_.receptor) {
            result.locked = true;
            if (!deliver(*wheelSession_.receptor)) {
                cancelWheel();
                result.sessionCancelled = true;
            }
            if (input.momentumPhase == WheelPhase::Ended) wheelSession_.active = false;
            return result;
        }
        if (wheelSession_.target) {
            result.horizontal = wheelSession_.target->horizontal;
            result.scroll = dispatch(*wheelSession_.target);
            if (!result.scroll.target) {
                cancelWheel();
                result.sessionCancelled = true;
            }
        } else if (hasDelta) {
            const auto axisMagnitude = [](float delta, WheelUnit unit) {
                return std::isfinite(delta) ? std::abs(delta) * (unit == WheelUnit::Lines ? scrollLineDistance : 1.0f) : 0.0f;
            };
            result.horizontal = axisMagnitude(input.deltaX, input.unitX) > axisMagnitude(input.deltaY, input.unitY);
            const auto hasAxis = [&](bool horizontal) {
                for (const auto& target : wheelSession_.initialPath)
                    if (target.horizontal == horizontal && arrange::core::ScrollDispatcher::targetWheel(tree, target, 0, 1).target) return true;
                return false;
            };
            // 主轴没有容器才允许改用次轴；边界不能让次轴噪声接管手势
            if (!hasAxis(result.horizontal) && (result.horizontal ? input.deltaY : input.deltaX) != 0) result.horizontal = !result.horizontal;
            // onWheel 受体接受该轴且比同轴滚动容器更靠内时，整个会话交给它
            if (const auto* receptor = wheelSession_.candidate ? arrange::core::liveInputModifier(tree, *wheelSession_.candidate) : nullptr; receptor && receptor->axis != (result.horizontal ? arrange::core::DragAxis::Vertical : arrange::core::DragAxis::Horizontal)) {
                const auto path = arrange::core::nodePath(tree, wheelSession_.candidate->node);
                const auto inner = std::all_of(wheelSession_.initialPath.begin(), wheelSession_.initialPath.end(), [&](const auto& target) { return target.horizontal != result.horizontal || std::find(path.begin(), path.end(), target.node) != path.end(); });
                if (inner) {
                    wheelSession_.receptor = wheelSession_.candidate;
                    result.locked = true;
                    (void)deliver(*wheelSession_.receptor);
                    if (input.momentumPhase == WheelPhase::Ended) wheelSession_.active = false;
                    return result;
                }
            }
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
