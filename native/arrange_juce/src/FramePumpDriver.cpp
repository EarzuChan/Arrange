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
#if ARRANGE_WITH_QUICKJS_NG
        [[nodiscard]] LogLevel toJuceLogLevel(arrange::quickjs::QuickJsDiagnosticLevel level) noexcept {
            switch (level) {
            case arrange::quickjs::QuickJsDiagnosticLevel::Trace: return LogLevel::Trace;
            case arrange::quickjs::QuickJsDiagnosticLevel::Debug: return LogLevel::Debug;
            case arrange::quickjs::QuickJsDiagnosticLevel::Info: return LogLevel::Info;
            case arrange::quickjs::QuickJsDiagnosticLevel::Warn: return LogLevel::Warn;
            case arrange::quickjs::QuickJsDiagnosticLevel::Error: return LogLevel::Error;
            }
            return LogLevel::Info;
        }

        [[nodiscard]] DiagnosticCategory toJuceDiagnosticCategory(arrange::quickjs::QuickJsDiagnosticCategory category) noexcept {
            switch (category) {
            case arrange::quickjs::QuickJsDiagnosticCategory::App: return DiagnosticCategory::App;
            case arrange::quickjs::QuickJsDiagnosticCategory::HostLive: return DiagnosticCategory::HostLive;
            case arrange::quickjs::QuickJsDiagnosticCategory::HostDist: return DiagnosticCategory::HostDist;
            case arrange::quickjs::QuickJsDiagnosticCategory::HostHmr: return DiagnosticCategory::HostHmr;
            case arrange::quickjs::QuickJsDiagnosticCategory::RuntimeScript: return DiagnosticCategory::RuntimeScript;
            case arrange::quickjs::QuickJsDiagnosticCategory::RuntimeTransaction: return DiagnosticCategory::RuntimeTransaction;
            case arrange::quickjs::QuickJsDiagnosticCategory::PipelineFrame: return DiagnosticCategory::PipelineFrame;
            case arrange::quickjs::QuickJsDiagnosticCategory::PipelineLayout: return DiagnosticCategory::PipelineLayout;
            case arrange::quickjs::QuickJsDiagnosticCategory::PipelinePaint: return DiagnosticCategory::PipelinePaint;
            case arrange::quickjs::QuickJsDiagnosticCategory::InputPointer: return DiagnosticCategory::InputPointer;
            case arrange::quickjs::QuickJsDiagnosticCategory::InputKey: return DiagnosticCategory::InputKey;
            case arrange::quickjs::QuickJsDiagnosticCategory::InputIme: return DiagnosticCategory::InputIme;
            case arrange::quickjs::QuickJsDiagnosticCategory::InputScroll: return DiagnosticCategory::InputScroll;
            case arrange::quickjs::QuickJsDiagnosticCategory::ResourcePackage: return DiagnosticCategory::ResourcePackage;
            case arrange::quickjs::QuickJsDiagnosticCategory::ResourceImage: return DiagnosticCategory::ResourceImage;
            case arrange::quickjs::QuickJsDiagnosticCategory::ResourceIcon: return DiagnosticCategory::ResourceIcon;
            case arrange::quickjs::QuickJsDiagnosticCategory::Diagnostics: return DiagnosticCategory::Diagnostics;
            }
            return DiagnosticCategory::Diagnostics;
        }

        [[nodiscard]] DiagnosticEventInput toJuceDiagnosticEvent(arrange::quickjs::QuickJsDiagnosticEventInput event) {
            DiagnosticEventInput result;
            result.level = toJuceLogLevel(event.level);
            result.category = toJuceDiagnosticCategory(event.category);
            result.code = std::move(event.code);
            result.message = std::move(event.message);
            result.detail = std::move(event.detail);
            result.source = std::move(event.source);
            result.pathOrUrl = std::move(event.pathOrUrl);
            result.toast = event.toast;
            result.coalesceToast = event.coalesceToast;
            return result;
        }
