#include <arrange/core/WheelSmoother.h>

#include <algorithm>
#include <cmath>

namespace arrange::core {
    namespace {
        float easeOutCubic(float t) noexcept {
            const auto inverse = 1.0f - t;
            return 1.0f - inverse * inverse * inverse;
        }
    }

    bool WheelSmoother::accept(Axis& axis, float delta, WheelUnit unit) const noexcept {
        if (delta == 0) return true;
        // 单位变化时不混算，交还调用方直接分发
        if (axis.moving() && axis.unit != unit) return false;
        return std::isfinite(delta);
    }

    bool WheelSmoother::push(Point point, const WheelInput& input, double nowMillis) {
        if (input.precise || input.inertial || input.nativePhases || input.phase != WheelPhase::None || input.momentumPhase != WheelPhase::None) return false;
        if (!accept(x_, input.deltaX, input.unitX) || !accept(y_, input.deltaY, input.unitY)) {
            cancel();
            return false;
        }
        const auto retarget = [](Axis& axis, float delta, WheelUnit unit) {
            if (delta == 0) {
                // 另一轴的输入不打断本轴，但本轴从当前位置继续走完余下距离
                axis.start = axis.emitted;
                return;
            }
            const auto remaining = axis.target - axis.emitted;
            axis.unit = unit;
            axis.start = axis.emitted;
            axis.target = (remaining != 0 && (remaining > 0) != (delta > 0) ? axis.emitted : axis.target) + delta;
        };
        retarget(x_, input.deltaX, input.unitX);
        retarget(y_, input.deltaY, input.unitY);
        point_ = point;
        startMillis_ = nowMillis;
        active_ = x_.moving() || y_.moving();
        return true;
    }

    std::optional<std::pair<Point, WheelInput>> WheelSmoother::tick(double nowMillis) {
        if (!active_) return std::nullopt;
        const auto progress = static_cast<float>(std::clamp((nowMillis - startMillis_) / durationMillis, 0.0, 1.0));
        const auto eased = easeOutCubic(progress);
        WheelInput input;
        input.timeMillis = nowMillis;
        const auto advance = [&](Axis& axis, float& delta, WheelUnit& unit) {
            if (!axis.moving()) return;
            const auto position = progress >= 1.0f ? axis.target : axis.start + (axis.target - axis.start) * eased;
            delta = position - axis.emitted;
            unit = axis.unit;
            axis.emitted = position;
        };
        advance(x_, input.deltaX, input.unitX);
        advance(y_, input.deltaY, input.unitY);
        if (progress >= 1.0f) cancel();
        if (input.deltaX == 0 && input.deltaY == 0) return std::nullopt;
        return std::pair{point_, input};
    }

    void WheelSmoother::cancel() noexcept {
        x_ = {};
        y_ = {};
        active_ = false;
    }
}
