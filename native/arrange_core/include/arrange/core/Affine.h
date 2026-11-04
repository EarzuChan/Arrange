#pragma once

#include "Geometry.h"

#include <algorithm>
#include <cmath>
#include <optional>

namespace arrange::core {
    // 二维仿射变换：x' = a·x + c·y + tx，y' = b·x + d·y + ty
    struct Affine {
        double a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0;

        static Affine translation(double x, double y) noexcept {
            return {1, 0, 0, 1, x, y};
        }

        // 与 JUCE 重放一致：绕 rect 内比例轴心先缩放、再旋转，最后平移
        static Affine layer(Rect rect, double originX, double originY, double scaleX, double scaleY, double rotationZ, double translationX, double translationY) noexcept {
            const double px = rect.x + rect.width * originX;
            const double py = rect.y + rect.height * originY;
            const auto radians = rotationZ * 3.14159265358979323846 / 180.0;
            const auto cosine = std::cos(radians), sine = std::sin(radians);
            Affine result{cosine * scaleX, sine * scaleX, -sine * scaleY, cosine * scaleY, 0, 0};
            result.tx = px + translationX - result.a * px - result.c * py;
            result.ty = py + translationY - result.b * px - result.d * py;
            return result;
        }

        // 先应用 inner，再应用本变换
        [[nodiscard]] Affine after(const Affine& inner) const noexcept {
            return {
                a * inner.a + c * inner.b, b * inner.a + d * inner.b, a * inner.c + c * inner.d, b * inner.c + d * inner.d, a * inner.tx + c * inner.ty + tx, b * inner.tx + d * inner.ty + ty,
            };
        }

        // 四角投影的外包盒；坐标非有限时返回空
        [[nodiscard]] std::optional<Rect> project(const Rect& r) const noexcept {
            double left = 0, top = 0, right = 0, bottom = 0;
            bool first = true;
            for (const double x : {static_cast<double>(r.x), static_cast<double>(r.x) + r.width})
                for (const double y : {static_cast<double>(r.y), static_cast<double>(r.y) + r.height}) {
                    const auto px = a * x + c * y + tx;
                    const auto py = b * x + d * y + ty;
                    if (!std::isfinite(px) || !std::isfinite(py)) return std::nullopt;
                    left = first ? px : std::min(left, px);
                    top = first ? py : std::min(top, py);
                    right = first ? px : std::max(right, px);
                    bottom = first ? py : std::max(bottom, py);
                    first = false;
                }
            return Rect{static_cast<float>(left), static_cast<float>(top), static_cast<float>(right - left), static_cast<float>(bottom - top)};
        }
    };

    inline Rect intersectRect(const Rect& a, const Rect& b) noexcept {
        const auto left = std::max(a.x, b.x), top = std::max(a.y, b.y);
        const auto right = std::min(a.x + a.width, b.x + b.width), bottom = std::min(a.y + a.height, b.y + b.height);
        return {left, top, std::max(0.0f, right - left), std::max(0.0f, bottom - top)};
    }
}
