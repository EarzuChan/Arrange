#pragma once

#include <arrange/juce/PackageRuntimeSource.h>
#include <string_view>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;
    class PassivePaintRenderer;
    class RuntimeSessionState;

    class RuntimePackageBinder final {
       public:
        void apply(PackageLoadOutcome outcome, RuntimeSessionState& session, ArrangeRuntime& runtime, DiagnosticsState& diagnostics, InteractionStateOwner& interaction, PassivePaintRenderer& paint) const;

       private:
        static constexpr std::string_view TAG = "RuntimePackageBinder";
        static void resetRuntimeState(RuntimeSessionState& session, ArrangeRuntime& runtime, DiagnosticsState& diagnostics, InteractionStateOwner& interaction, PassivePaintRenderer& paint);

        static void deliverToast(DiagnosticsState& diagnostics, ArrangeRuntime& runtime, RuntimeLoadToast toast);
    };

#endif
}  // namespace arrange::juce
