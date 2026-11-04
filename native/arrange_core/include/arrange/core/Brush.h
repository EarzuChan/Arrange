#pragma once

#include "Geometry.h"

#include <cstdint>
#include <memory>
#include <vector>

namespace arrange::core {
    // 不可变共享值：复制只增引用，按内容比较
    template <class T>
    struct SharedValue {
        std::shared_ptr<const T> value;

        SharedValue() = default;

        explicit SharedValue(T input) : value(std::make_shared<const T>(std::move(input))) {}

        explicit operator bool() const noexcept {
            return static_cast<bool>(value);
        }

        const T& operator*() const noexcept {
            return *value;
        }

        const T* operator->() const noexcept {
            return value.get();
        }

        bool operator==(const SharedValue& other) const {
            return value == other.value || value && other.value && *value == *other.value;
        }
    };

    enum class GradientKind : std::uint8_t { Linear, Radial, Sweep };

    struct GradientStop {
        float position = 0;
        std::uint32_t color = 0;
        bool operator==(const GradientStop&) const = default;
    };

    // 渐变几何取所绘形状外包盒的 0 到 1 比例；径向半径 1 表示到达离中心最远的角，扫描起始角为度数，0 指向右侧、顺时针
    struct Gradient {
        GradientKind kind = GradientKind::Linear;
        std::vector<GradientStop> stops;
        Point start{0, 0};
        Point end{0, 1};
        Point center{0.5f, 0.5f};
        float radius = 1;
        float startAngle = 0;
        bool operator==(const Gradient&) const = default;
    };

    using GradientRef = SharedValue<Gradient>;

    enum class StrokeCap : std::uint8_t { Butt, Round, Square };
    enum class StrokeJoin : std::uint8_t { Miter, Round, Bevel };

    // 路径动词的参数个数：moveTo、lineTo 2，quadTo 4，cubicTo 6，arcTo 7（矩形、起始角、扫过角、是否另起子路径），close 0
    enum class PathVerb : std::uint8_t { MoveTo, LineTo, QuadTo, CubicTo, ArcTo, Close };

    constexpr int pathVerbArity(PathVerb verb) noexcept {
        switch (verb) {
            case PathVerb::MoveTo:
            case PathVerb::LineTo:
                return 2;
            case PathVerb::QuadTo:
                return 4;
            case PathVerb::CubicTo:
                return 6;
            case PathVerb::ArcTo:
                return 7;
            case PathVerb::Close:
                return 0;
        }
        return 0;
    }

    // 路径数据，坐标为层局部 PX；bounds 是全部端点、控制点与弧所在矩形的外包盒
    struct PathData {
        std::vector<PathVerb> verbs;
        std::vector<float> values;
        Rect bounds;
        bool evenOdd = false;
        bool operator==(const PathData&) const = default;
    };

    using PathRef = SharedValue<PathData>;
}
