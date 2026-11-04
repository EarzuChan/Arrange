#pragma once

#include <arrange/core/LayoutNode.h>
#include <arrange/core/Paint.h>
#include <arrange/juce/BitmapCache.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>
#include <vector>
#include <span>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct PaintReplayCounters {
        std::uint64_t fragmentsVisited = 0;
        std::uint64_t fragmentsSkipped = 0;
        std::uint64_t opsVisited = 0;
        std::uint64_t opsSkipped = 0;
        std::uint64_t textSubmissions = 0;
        double glyphSubmitMillis = 0;
    };

    class JuceDrawOpsPainter final {
       public:
        struct PaintResult {
            std::optional<ErrorScreenModel> error;
        };

        PaintResult paint(::juce::Graphics& g, const std::vector<arrange::core::DrawOp>& ops, arrange::core::ModifierHandle focusedInputModifier = {}, float focusedInputViewportX = 0.0f, std::span<const arrange::core::DrawOp> focusedInputOps = {}) const;

        PaintResult paint(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& root, arrange::core::ModifierHandle focusedInputModifier = {}, float viewportX = 0, std::span<const arrange::core::DrawOp> focusedInputOps = {}) const;

        void setCullingEnabled(bool enabled) noexcept {
            cullingEnabled_ = enabled;
        }

        PaintReplayCounters counters() const noexcept {
            return counters_;
        }

        void resetCounters() const noexcept {
            counters_ = {};
        }

        // 渐变、阴影与模糊等离屏结果的缓存，跨帧保留
        BitmapCache& bitmapCache() const noexcept {
            return bitmapCache_;
        }

       private:
        bool invisible(::juce::Graphics& graphics, arrange::core::PaintBounds bounds) const;
        void replayFragment(::juce::Graphics& graphics, const arrange::core::PlacedPaintFragment& placed, arrange::core::ModifierHandle focusedInputModifier, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha) const;
        void replayScopedOps(::juce::Graphics& graphics, std::span<const arrange::core::DrawOp> ops, arrange::core::ModifierHandle focusedInputModifier, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha) const;
        void replayOps(::juce::Graphics& graphics, std::span<const arrange::core::DrawOp> ops, arrange::core::ModifierHandle focusedInputModifier, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha, int& depth) const;
        void drawText(::juce::Graphics& g, const arrange::core::DrawOp& op, float viewportX, float alpha) const;
        void drawPainter(::juce::Graphics& g, const arrange::core::DrawOp& op, ::juce::Rectangle<float> rect, float alpha) const;
        ::juce::Image pixelImage(const std::shared_ptr<const arrange::core::PainterContent>& content) const;
        void fillWithPaint(::juce::Graphics& g, const ::juce::Path& path, const arrange::core::DrawOp& op, ::juce::Rectangle<float> box, float alpha) const;
        ::juce::Image sweepImage(::juce::Graphics& g, const arrange::core::GradientRef& gradient, ::juce::Rectangle<float> box) const;
        // 效果层的重放；返回 true 表示子片段已由效果自行绘制
        bool replayEffect(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& placed, const arrange::core::EffectModifier& effect, arrange::core::ModifierHandle focused, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha) const;
        // 从根重放到目标片段之前，得到目标层局部 area 内已绘制的内容
        ::juce::Image captureBackdrop(const arrange::core::PlacedPaintFragment& target, ::juce::Rectangle<float> area, float scale, int width, int height) const;

        bool cullingEnabled_ = true;
        mutable BitmapCache bitmapCache_;
        mutable PaintReplayCounters counters_;
        // 背景模糊需要回到根重放：记录根、焦点输入与当前层局部到根的逻辑变换
        mutable const arrange::core::PlacedPaintFragment* root_ = nullptr;
        mutable arrange::core::ModifierHandle focused_;
        mutable std::span<const arrange::core::DrawOp> focusedOps_;
        mutable ::juce::AffineTransform transform_;
        mutable std::vector<::juce::AffineTransform> transformStack_;
        mutable const arrange::core::PlacedPaintFragment* stopAt_ = nullptr;
        mutable bool stopped_ = false;
    };

#endif
}
