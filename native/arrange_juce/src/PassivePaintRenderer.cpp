#include <arrange/juce/PassivePaintRenderer.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <stdexcept>

namespace arrange::juce {
    void PassivePaintRenderer::setPackageDir(const std::filesystem::path& packageDir) {
        imageResources_.setPackageDir(packageDir);
    }

    void PassivePaintRenderer::clearResources() { imageResources_.clear(); }

    void PassivePaintRenderer::prepareResources(const arrange::core::PublishedFrameContent& content) {
        // Preparation only grows the cache: a failed candidate cannot evict the retained frame's resources.
        for (const auto* ops : {&content.drawOps, &content.overlayDrawOps, &content.diagnosticsErrorDrawOps,
                               &content.diagnosticsBadgeDrawOps, &content.diagnosticsToastDrawOps}) {
            const auto result = imageResources_.prepare(*ops);
            if (result.error) throw std::runtime_error(result.error->summary);
        }
    }

    void PassivePaintRenderer::paint(::juce::Graphics& g, const arrange::core::PublishedFrame& frame) {
        ++fullViewportPaints_;
        lastFullPaintReason_ = "host paint replays published transformed scene/overlays within the graphics clip";
        g.fillAll(::juce::Colour(0xff1f232a));
        const auto& content = frame.content;
        if (content.errorFrame) {
            (void)drawOpsPainter_.paint(g, content.diagnosticsErrorDrawOps, imageResources_);
        }
        else {
            (void)drawOpsPainter_.paint(g, content.drawOps, imageResources_, content.focusedInputNode, content.focusedInputViewportX);
            (void)drawOpsPainter_.paint(g, content.overlayDrawOps, imageResources_, content.focusedInputNode, content.focusedInputViewportX);
        }
        (void)drawOpsPainter_.paint(g, content.diagnosticsBadgeDrawOps, imageResources_);
        (void)drawOpsPainter_.paint(g, content.diagnosticsToastDrawOps, imageResources_);
    }
} // namespace arrange::juce

#endif
