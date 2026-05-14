#include <arrange/juce/PassivePaintRenderer.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>

namespace arrange::juce {
    void PassivePaintRenderer::setPackageDir(const std::filesystem::path& packageDir) {
        imageResources_.setPackageDir(packageDir);
    }

    void PassivePaintRenderer::clearResources() {
        imageResources_.clear();
    }

    bool PassivePaintRenderer::prepareResources(
        ArrangeRuntime& runtime,
        DiagnosticsState& diagnostics) {
        if (diagnostics.hasError()) {
            return false;
        }

        const auto result = imageResources_.prepare(runtime.publishedFrame().content.drawOps);
        if (result.error) {
            diagnostics.setError(*result.error);
            DiagnosticEventInput event;
            event.level = LogLevel::Error;
            event.category = result.error->relatedPath.extension() == ".svg" ? DiagnosticCategory::ResourceIcon : DiagnosticCategory::ResourceImage;
            event.code = "resource.prepare.failed";
            event.message = "Resource prepare failed";
            event.detail = result.error->summary;
            event.pathOrUrl = result.error->relatedPath.string();
            event.toast = true;
            (void)diagnostics.emit(std::move(event));
            runtime.enqueueIntent(arrange::core::InputIntent::resourceFailed("resource prepare failed"));
            return true;
        }
        if (result.changed) {
            runtime.enqueueIntent(arrange::core::InputIntent::resourceReady("resource prepared"));
            return true;
        }
        return false;
    }

    void PassivePaintRenderer::paint(
        ::juce::Graphics& g,
        ::juce::Rectangle<int> bounds,
        const ArrangeRuntime& runtime,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction,
        arrange::core::NodeId root,
        bool loaded,
        bool detailedErrorScreen,
        const DiagnosticsBadgeModel& badgeModel) {
        g.fillAll(::juce::Colour(0xff1f232a));

        if (diagnostics.hasError()) {
            (void)detailedErrorScreen;
            (void)bounds;
            (void)badgeModel;
            (void)interaction;
            (void)drawOpsPainter_.paint(g, runtime.publishedFrame().content.diagnosticsErrorDrawOps, imageResources_);
            paintDiagnostics(g, runtime, imageResources_);
            return;
        }

        if (!loaded || !runtime.scene().contains(root)) {
            (void)detailedErrorScreen;
            (void)bounds;
            (void)badgeModel;
            (void)interaction;
            paintDiagnostics(g, runtime, imageResources_);
            return;
        }

        const auto paintResult = drawOpsPainter_.paint(
            g,
            runtime.publishedFrame().content.drawOps,
            imageResources_,
            runtime.publishedFrame().content.focusedInputNode,
            runtime.publishedFrame().content.focusedInputViewportX);
        if (paintResult.error) {
            return;
        }

        (void)drawOpsPainter_.paint(
            g,
            runtime.publishedFrame().content.overlayDrawOps,
            imageResources_,
            runtime.publishedFrame().content.focusedInputNode,
            runtime.publishedFrame().content.focusedInputViewportX);
        (void)interaction;
        (void)detailedErrorScreen;
        (void)bounds;
        (void)badgeModel;
        paintDiagnostics(g, runtime, imageResources_);
        return;
    }

    void PassivePaintRenderer::paintDiagnostics(
        ::juce::Graphics& g,
        const ArrangeRuntime& runtime,
        const ImageResourceCache& imageResources) const {
        (void)drawOpsPainter_.paint(g, runtime.publishedFrame().content.diagnosticsBadgeDrawOps, imageResources);
        (void)drawOpsPainter_.paint(g, runtime.publishedFrame().content.diagnosticsToastDrawOps, imageResources);
    }
} // namespace arrange::juce

#endif
