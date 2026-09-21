#pragma once

#include "Geometry.h"

#include <cstdint>
#include <functional>
#include <future>
#include <memory>
#include <optional>
#include <string>

namespace arrange::core {
    // 绘制内容由资源获取层持有，已发布帧通过共享所有权保留成功内容
    struct PainterContent {
        virtual ~PainterContent() = default;
        std::optional<Size> intrinsicSize;
    };

    struct PainterSnapshot {
        std::uint64_t identity = 0;
        std::uint64_t generation = 0;
        std::uint64_t contentVersion = 0;
        std::shared_ptr<const PainterContent> content;
        bool operator==(const PainterSnapshot&) const = default;
    };

    struct PainterLoadResult {
        std::shared_ptr<const PainterContent> content;
        std::string error;
    };

    using PainterLoader = std::function<std::future<PainterLoadResult>(const std::string&)>;
}  // namespace arrange::core
