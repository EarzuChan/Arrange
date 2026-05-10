#include <arrange/juce/JucePointerInputAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>

namespace arrange::juce {
    void JucePointerInputAdapter::pointerDown(
        ArrangeRuntime& runtime,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        arrange::core::NodeId root,
        const ::juce::MouseEvent& event,
        const TextInputCallbacks& inputCallbacks) const {
        if (!session.interactive(diagnostics)) {
            return;
        }

        runtime.enqueueIntent(arrange::core::InputIntent::pointer("native pointer down"));
        interaction.pointerDown(
            runtime.scene().tree(),
            root,
            static_cast<float>(event.x),
            static_cast<float>(event.y),
            inputCallbacks);
    }

    bool JucePointerInputAdapter::pointerDrag(
        ArrangeRuntime& runtime,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        const ::juce::MouseEvent& event,
        const TextInputCallbacks& inputCallbacks) const {
        if (!session.interactive(diagnostics)) {
            return false;
        }

        runtime.enqueueIntent(arrange::core::InputIntent::pointer("native pointer drag"));
        return interaction.pointerDrag(
            runtime.scene().tree(),
            session.loaded(),
            static_cast<float>(event.x),
            static_cast<float>(event.y),
            inputCallbacks);
    }

    bool JucePointerInputAdapter::pointerUp(
        ArrangeRuntime& runtime,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        arrange::core::NodeId root,
        const ::juce::MouseEvent& event) const {
        if (!session.interactive(diagnostics)) {
            return false;
        }

        const auto result = interaction.pointerUp(
            runtime.scene().tree(),
            root,
            static_cast<float>(event.x),
            static_cast<float>(event.y));
        if (!result.clickTriggered || !result.eventSlot.valid()) {
            return false;
        }

        runtime.enqueueIntent(arrange::core::InputIntent::pointer("native pointer click", result.eventSlot.node));
        runtime.enqueueEvent(result.eventSlot);
        return true;
    }

    bool JucePointerInputAdapter::wheelMove(
        ArrangeRuntime& runtime,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        arrange::core::NodeId root,
        const ::juce::MouseEvent& event,
        const ::juce::MouseWheelDetails& wheel) const {
        if (!session.interactive(diagnostics) || !runtime.scene().contains(root)) {
            return false;
        }

        const auto wheelResult = interaction.wheel(
            runtime.scene().tree(),
            root,
            static_cast<float>(event.x),
            static_cast<float>(event.y),
            wheel.deltaX,
            wheel.deltaY);
        const auto& result = wheelResult.scroll;
        if (!result.consumed) {
            return false;
        }

        runtime.enqueueIntent(arrange::core::InputIntent::wheel(
            wheelResult.horizontal ? "native horizontal wheel input" : "native vertical wheel input",
            result.target,
            result.eventSlot));
        runtime.enqueueScrollSnapshotEvent(result.eventSlot, result);
        return true;
    }
} // namespace arrange::juce

#endif
