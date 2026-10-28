#pragma once

#include "LayoutNode.h"

#include <cstdint>
#include <utility>

namespace arrange::core {
    struct InvalidationSnapshot {
        std::uint32_t combinedDirty = 0;
        bool needsFullFallback = false;

        [[nodiscard]] bool empty() const noexcept {
            return combinedDirty == 0 && !needsFullFallback;
        }

        [[nodiscard]] bool affects(DirtyFlag flag) const noexcept {
            return (combinedDirty & dirtyMask(flag)) != 0;
        }
    };

    // 帧内失效只汇总为位掩码，阶段计划按它决定
    class InvalidationGraph {
       public:
        void record(std::uint32_t dirty) noexcept {
            snapshot_.combinedDirty |= dirty;
        }

        void requireFullFallback() noexcept {
            snapshot_.needsFullFallback = true;
        }

        [[nodiscard]] const InvalidationSnapshot& snapshot() const noexcept {
            return snapshot_;
        }

        [[nodiscard]] InvalidationSnapshot take() noexcept {
            return std::exchange(snapshot_, {});
        }

        void clear() noexcept {
            snapshot_ = {};
        }

       private:
        InvalidationSnapshot snapshot_;
    };
}
