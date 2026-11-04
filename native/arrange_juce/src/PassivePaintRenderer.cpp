#include <arrange/juce/PassivePaintRenderer.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <stdexcept>
#include <chrono>

namespace arrange::juce {
    void PassivePaintRenderer::clearResources() {
        textLayoutService_.clearCache();
    }

    void PassivePaintRenderer::prepareResources(arrange::core::PublishedFrameContent& content) {
        const auto started = std::chrono::steady_clock::now();
        for (auto* ops : {&content.overlayDrawOps, &content.diagnosticsErrorDrawOps, &content.diagnosticsBadgeDrawOps, &content.diagnosticsToastDrawOps}) {
            for (auto& op : *ops) arrange::core::DrawOpsBuilder::prepareText(op, textLayoutService_);
        }
        preparationMillis_ += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    }

    double PassivePaintRenderer::paint(::juce::Graphics& g, const arrange::core::PublishedFrame& frame, const std::vector<arrange::core::DrawOp>& diagnosticsOverlay) {
        const auto started = std::chrono::steady_clock::now();
        ++fullViewportPaints_;
        lastFullPaintReason_ = "宿主重绘复用已发布片段，并跳过确定不可见的绘制";
        g.fillAll(::juce::Colour(0xff1f232a));
        const auto& content = frame.content;
        if (content.errorFrame) {
            (void)drawOpsPainter_.paint(g, content.diagnosticsErrorDrawOps);
        } else {
            (void)drawOpsPainter_.paint(g, content.scenePaint, content.focusedInputModifier, content.focusedInputViewportX, content.overlayDrawOps);
        }
        if (!diagnosticsOverlay.empty()) (void)drawOpsPainter_.paint(g, diagnosticsOverlay);
        (void)drawOpsPainter_.paint(g, content.diagnosticsBadgeDrawOps);
        (void)drawOpsPainter_.paint(g, content.diagnosticsToastDrawOps);
        const auto millis = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        paintMillis_ += millis;
        return millis;
    }
}

#endif