#endif
    } // namespace

    bool FramePumpDriver::pumpFrame(
        ArrangeRuntime& runtime,
        RuntimeSessionState& session,
        DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        PassivePaintRenderer& paint,
        arrange::core::NodeId root,
        const std::filesystem::path& frameErrorPath,
        ::juce::Rectangle<int> diagnosticsBounds,
        bool detailedErrorScreen,
        const DiagnosticsBadgeModel& badgeModel,
        double nowMillis) const {
        (void)tickDiagnostics(diagnostics, runtime, nowMillis);
        std::optional<InteractionStateOwner> candidateInteraction;
        const auto finalize = [&](const arrange::core::NativeScene& scene, arrange::core::PublishedFrame& frame) {
            candidateInteraction.emplace(interaction);
            if (session.loaded() && !diagnostics.hasError() && !scene.contains(root)) {
                throw std::runtime_error("Arrange layout tree is empty after loading UI package.");
            }
            candidateInteraction->synchronizePublishedInput(scene.tree(), session.interactive(diagnostics));
            candidateInteraction->updateFocusedInputViewport(scene.tree(), session.interactive(diagnostics));
            frame.content.overlayDrawOps = candidateInteraction->buildFocusedInputOps(scene.tree(), session.interactive(diagnostics));
            frame.content.focusedInputNode = candidateInteraction->focusedNode();
            frame.content.focusedInputViewportX = candidateInteraction->viewportX();
            (void)diagnostics.prepareFrame(diagnosticsBounds, detailedErrorScreen, badgeModel);
            frame.content.diagnosticsErrorDrawOps = diagnostics.errorOpsSnapshot();
            frame.content.diagnosticsBadgeDrawOps = diagnostics.badgeOpsSnapshot();
            frame.content.diagnosticsToastDrawOps = diagnostics.toastOpsSnapshot();
            frame.content.errorFrame = diagnostics.hasError() ? std::optional<std::string>(diagnostics.error()->summary) : std::nullopt;
            paint.prepareResources(frame.content);
        };
        const auto revision = runtime.publishedFrame().revision;
        auto frame = runtime.pumpFrame(root, session.constraints(), nowMillis, finalize);
        if (frame.ok && !frame.pipelineRan) {
            try {
                (void)runtime.publishRetained(finalize);
            }
            catch (const std::exception& error) {
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
                retained.content.diagnosticsErrorDrawOps = diagnostics.errorOpsSnapshot();
                retained.content.diagnosticsBadgeDrawOps = diagnostics.badgeOpsSnapshot();
                retained.content.diagnosticsToastDrawOps = diagnostics.toastOpsSnapshot();
            });
        }
        else {
            if (candidateInteraction) interaction.commitState(std::move(*candidateInteraction));
        }
        return runtime.publishedFrame().revision != revision;
    }

    bool FramePumpDriver::tickDiagnostics(
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime,
        double nowMillis) {
        auto changed = false;
#if ARRANGE_WITH_QUICKJS_NG
        for (auto event : runtime.takeDiagnosticEvents()) {
            changed = diagnostics.emit(toJuceDiagnosticEvent(std::move(event))) || changed;
        }
        for (const auto& action : runtime.takeDiagnosticActions()) {
            switch (action.kind) {
            case arrange::quickjs::QuickJsDiagnosticActionKind::RequestReload:
            {
                DiagnosticEventInput event;
                event.level = LogLevel::Info;
                event.category = DiagnosticCategory::Diagnostics;
                event.code = "script.request_reload";
                event.message = "Script requested reload";
                event.detail = action.path.empty() ? std::string{} : "path=" + action.path;
                event.pathOrUrl = action.path;
                event.toast = true;
                changed = diagnostics.emit(std::move(event)) || changed;
                runtime.requestReload();
                break;
            }
            case arrange::quickjs::QuickJsDiagnosticActionKind::TriggerFakeError:
            {
                DiagnosticEventInput event;
                event.level = LogLevel::Error;
                event.category = DiagnosticCategory::Diagnostics;
                event.code = "script.fake_error";
                event.message = action.message.empty() ? std::string("Manual script diagnostic error") : action.message;
                event.detail = "Script diagnostics requested a real error-screen path.";
                event.toast = true;
                changed = diagnostics.emit(std::move(event)) || changed;
                break;
            }
            case arrange::quickjs::QuickJsDiagnosticActionKind::SetLogLevel:
            {
                diagnostics.setLogLevel(toJuceLogLevel(action.level));
                DiagnosticEventInput event;
                event.level = LogLevel::Info;
                event.category = DiagnosticCategory::Diagnostics;
                event.code = "script.set_log_level";
                event.message = "Script changed diagnostics log level";
                changed = diagnostics.emit(std::move(event)) || changed;
                break;
            }
            case arrange::quickjs::QuickJsDiagnosticActionKind::SetCategoryEnabled:
            {
                diagnostics.setCategoryEnabled(toJuceDiagnosticCategory(action.category), action.enabled);
                DiagnosticEventInput event;
                event.level = LogLevel::Info;
                event.category = DiagnosticCategory::Diagnostics;
                event.code = "script.set_category";
                event.message = "Script changed diagnostics category filter";
                event.pathOrUrl = diagnosticCategoryName(toJuceDiagnosticCategory(action.category));
                changed = diagnostics.emit(std::move(event)) || changed;
                break;
            }
            case arrange::quickjs::QuickJsDiagnosticActionKind::SetToastsEnabled:
            {
                diagnostics.setToastsEnabled(action.enabled);
                DiagnosticEventInput event;
                event.level = LogLevel::Info;
                event.category = DiagnosticCategory::Diagnostics;
                event.code = "script.set_toasts";
                event.message = "Script changed diagnostics toast visibility";
                event.detail = action.enabled ? "enabled" : "disabled";
                changed = diagnostics.emit(std::move(event)) || changed;
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

} // namespace arrange::juce

#endif
