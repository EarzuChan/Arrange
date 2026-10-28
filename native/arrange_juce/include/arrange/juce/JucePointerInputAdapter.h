#pragma once

#include <arrange/core/InputEvent.h>
#include <arrange/core/LayoutNode.h>
#include <arrange/core/PointerGesture.h>
#include <arrange/juce/TextInputOwner.h>
#include <arrange/core/WheelInput.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;
    class InteractionStateOwner;
    class RuntimeSessionState;

    arrange::core::KeyModifierState keyModifierState(const ::juce::ModifierKeys& modifiers) noexcept;

    class JucePointerInputAdapter final {
       public:
        void pointerMove(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, const ::juce::MouseEvent& event) const;
        void pointerExit(ArrangeRuntime& runtime, InteractionStateOwner& interaction) const;
        void cancelPointer(ArrangeRuntime& runtime, InteractionStateOwner& interaction) const;
        void pointerDown(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event, const arrange::core::InputCallbacks& inputCallbacks) const;

        [[nodiscard]] bool pointerDrag(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, const ::juce::MouseEvent& event, const arrange::core::InputCallbacks& inputCallbacks) const;

        [[nodiscard]] bool pointerUp(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event) const;

        [[nodiscard]] bool wheelMove(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) const;
        [[nodiscard]] bool wheelMove(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, arrange::core::Point point, const arrange::core::WheelInput& input) const;

       private:
        [[nodiscard]] bool dispatchWheel(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, arrange::core::Point point, const arrange::core::WheelInput& input) const;
    };

#endif
}
