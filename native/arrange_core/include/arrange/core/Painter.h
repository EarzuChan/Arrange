#pragma once

#include "Geometry.h"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <future>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace arrange::core {
    // 绘制内容由资源获取层持有，已发布帧通过共享所有权保留成功内容
    struct PainterContent {
        virtual ~PainterContent() = default;
        std::optional<Size> intrinsicSize;
    };

    // JS 像素缓冲提交的定长位图，非预乘 ARGB；每次提交生成新内容，同一版本只复制一次
    struct PixelBufferContent final : PainterContent {
        int width = 0;
        int height = 0;
        std::vector<std::uint32_t> pixels;
    };

    // filmstrip 视图：同一张图按帧数等分，frame 选其中一帧；frames 为 1 即整图
    struct PainterSnapshot {
        std::uint64_t identity = 0;
        std::uint64_t generation = 0;
        std::uint64_t contentVersion = 0;
        std::shared_ptr<const PainterContent> content;
        std::uint32_t frames = 1;
        std::uint32_t frame = 0;
        bool horizontal = false;
        bool operator==(const PainterSnapshot&) const = default;
    };

    // painter 视图的固有尺寸：filmstrip 取单帧
    [[nodiscard]] inline std::optional<Size> painterIntrinsicSize(const PainterSnapshot& painter) {
        if (!painter.content || !painter.content->intrinsicSize) return std::nullopt;
        auto size = *painter.content->intrinsicSize;
        const auto frames = static_cast<float>(std::max<std::uint32_t>(1, painter.frames));
        if (painter.horizontal)
            size.width /= frames;
        else
            size.height /= frames;
        return size;
    }

    // filmstrip 当前帧在整图固有尺寸中的源矩形
    [[nodiscard]] inline Rect painterFrameRect(const PainterSnapshot& painter, Size whole) {
        const auto frames = static_cast<float>(std::max<std::uint32_t>(1, painter.frames));
        const auto index = static_cast<float>(std::min(painter.frame, std::max<std::uint32_t>(1, painter.frames) - 1));
        if (painter.horizontal) return {whole.width / frames * index, 0, whole.width / frames, whole.height};
        return {0, whole.height / frames * index, whole.width, whole.height / frames};
    }

    // 图片铺放：拉伸按内容缩放，平铺按固有尺寸重复，九宫格四角保持源尺寸、边与中心拉伸
    enum class ImageRepeat : std::uint8_t { None, Tile, NinePatch };

    struct ImageSlices {
        float left = 0.0f;
        float top = 0.0f;
        float right = 0.0f;
        float bottom = 0.0f;
        bool operator==(const ImageSlices&) const = default;
    };

    struct PainterLoadResult {
        std::shared_ptr<const PainterContent> content;
        std::string error;
    };

    using PainterLoader = std::function<std::future<PainterLoadResult>(const std::string&, std::function<void()>)>;
}
