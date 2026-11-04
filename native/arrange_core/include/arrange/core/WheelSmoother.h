#pragma once

#include "Geometry.h"
#include "WheelInput.h"

#include <optional>
#include <utility>

namespace arrange::core {
    // 普通鼠标滚轮每格是一次离散跳变；平滑器把每格距离在短时间内按缓出曲线分发成连续小增量
    // 连续拨动时目标累加并从当前位置重新起算，反向拨动丢弃未走完的距离
    // 精细位移、系统惯性与带原生阶段的输入本身已连续，原样交还调用方
    class WheelSmoother {
       public:
        static constexpr double durationMillis = 140.0;

        // 返回 true 表示已接管这次输入，之后由 tick 分发
        bool push(Point point, const WheelInput& input, double nowMillis);
        // 产出截至 nowMillis 应分发的增量；没有可分发的距离时返回空
        [[nodiscard]] std::optional<std::pair<Point, WheelInput>> tick(double nowMillis);
        void cancel() noexcept;

        [[nodiscard]] bool active() const noexcept {
            return active_;
        }

       private:
        struct Axis {
            float start = 0;
            float target = 0;
            float emitted = 0;
            WheelUnit unit = WheelUnit::Lines;

            [[nodiscard]] bool moving() const noexcept {
                return target != emitted;
            }
        };

        bool accept(Axis& axis, float delta, WheelUnit unit) const noexcept;

        Axis x_;
        Axis y_;
        Point point_;
        double startMillis_ = 0;
        bool active_ = false;
    };
}
