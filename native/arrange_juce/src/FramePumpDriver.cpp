#include <arrange/juce/FramePumpDriver.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <stdexcept>

#include <string>
#include <utility>
#include <vector>

namespace arrange::juce {
    namespace {
        void replacePreparedOps(std::vector<arrange::core::DrawOp>& target, std::vector<arrange::core::DrawOp> source) {
            for (std::size_t index = 0; index < std::min(target.size(), source.size()); ++index) {
                if (source[index].type == arrange::core::DrawOpType::DrawText && target[index].type == arrange::core::DrawOpType::DrawText) source[index].textLayout = target[index].textLayout;
            }
            target = std::move(source);
        }

#if ARRANGE_WITH_QUICKJS_NG
#endif
    }  // namespace

    bool FramePumpDriver::pumpFrame(ArrangeRuntime& runtime, RuntimeSessionState& session, DiagnosticsState& diagnostics, InteractionStateOwner& interaction, PassivePaintRenderer& paint, arrange::core::NodeId root, const std::filesystem::path& frameErrorPath, ::juce::Rectangle<int> diagnosticsBounds, bool detailedErrorScreen, const DiagnosticsBadgeModel& badgeModel, double nowMillis) const {
        (void)tickDiagnostics(diagnostics, runtime, nowMillis);
        std::optional<InteractionStateOwner> candidateInteraction;
        const auto finalize = [&](const arrange::core::NativeScene& scene, arrange::core::PublishedFrame& frame) {
            candidateInteraction.emplace(interaction);
            if (session.loaded() && !diagnostics.hasError() && !scene.contains(root)) {
                throw std::runtime_error("Arrange layout tree is empty after loading UI package.");
            }
            candidateInteraction->synchronizePublishedInput(scene.tree(), session.interactive(diagnostics));
            candidateInteraction->updateFocusedInputViewport(scene.tree(), session.interactive(diagnostics));
            replacePreparedOps(frame.content.overlayDrawOps, candidateInteraction->buildFocusedInputOps(scene.tree(), session.interactive(diagnostics)));
            frame.content.focusedInputNode = candidateInteraction->focusedNode();
            frame.content.focusedInputModifier = candidateInteraction->focusedModifier();
            frame.content.focusedInputViewportX = candidateInteraction->viewportX();
            (void)diagnostics.prepareFrame(diagnosticsBounds, detailedErrorScreen, badgeModel);
            replacePreparedOps(frame.content.diagnosticsErrorDrawOps, diagnostics.errorOpsSnapshot());
            replacePreparedOps(frame.content.diagnosticsBadgeDrawOps, diagnostics.badgeOpsSnapshot());
            replacePreparedOps(frame.content.diagnosticsToastDrawOps, diagnostics.toastOpsSnapshot());
            frame.content.errorFrame = diagnostics.hasError() ? std::optional<std::string>(diagnostics.error()->summary) : std::nullopt;
            paint.prepareResources(frame.content);
        };
        const auto revision = runtime.publishedFrame().revision;
        auto frame = runtime.pumpFrame(root, session.constraints(), nowMillis, finalize);
        if (frame.ok && !frame.pipelineRan) {
            try {
                (void)runtime.publishRetained(finalize);
            } catch (const std::exception& error) {
                frame.ok = false;
                frame.errorPhase = RuntimeFrameErrorPhase::Pipeline;
                frame.error = error.what();
            }
        }
        if (!frame.ok) {
            // JS effects cannot be rolled back. Preserve the last scene, stop this context,
            // and recover only by loading a fresh context. Core retry remains available to native callers.
            runtime.suspend();
            (void)session.applyFrameError(frame, diagnostics, runtime, frameErrorPath);
            (void)diagnostics.prepareFrame(diagnosticsBounds, detailedErrorScreen, badgeModel);
            (void)runtime.publishRetained([&](const auto&, auto& retained) {
                retained.content.errorFrame = frame.error;
                replacePreparedOps(retained.content.diagnosticsErrorDrawOps, diagnostics.errorOpsSnapshot());
                replacePreparedOps(retained.content.diagnosticsBadgeDrawOps, diagnostics.badgeOpsSnapshot());
                replacePreparedOps(retained.content.diagnosticsToastDrawOps, diagnostics.toastOpsSnapshot());
                paint.prepareResources(retained.content);
            });
        } else {
            if (candidateInteraction) interaction.commitState(std::move(*candidateInteraction));
        }
        return runtime.publishedFrame().revision != revision;
    }

    bool FramePumpDriver::tickDiagnostics(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, double nowMillis) {
        auto changed = false;
#if ARRANGE_WITH_QUICKJS_NG
        for (auto toast : runtime.takeDiagnosticToasts()) {
            changed = DiagnosticsToast::show(diagnostics, toast.level, toast.tag, std::move(toast.title), std::move(toast.content), toast.coalesce) || changed;
        }
        for (const auto& action : runtime.takeDiagnosticActions()) {
            switch (action.kind) {
                case arrange::quickjs::QuickJsDiagnosticActionKind::RequestReload: {
                    DiagnosticsToast::i(diagnostics, TAG, "脚本请求重新加载", action.path);
                    runtime.requestReload();
                    break;
                }
                case arrange::quickjs::QuickJsDiagnosticActionKind::TriggerFakeError: {
                    DiagnosticsToast::e(diagnostics, TAG, action.message.empty() ? std::string("脚本请求诊断错误") : action.message, "脚本诊断已触发错误屏路径");
                    break;
                }
                case arrange::quickjs::QuickJsDiagnosticActionKind::SetToastsEnabled: {
                    diagnostics.setToastsEnabled(action.enabled);
                    arrange::Log::i(TAG, "诊断提示显示状态已更新", action.enabled ? "已启用" : "已关闭");
                    break;
                }
            }
        }
#endif
        changed = diagnostics.tick(nowMillis) || changed;
        if (!changed) return false;
        runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("diagnostics toast tick"));
        return true;
    }

}  // namespace arrange::juce

#endif
