#pragma once

#include <cstdint>

namespace arrange::core {
    // 单次或累计重放诊断；时间是 CPU 调用耗时，各项可能嵌套，不可直接相加
    struct RenderFrameMetrics {
        std::uint64_t paints = 0;
        std::uint64_t bitmapHits = 0;
        std::uint64_t bitmapBuilds = 0;
        std::uint64_t bitmapEvictions = 0;
        std::uint64_t nativeConversions = 0;
        std::uint64_t nativeBytes = 0;
        std::uint64_t svgMaskBuilds = 0;
        std::uint64_t svgMaskHits = 0;
        double bitmapBuildMillis = 0;
        double nativeConvertMillis = 0;
        double svgMaskMillis = 0;
        // 保留量为本次绘制后的状态，累计时取最后值
        std::uint64_t bitmapRetainedBytes = 0;
    };
}
