#pragma once

#include <arrange/core/Node.h>
#include <arrange/juce/TextInputOwner.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;
    class RuntimeSessionState;

    class JucePointerInputAdapter final {
    public:
        void pointerDown(
            ArrangeRuntime& runtime,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            arrange::core::NodeId root,
            const ::juce::MouseEvent& event,
            const TextInputCallbacks& inputCallbacks) const;

        [[nodiscard]] bool pointerDrag(
            ArrangeRuntime& runtime,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            const ::juce::MouseEvent& event,
            const TextInputCallbacks& inputCallbacks) const;

        [[nodiscard]] bool pointerUp(
            ArrangeRuntime& runtime,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            arrange::core::NodeId root,
            const ::juce::MouseEvent& event) const;

        [[nodiscard]] bool wheelMove(
            ArrangeRuntime& runtime,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            arrange::core::NodeId root,
            const ::juce::MouseEvent& event,
            const ::juce::MouseWheelDetails& wheel) const;
    };

#endif
} // namespace arrange::juce
