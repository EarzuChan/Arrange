#include <arrange/juce/PassivePaintRenderer.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <stdexcept>
#include <chrono>

namespace arrange::juce {
    void PassivePaintRenderer::clearResources() { textLayoutService_.clearCache(); }

    void PassivePaintRenderer::prepareResources(arrange::core::PublishedFrameContent& content) {
        const auto started = std::chrono::steady_clock::now();
        for (auto* ops : {&content.overlayDrawOps, &content.diagnosticsErrorDrawOps,
                               &content.diagnosticsBadgeDrawOps, &content.diagnosticsToastDrawOps}) {
            for (auto& op : *ops) arrange::core::DrawOpsBuilder::prepareText(op, textLayoutService_);
        }
        preparationMillis_ += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    }

    void PassivePaintRenderer::paint(::juce::Graphics& g, const arrange::core::PublishedFrame& frame) {
        const auto started = std::chrono::steady_clock::now();
        ++fullViewportPaints_;
        lastFullPaintReason_ = "宿主重绘复用已发布片段，并跳过确定不可见的绘制";
        g.fillAll(::juce::Colour(0xff1f232a));
        const auto& content = frame.content;
        if (content.errorFrame) {
            (void)drawOpsPainter_.paint(g, content.diagnosticsErrorDrawOps);
        }
        else {
            (void)drawOpsPainter_.paint(g, content.scenePaint, content.focusedInputModifier, content.focusedInputViewportX);
            (void)drawOpsPainter_.paint(g, content.overlayDrawOps, content.focusedInputModifier, content.focusedInputViewportX);
        }
        (void)drawOpsPainter_.paint(g, content.diagnosticsBadgeDrawOps);
        (void)drawOpsPainter_.paint(g, content.diagnosticsToastDrawOps);
        paintMillis_ += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    }
} // namespace arrange::juce

#endif
