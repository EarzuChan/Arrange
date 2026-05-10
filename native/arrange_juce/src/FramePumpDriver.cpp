#include <arrange/juce/FramePumpDriver.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>

namespace arrange::juce {
    bool FramePumpDriver::pumpFrame(
        ArrangeRuntime& runtime,
        RuntimeSessionState& session,
        DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        arrange::core::NodeId root,
        const std::filesystem::path& frameErrorPath,
        ::juce::Rectangle<int> diagnosticsBounds,
        bool detailedErrorScreen,
        const DiagnosticsBadgeModel& badgeModel,
        double nowMillis) const {
        auto diagnosticsChanged = tickDiagnostics(diagnostics, runtime, nowMillis);
        const auto frame = runtime.pumpFrame(root, session.constraints(), nowMillis);
        const auto frameErrorChanged = session.applyFrameError(frame, diagnostics, runtime, frameErrorPath);
        if (frameErrorChanged) {
            diagnosticsChanged = true;
        }
        const auto sceneValidityChanged = frameErrorChanged
            ? false
            : validateLoadedScene(runtime, session, diagnostics, root);
        if (sceneValidityChanged) {
            diagnosticsChanged = true;
        }

        if (diagnosticsChanged) {
            const auto diagnosticsFrame = runtime.pumpFrame(root, session.constraints(), nowMillis);
            const auto diagnosticsFrameErrorChanged = session.applyFrameError(
                diagnosticsFrame,
                diagnostics,
                runtime,
                frameErrorPath);
            diagnosticsChanged = diagnosticsChanged || diagnosticsFrame.changed || diagnosticsFrameErrorChanged;
            if (diagnosticsFrameErrorChanged) {
                return true;
            }
        }

        diagnosticsChanged = prepareDiagnosticsFrame(
            runtime,
            diagnostics,
            diagnosticsBounds,
            detailedErrorScreen,
            badgeModel) || diagnosticsChanged;

        if (frameErrorChanged) {
            return true;
        }

        if (frame.pipelineRan && session.loaded() && runtime.scene().contains(root)) {
            interaction.updateFocusedInputViewport(runtime.scene().tree(), session.loaded());
        }
        const auto interactionChanged = prepareInteractionFrame(
            runtime,
            session,
            diagnostics,
            interaction);
        return diagnosticsChanged || sceneValidityChanged || interactionChanged || frame.changed;
    }

    bool FramePumpDriver::prepareInteractionFrame(
        ArrangeRuntime& runtime,
        RuntimeSessionState& session,
        DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction) {
        std::vector<arrange::core::DrawOp> ops;
        if (session.interactive(diagnostics)) {
            ops = interaction.buildFocusedInputOps(runtime.scene().tree(), session.loaded());
        }

        const auto& previous = runtime.publishedFrame().content.overlayDrawOps;
        const auto changed = ops.size() != previous.size();
        if (!changed) {
            auto same = true;
            for (std::size_t index = 0; index < ops.size(); ++index) {
                const auto& left = ops[index];
                const auto& right = previous[index];
                same = same &&
                    left.type == right.type &&
                    left.nodeId == right.nodeId &&
                    left.rect.x == right.rect.x &&
                    left.rect.y == right.rect.y &&
                    left.rect.width == right.rect.width &&
                    left.rect.height == right.rect.height &&
                    left.color == right.color &&
                    left.strokeWidth == right.strokeWidth &&
                    left.lineEnd.x == right.lineEnd.x &&
                    left.lineEnd.y == right.lineEnd.y;
                if (!same) break;
            }
            if (same) return false;
        }

        runtime.publishOverlayDrawOps(std::move(ops), interaction.focusedNode(), interaction.viewportX());
        return true;
    }

    bool FramePumpDriver::tickDiagnostics(
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime,
        double nowMillis) {
        if (!diagnostics.tick(nowMillis)) {
            return false;
        }
        runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("diagnostics toast tick"));
        return true;
    }

    bool FramePumpDriver::validateLoadedScene(
        ArrangeRuntime& runtime,
        RuntimeSessionState& session,
        DiagnosticsState& diagnostics,
        arrange::core::NodeId root) {
        if (!session.loaded() || diagnostics.hasError() || runtime.hasPendingTransactions() || runtime.framePipelineRunRequested()) {
            return false;
        }
        if (runtime.scene().contains(root)) {
            return false;
        }
        session.setLayoutTreeEmptyError(diagnostics, runtime);
        return true;
    }

    bool FramePumpDriver::prepareDiagnosticsFrame(
        ArrangeRuntime& runtime,
        DiagnosticsState& diagnostics,
        ::juce::Rectangle<int> diagnosticsBounds,
        bool detailedErrorScreen,
        const DiagnosticsBadgeModel& badgeModel) {
        const auto changed = diagnostics.prepareFrame(
            diagnosticsBounds,
            detailedErrorScreen,
            badgeModel);
        if (changed) {
            runtime.publishDiagnosticsDrawOps(
                diagnostics.errorOpsSnapshot(),
                diagnostics.badgeOpsSnapshot(),
                diagnostics.toastOpsSnapshot());
            runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("diagnostics frame prepared"));
        }
        return changed;
    }
} // namespace arrange::juce

#endif
