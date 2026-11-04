#pragma once

#include "FrameTimeline.h"
#include "SceneFramePipeline.h"

#include <cstdint>
#include <optional>
#include <vector>

namespace arrange::core {
    // 叠加层各部分的开关；整体开关另由 DiagnosticsOverlay::setEnabled 控制
    struct OverlayLayers {
        bool frameTime = true;
        bool status = true;
        bool dirtyFlash = true;
        bool bounds = false;
        bool hit = false;
        bool operator==(const OverlayLayers&) const = default;
    };

    // 已提交场景中一个节点在窗口坐标下的外包盒
    struct NodeOutline {
        NodeId node = 0;
        Rect rect;
    };

    // 第 0 层的只读几何：按树序收集节点外包盒，计入祖先与节点之前的变换
    std::vector<NodeOutline> collectNodeOutlines(const LayoutTree& tree, NodeId root);

    // 诊断第 1 层：只读时间线、发布帧与提交场景几何，产出框架表层绘制命令与自身重绘范围
    class DiagnosticsOverlay {
       public:
        static constexpr double flashMillis = 400;
        static constexpr std::size_t graphFrames = 60;

        void setEnabled(bool enabled) noexcept {
            enabled_ = enabled;
        }

        [[nodiscard]] bool enabled() const noexcept {
            return enabled_;
        }

        void setLayers(OverlayLayers layers) noexcept {
            layers_ = layers;
        }

        [[nodiscard]] const OverlayLayers& layers() const noexcept {
            return layers_;
        }

        // 窗口坐标下的指针位置，供命中高亮
        void setPointer(std::optional<Point> pointer) noexcept {
            pointer_ = pointer;
        }

        // 每个视觉 tick 调用；返回叠加层自身需要的重绘范围，不计入场景脏区
        RepaintRegion update(const FrameTimeline& timeline, const PublishedFrame& frame, const LayoutTree& tree, NodeId root, double nowMillis);

        [[nodiscard]] const std::vector<DrawOp>& ops() const noexcept {
            return ops_;
        }

        // 脏区闪烁尚未褪尽时需要继续 tick
        [[nodiscard]] bool animating() const noexcept {
            return !flashes_.empty();
        }

       private:
        struct Flash {
            Rect rect;
            double started = 0;
        };

        // 各部分各自记录覆盖范围，只重绘变化的部分
        struct Part {
            std::vector<DrawOp> ops;
            std::vector<Rect> areas;
        };

        Part buildFlashes(double nowMillis) const;
        Part buildBounds() const;
        Part buildHit(const PublishedFrame& frame) const;
        Part buildPanel(const FrameTimeline& timeline) const;

        bool enabled_ = false;
        OverlayLayers layers_;
        std::optional<Point> pointer_;
        std::uint64_t seenSequence_ = 0;
        std::vector<Flash> flashes_;
        std::uint64_t outlineRevision_ = 0;
        std::vector<NodeOutline> outlines_;
        Part flash_;
        Part bounds_;
        Part hit_;
        Part panel_;
        std::vector<DrawOp> ops_;
    };
}
