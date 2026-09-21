#pragma once

#include <string_view>

namespace arrange::core {
    constexpr bool isBoxAlignment(std::string_view value) noexcept {
        return value == "TopStart" || value == "TopCenter" || value == "TopEnd" || value == "CenterStart" || value == "Center" || value == "CenterEnd" || value == "BottomStart" || value == "BottomCenter" || value == "BottomEnd";
    }

    constexpr bool isHorizontalAlignment(std::string_view value) noexcept {
        return value == "Start" || value == "Center" || value == "CenterHorizontally" || value == "End";
    }

    constexpr bool isVerticalAlignment(std::string_view value) noexcept {
        return value == "Top" || value == "Center" || value == "CenterVertically" || value == "Bottom";
    }

    constexpr bool isImageAlignment(std::string_view value) noexcept {
        return isBoxAlignment(value) || isHorizontalAlignment(value) || isVerticalAlignment(value);
    }
}  // namespace arrange::core
