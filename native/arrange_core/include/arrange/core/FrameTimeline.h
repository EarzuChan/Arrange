#pragma once

#include "Geometry.h"
#include "Repaint.h"

#include <cstddef>
#include <cstdint>
#include <iterator>
#include <utility>
#include <vector>

namespace arrange::core {
    // 一帧各阶段耗时，单位毫秒；paint 为宿主重放该帧的累计耗时
    struct FrameStageMillis {
        double measure = 0;
        double place = 0;
        double drawPrepare = 0;
        double paintBuild = 0;
        double hitBuild = 0;
        double total = 0;
        double paint = 0;
    };

    // 诊断第 0 层的一条帧记录：只含原生已有的数据，不读取 JS 内部状态
    struct FrameRecord {
        // 时间线内递增序号，清空后不回退
        std::uint64_t sequence = 0;
        std::uint64_t revision = 0;
        double timeMillis = 0;
        bool failed = false;
        std::uint32_t phases = 0;
        FrameStageMillis millis;
        std::uint64_t measuredNodes = 0;
        std::uint64_t measureCacheHits = 0;
        std::uint64_t placedNodes = 0;
        std::uint64_t placeCacheHits = 0;
        std::uint64_t fragmentsBuilt = 0;
        std::uint64_t fragmentsReused = 0;
        std::uint64_t contentBuilds = 0;
        std::uint64_t contentReuses = 0;
        std::uint64_t emittedOps = 0;
        std::uint64_t hitNodesBuilt = 0;
        std::uint64_t hitSubtreeCacheHits = 0;
        // 绘制修饰器与 Canvas 的重录次数
        std::uint64_t drawRecords = 0;
        std::size_t nodes = 0;
        // 场景脏区，不含诊断叠加层自身的重绘
        RepaintRegion repaint;
    };

    // 最近若干帧的环形时间线；关闭时 record 直接返回，管线也不准备记录
    class FrameTimeline {
       public:
        explicit FrameTimeline(std::size_t capacity = 240) : capacity_(capacity == 0 ? 1 : capacity) {}

        [[nodiscard]] bool enabled() const noexcept {
            return enabled_;
        }

        // 关闭时丢弃已有记录，再开启从空时间线开始
        void setEnabled(bool enabled) {
            if (enabled_ == enabled) return;
            enabled_ = enabled;
            if (!enabled) clear();
        }

        [[nodiscard]] std::size_t capacity() const noexcept {
            return capacity_;
        }

        void setCapacity(std::size_t capacity) {
            auto frames = snapshot();
            capacity_ = capacity == 0 ? 1 : capacity;
            if (frames.size() > capacity_) frames.erase(frames.begin(), frames.end() - static_cast<std::ptrdiff_t>(capacity_));
            records_ = std::move(frames);
            head_ = 0;
        }

        [[nodiscard]] std::size_t size() const noexcept {
            return records_.size();
        }

        [[nodiscard]] bool empty() const noexcept {
            return records_.empty();
        }

        // 0 为最旧一帧
        [[nodiscard]] const FrameRecord& at(std::size_t index) const {
            return records_[(head_ + index) % records_.size()];
        }

        [[nodiscard]] const FrameRecord* latest() const noexcept {
            return records_.empty() ? nullptr : &at(records_.size() - 1);
        }

        // 按时间先后复制全部记录
        [[nodiscard]] std::vector<FrameRecord> snapshot() const {
            std::vector<FrameRecord> frames;
            frames.reserve(records_.size());
            for (std::size_t index = 0; index < records_.size(); ++index) frames.push_back(at(index));
            return frames;
        }

        // 累计记录过的帧数
        [[nodiscard]] std::uint64_t recorded() const noexcept {
            return sequence_;
        }

        void record(FrameRecord frame) {
            if (!enabled_) return;
            frame.sequence = ++sequence_;
            if (records_.size() < capacity_) {
                records_.push_back(std::move(frame));
                return;
            }
            records_[head_] = std::move(frame);
            head_ = (head_ + 1) % records_.size();
        }

        // 宿主重放发布帧后补记绘制耗时；同一修订多次重放累加
        void notePaint(std::uint64_t revision, double millis) noexcept {
            if (!enabled_ || records_.empty()) return;
            auto& last = records_[(head_ + records_.size() - 1) % records_.size()];
            if (last.revision == revision && !last.failed) last.millis.paint += millis;
        }

        void clear() noexcept {
            records_.clear();
            head_ = 0;
        }

       private:
        bool enabled_ = false;
        std::size_t capacity_;
        std::size_t head_ = 0;
        std::uint64_t sequence_ = 0;
        std::vector<FrameRecord> records_;
    };
}
