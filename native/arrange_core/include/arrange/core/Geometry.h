#pragma once
#include <cmath>
#include <limits>
#include <stdexcept>

namespace arrange::core {
    struct Size {
        float width = 0.0f;
        float height = 0.0f;
        bool operator==(const Size&) const = default;
    };

    struct Point {
        float x = 0.0f;
        float y = 0.0f;
        bool operator==(const Point&) const = default;
    };

    struct Rect {
        float x = 0.0f;
        float y = 0.0f;
        float width = 0.0f;
        float height = 0.0f;
        bool operator==(const Rect&) const = default;
    };

    struct Constraints {
        static constexpr float Infinity = std::numeric_limits<float>::infinity();
        float minWidth = 0.0f;
        float maxWidth = 0.0f;
        float minHeight = 0.0f;
        float maxHeight = 0.0f;

        bool hasBoundedWidth() const noexcept {
            return std::isfinite(maxWidth);
        }

        bool hasBoundedHeight() const noexcept {
            return std::isfinite(maxHeight);
        }

        void validate() const {
            if (!std::isfinite(minWidth) || !std::isfinite(minHeight) || minWidth < 0 || minHeight < 0 || std::isnan(maxWidth) || std::isnan(maxHeight) || maxWidth < minWidth || maxHeight < minHeight) throw std::invalid_argument("布局约束必须非负，最小值有限且不超过最大值");
        }

        bool operator==(const Constraints&) const = default;
    };
}
