#include <arrange/juce/PassivePaintRenderer.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <stdexcept>
#include <chrono>

namespace arrange::juce {
    void PassivePaintRenderer::setPackageDir(const std::filesystem::path& packageDir) {
        imageResources_.setPackageDir(packageDir);
    }

    void PassivePaintRenderer::clearResources() { imageResources_.clear(); textLayoutService_.clearCache(); }

    void PassivePaintRenderer::prepareResources(arrange::core::PublishedFrameContent& content) {
        const auto started = std::chrono::steady_clock::now();
        // 只准备候选帧；失败不会改写当前帧持有的不可变资源
        if (content.scenePaint.fragment) arrange::core::visitPaintOps(*content.scenePaint.fragment, [&](const auto& ops) {
            const auto result = imageResources_.prepare(ops);
            if (result.error) throw std::runtime_error(result.error->summary);
        }, true);
        for (auto* ops : {&content.overlayDrawOps, &content.diagnosticsErrorDrawOps,
                               &content.diagnosticsBadgeDrawOps, &content.diagnosticsToastDrawOps}) {
            for (auto& op : *ops) arrange::core::DrawOpsBuilder::prepareText(op, textLayoutService_);
            const auto result = imageResources_.prepare(*ops);
            if (result.error) throw std::runtime_error(result.error->summary);
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
            (void)drawOpsPainter_.paint(g, content.diagnosticsErrorDrawOps, imageResources_);
        }
        else {
            (void)drawOpsPainter_.paint(g, content.scenePaint, imageResources_, content.focusedInputNode, content.focusedInputViewportX);
            (void)drawOpsPainter_.paint(g, content.overlayDrawOps, imageResources_, content.focusedInputNode, content.focusedInputViewportX);
        }
        (void)drawOpsPainter_.paint(g, content.diagnosticsBadgeDrawOps, imageResources_);
        (void)drawOpsPainter_.paint(g, content.diagnosticsToastDrawOps, imageResources_);
        paintMillis_ += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    }
} // namespace arrange::juce

#endif
