#include <arrange/juce/FramePumpDriver.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>

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
                runtime.enqueueIntent(arrange::core::InputIntent::reload("script requested reload"));
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
