#pragma once
#include <algorithm>
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

    // 四角半径；当前只有从左到右布局，start 即左侧
    struct CornerRadii {
        float topStart = 0.0f;
        float topEnd = 0.0f;
        float bottomEnd = 0.0f;
        float bottomStart = 0.0f;

        static constexpr CornerRadii uniform(float radius) noexcept {
            return {radius, radius, radius, radius};
        }

        // 同一边上两角之和超过边长时整体等比缩小，与 CSS 一致
        [[nodiscard]] CornerRadii fitted(float width, float height) const noexcept {
            auto scale = 1.0f;
            const auto limit = [&](float length, float first, float second) {
                if (first + second > length && first + second > 0) scale = std::min(scale, std::max(0.0f, length) / (first + second));
            };
            limit(width, topStart, topEnd);
            limit(width, bottomStart, bottomEnd);
            limit(height, topStart, bottomStart);
            limit(height, topEnd, bottomEnd);
            return {topStart * scale, topEnd * scale, bottomEnd * scale, bottomStart * scale};
        }

        bool operator==(const CornerRadii&) const = default;
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
