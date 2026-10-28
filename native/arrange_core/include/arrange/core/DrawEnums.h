#pragma once

#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>

namespace arrange::core {
    enum class TextAlign : std::uint8_t {
        Start,
        Center,
        End,
    };

    enum class TextOverflow : std::uint8_t {
        Clip,
        Ellipsis,
        Visible,
    };

    // Unscaled 对应 Compose 的 ContentScale.None，避开平台头文件里的 None 宏
    enum class ContentScale : std::uint8_t {
        Fit,
        Crop,
        FillBounds,
        Inside,
        Unscaled,
        FillWidth,
        FillHeight,
    };

    // 低两位为水平偏向，高两位为垂直偏向：0 起点、1 居中、2 终点
    enum class ImageAlignment : std::uint8_t {
        TopStart = 0,
        TopCenter = 1,
        TopEnd = 2,
        CenterStart = 4,
        Center = 5,
        CenterEnd = 6,
        BottomStart = 8,
        BottomCenter = 9,
        BottomEnd = 10,
    };

    constexpr float horizontalBias(ImageAlignment value) noexcept {
        return static_cast<float>(static_cast<std::uint8_t>(value) & 3u) * 0.5f;
    }

    constexpr float verticalBias(ImageAlignment value) noexcept {
        return static_cast<float>(static_cast<std::uint8_t>(value) >> 2u) * 0.5f;
    }

    constexpr float textAlignShift(TextAlign align, float available, float width) noexcept {
        if (align == TextAlign::Center) return (available - width) * 0.5f;
        return align == TextAlign::End ? available - width : 0.0f;
    }

    // 以下解析只在 QuickJS 读取边界调用一次，热路径只见枚举
    constexpr std::optional<TextAlign> parseTextAlign(std::string_view value) noexcept {
        if (value == "Start" || value == "start" || value == "left") return TextAlign::Start;
        if (value == "Center" || value == "center") return TextAlign::Center;
        if (value == "End" || value == "end" || value == "right") return TextAlign::End;
        return std::nullopt;
    }

    constexpr std::optional<TextOverflow> parseTextOverflow(std::string_view value) noexcept {
        if (value == "clip") return TextOverflow::Clip;
        if (value == "ellipsis") return TextOverflow::Ellipsis;
        if (value == "visible") return TextOverflow::Visible;
        return std::nullopt;
    }

    constexpr std::optional<ContentScale> parseContentScale(std::string_view value) noexcept {
        if (value == "Fit") return ContentScale::Fit;
        if (value == "Crop") return ContentScale::Crop;
        if (value == "FillBounds") return ContentScale::FillBounds;
        if (value == "Inside") return ContentScale::Inside;
        if (value == "None") return ContentScale::Unscaled;
        if (value == "FillWidth") return ContentScale::FillWidth;
        if (value == "FillHeight") return ContentScale::FillHeight;
        return std::nullopt;
    }

    // 单轴对齐取另一轴居中
    constexpr std::optional<ImageAlignment> parseImageAlignment(std::string_view value) noexcept {
        constexpr std::pair<std::string_view, ImageAlignment> names[]{
            {"TopStart", ImageAlignment::TopStart}, {"TopCenter", ImageAlignment::TopCenter}, {"TopEnd", ImageAlignment::TopEnd}, {"CenterStart", ImageAlignment::CenterStart}, {"Center", ImageAlignment::Center}, {"CenterEnd", ImageAlignment::CenterEnd}, {"BottomStart", ImageAlignment::BottomStart}, {"BottomCenter", ImageAlignment::BottomCenter}, {"BottomEnd", ImageAlignment::BottomEnd}, {"Start", ImageAlignment::CenterStart}, {"End", ImageAlignment::CenterEnd}, {"CenterHorizontally", ImageAlignment::Center}, {"Top", ImageAlignment::TopCenter}, {"Bottom", ImageAlignment::BottomCenter}, {"CenterVertically", ImageAlignment::Center},
        };
        for (const auto& [name, alignment] : names)
            if (name == value) return alignment;
        return std::nullopt;
    }
}
