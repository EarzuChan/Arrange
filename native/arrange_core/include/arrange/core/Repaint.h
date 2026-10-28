#pragma once

#include "Paint.h"

#include <cstddef>
#include <vector>

namespace arrange::core {
    // 宿主重绘请求：full 为整块重绘，rects 为窗口坐标下已外扩取整的局部区域
    struct RepaintRegion {
        bool full = false;
        std::vector<Rect> rects;

        [[nodiscard]] bool empty() const noexcept {
            return !full && rects.empty();
        }

        bool operator==(const RepaintRegion&) const = default;
    };

    struct RepaintLimits {
        std::size_t maxRects = 8;
        // 收集期合并后仍超过此数即整块重绘，避免大量变化在合并上耗时
        std::size_t maxCollectedRects = 32;
        float maxAreaRatio = 0.5f;
        float mergeGap = 8.0f;
    };

    // 收集新旧绘制片段的变化范围；任一处边界无法界定即整块重绘
    class RepaintDamage {
       public:
        explicit RepaintDamage(RepaintLimits limits = {}) noexcept : limits_(limits) {}

        void markFull() noexcept {
            full_ = true;
            rects_.clear();
        }

        [[nodiscard]] bool full() const noexcept {
            return full_;
        }

        // 收集时即与相邻区域合并，区域数保持在 maxCollectedRects 以内
        void addRect(Rect rect);
        void compareScene(const PlacedPaintFragment& before, const PlacedPaintFragment& after);
        // 聚焦 Input 的局部编辑命令在 TextField 叶项原位重放，范围取叶项在窗口中的区域；找不到叶项则整块重绘
        void addInputField(const PlacedPaintFragment& scene, ModifierHandle field);
        [[nodiscard]] RepaintRegion finish(Size viewport) const;

       private:
        RepaintLimits limits_;
        bool full_ = false;
        std::vector<Rect> rects_;
    };
}
