#include <arrange/juce/RuntimePackageBinder.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/RuntimeSessionState.h>

#include <utility>

namespace arrange::juce {
    namespace {
        arrange::core::InputIntent packageIntent(PackageLoadOutcome::IntentKind kind, arrange::core::MutationTransaction transaction) {
            switch (kind) {
                case PackageLoadOutcome::IntentKind::Reload:
                    return arrange::core::InputIntent::packageLoad(std::move(transaction), "reload initial commit");
                case PackageLoadOutcome::IntentKind::HmrReload:
                    return arrange::core::InputIntent::packageLoad(std::move(transaction), "hmr reload initial commit");
                case PackageLoadOutcome::IntentKind::PackageLoad:
                    return arrange::core::InputIntent::packageLoad(std::move(transaction), "package load initial commit");
            }
            return arrange::core::InputIntent::packageLoad(std::move(transaction), "package load initial commit");
        }

        arrange::core::InputIntent packageFailureIntent(PackageLoadOutcome::IntentKind kind) {
            switch (kind) {
                case PackageLoadOutcome::IntentKind::Reload:
                    return arrange::core::InputIntent::reload("reload failed");
                case PackageLoadOutcome::IntentKind::HmrReload:
                    return arrange::core::InputIntent::hmrReload("hmr reload failed");
                case PackageLoadOutcome::IntentKind::PackageLoad:
                    return arrange::core::InputIntent::diagnostics("package load failed");
            }
            return arrange::core::InputIntent::diagnostics("package load failed");
        }
    }  // namespace

    void RuntimePackageBinder::apply(PackageLoadOutcome outcome, RuntimeSessionState& session, ArrangeRuntime& runtime, DiagnosticsState& diagnostics, InteractionStateOwner& interaction, PassivePaintRenderer& paint) const {
        if (outcome.pending) return;
        resetRuntimeState(session, runtime, diagnostics, interaction, paint);

        if (outcome.error) {
            diagnostics.setError(std::move(*outcome.error));
        }

        for (const auto& log : outcome.logs) arrange::Log::write(log.level, TAG, log.message);
        for (auto& toast : outcome.toasts) deliverToast(diagnostics, runtime, std::move(toast));

        if (!outcome.loaded) {
            runtime.enqueueIntent(packageFailureIntent(outcome.intentKind));
            return;
        }

#if ARRANGE_WITH_QUICKJS_NG
        runtime.setScriptHost(std::move(outcome.scriptHost));
#endif
        if (outcome.initialTransaction) {
            runtime.enqueueIntent(packageIntent(outcome.intentKind, std::move(*outcome.initialTransaction)));
        }
        session.markLoaded();
    }

    void RuntimePackageBinder::resetRuntimeState(RuntimeSessionState& session, ArrangeRuntime& runtime, DiagnosticsState& diagnostics, InteractionStateOwner& interaction, PassivePaintRenderer& paint) {
        session.reset(runtime, diagnostics, interaction);
        paint.clearResources();
    }

    void RuntimePackageBinder::deliverToast(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, RuntimeLoadToast toast) {
        if (DiagnosticsToast::show(diagnostics, toast.level, TAG, std::move(toast.title), std::move(toast.message), toast.coalesce))
            runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("package toast"));
    }
}  // namespace arrange::juce

#endif
