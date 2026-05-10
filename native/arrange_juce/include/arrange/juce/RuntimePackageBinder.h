#pragma once

#include <arrange/juce/PackageRuntimeSource.h>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;
    class PassivePaintRenderer;
    class RuntimeSessionState;

    class RuntimePackageBinder final {
    public:
        void apply(
            PackageLoadOutcome outcome,
            RuntimeSessionState& session,
            ArrangeRuntime& runtime,
            DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            PassivePaintRenderer& paint) const;

    private:
        static void resetRuntimeState(
            RuntimeSessionState& session,
            ArrangeRuntime& runtime,
            DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            PassivePaintRenderer& paint);

        static void emitDiagnostic(
            DiagnosticsState& diagnostics,
            ArrangeRuntime& runtime,
            RuntimeLoadDiagnostic diagnostic);
    };

#endif
} // namespace arrange::juce
