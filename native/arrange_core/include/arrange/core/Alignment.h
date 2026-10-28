#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>

namespace arrange::core {
    // 低两位为水平偏向，高两位为垂直偏向：0 起点、1 居中、2 终点、3 未指定（单轴对齐）
    enum class LayoutAlignment : std::uint8_t {
        TopStart = 0,
        TopCenter = 1,
        TopEnd = 2,
        Top = 3,
        CenterStart = 4,
        Center = 5,
        CenterEnd = 6,
        CenterVertically = 7,
        BottomStart = 8,
        BottomCenter = 9,
        BottomEnd = 10,
        Bottom = 11,
        Start = 12,
        CenterHorizontally = 13,
        End = 14,
        // 只用于 Row 的纵向对齐
        Baseline = 15,
    };

    // 主轴排布；Top / Bottom 归入 Start / End
    enum class Arrangement : std::uint8_t {
        Start,
        Center,
        End,
        SpaceBetween,
        SpaceAround,
        SpaceEvenly,
    };

    constexpr std::uint8_t alignmentBiasBits(LayoutAlignment value, bool horizontal) noexcept {
        const auto bits = static_cast<std::uint8_t>(value);
        return horizontal ? bits & 3u : bits >> 2u;
    }

    // 未指定的轴按起点处理
    constexpr float alignOffset(float parent, float child, LayoutAlignment value, bool horizontal) noexcept {
        const auto bias = alignmentBiasBits(value, horizontal);
        return bias == 3u ? 0.0f : (parent - child) * static_cast<float>(bias) * 0.5f;
    }

    constexpr bool isBoxAlignment(LayoutAlignment value) noexcept {
        return alignmentBiasBits(value, true) != 3u && alignmentBiasBits(value, false) != 3u;
    }

    constexpr bool isHorizontalAlignment(LayoutAlignment value) noexcept {
        return value == LayoutAlignment::Center || value == LayoutAlignment::Start || value == LayoutAlignment::CenterHorizontally || value == LayoutAlignment::End;
    }

    constexpr bool isVerticalAlignment(LayoutAlignment value) noexcept {
        return value == LayoutAlignment::Center || value == LayoutAlignment::Top || value == LayoutAlignment::CenterVertically || value == LayoutAlignment::Bottom;
    }

    constexpr bool isAxisAlignment(LayoutAlignment value, bool horizontal) noexcept {
        return horizontal ? isHorizontalAlignment(value) : isVerticalAlignment(value);
    }

    // 以下解析只在读取边界调用一次，布局热路径只见枚举
    constexpr std::optional<LayoutAlignment> parseLayoutAlignment(std::string_view value) noexcept {
        constexpr std::pair<std::string_view, LayoutAlignment> names[]{
            {"TopStart", LayoutAlignment::TopStart}, {"TopCenter", LayoutAlignment::TopCenter}, {"TopEnd", LayoutAlignment::TopEnd}, {"Top", LayoutAlignment::Top}, {"CenterStart", LayoutAlignment::CenterStart}, {"Center", LayoutAlignment::Center}, {"CenterEnd", LayoutAlignment::CenterEnd}, {"CenterVertically", LayoutAlignment::CenterVertically}, {"BottomStart", LayoutAlignment::BottomStart}, {"BottomCenter", LayoutAlignment::BottomCenter}, {"BottomEnd", LayoutAlignment::BottomEnd}, {"Bottom", LayoutAlignment::Bottom}, {"Start", LayoutAlignment::Start}, {"CenterHorizontally", LayoutAlignment::CenterHorizontally}, {"End", LayoutAlignment::End}, {"Baseline", LayoutAlignment::Baseline},
        };
        for (const auto& [name, alignment] : names)
            if (name == value) return alignment;
        return std::nullopt;
    }

    // distributed 为真时接受 SpaceBetween / SpaceAround / SpaceEvenly；对齐值须与主轴方向一致
    constexpr std::optional<Arrangement> parseArrangement(std::string_view value, bool horizontal, bool distributed) noexcept {
        if (distributed) {
            if (value == "SpaceBetween") return Arrangement::SpaceBetween;
            if (value == "SpaceAround") return Arrangement::SpaceAround;
            if (value == "SpaceEvenly") return Arrangement::SpaceEvenly;
        }
        const auto alignment = parseLayoutAlignment(value);
        if (!alignment || !isAxisAlignment(*alignment, horizontal)) return std::nullopt;
        const auto bias = alignmentBiasBits(*alignment, horizontal);
        return bias == 1u ? Arrangement::Center : bias == 2u ? Arrangement::End : Arrangement::Start;
    }

    struct ArrangementPlacement {
        float offset = 0.0f;
        float spacing = 0.0f;
    };

    // 剩余空间按排布分配为首项偏移与项间额外间距
    constexpr ArrangementPlacement distribute(Arrangement arrangement, float remaining, std::size_t count) noexcept {
        switch (arrangement) {
            case Arrangement::Center:
                return {remaining * 0.5f, 0.0f};
            case Arrangement::End:
                return {remaining, 0.0f};
            case Arrangement::SpaceBetween:
                return count > 1 ? ArrangementPlacement{0.0f, remaining / static_cast<float>(count - 1)} : ArrangementPlacement{};
            case Arrangement::SpaceAround:
                return count ? ArrangementPlacement{remaining / static_cast<float>(count) * 0.5f, remaining / static_cast<float>(count)} : ArrangementPlacement{};
            case Arrangement::SpaceEvenly:
                return count ? ArrangementPlacement{remaining / static_cast<float>(count + 1), remaining / static_cast<float>(count + 1)} : ArrangementPlacement{};
            case Arrangement::Start:
                break;
        }
        return {};
    }
}
