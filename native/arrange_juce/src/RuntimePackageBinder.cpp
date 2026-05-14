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
        arrange::core::InputIntent packageIntent(
            PackageLoadOutcome::IntentKind kind,
            arrange::core::MutationTransaction transaction) {
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
    } // namespace

    void RuntimePackageBinder::apply(
        PackageLoadOutcome outcome,
        RuntimeSessionState& session,
        ArrangeRuntime& runtime,
        DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        PassivePaintRenderer& paint) const {
        resetRuntimeState(session, runtime, diagnostics, interaction, paint);

        if (!outcome.packageDir.empty()) {
            paint.setPackageDir(outcome.packageDir);
        }

        if (outcome.error) {
            diagnostics.setError(std::move(*outcome.error));
        }

        for (auto& diagnostic : outcome.diagnostics) {
            emitDiagnostic(diagnostics, runtime, std::move(diagnostic));
        }

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

    void RuntimePackageBinder::resetRuntimeState(
        RuntimeSessionState& session,
        ArrangeRuntime& runtime,
        DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        PassivePaintRenderer& paint) {
        session.reset(runtime, diagnostics, interaction);
        paint.clearResources();
    }

    void RuntimePackageBinder::emitDiagnostic(
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime,
        RuntimeLoadDiagnostic diagnostic) {
        DiagnosticEventInput event;
        event.level = diagnostic.level;
        event.category = diagnostic.title.find("Live") != std::string::npos
                             ? DiagnosticCategory::HostLive
                             : diagnostic.title.find("Dist") != std::string::npos
                                   ? DiagnosticCategory::HostDist
                                   : DiagnosticCategory::ResourcePackage;
        event.code = "package.load";
        event.message = std::move(diagnostic.title);
        event.detail = std::move(diagnostic.message);
        event.toast = diagnostic.toast;
        event.coalesceToast = diagnostic.coalesceToast;
        if (diagnostics.emit(std::move(event))) {
            runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("package diagnostic event"));
        }
    }
} // namespace arrange::juce

#endif
