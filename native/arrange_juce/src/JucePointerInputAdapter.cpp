#include <arrange/juce/JucePointerInputAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>
#include "ScrollProbe.h"
#include "PlatformWheelInput.h"

namespace arrange::juce {
    namespace {
        void recordWheelInput(ScrollProbe::Sample sample, const WheelInput& input, ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, arrange::core::NodeId root) {
            if (!ScrollProbe::active()) return;
            sample.kind = ScrollProbe::Kind::Input;
            sample.phase = static_cast<std::uint8_t>(input.phase);
            sample.momentumPhase = static_cast<std::uint8_t>(input.momentumPhase);
            sample.unitX = static_cast<std::uint8_t>(input.unitX);
            sample.unitY = static_cast<std::uint8_t>(input.unitY);
            sample.nativePhases = input.nativePhases;
            sample.interactive = session.interactive(diagnostics);
            sample.valid = runtime.scene().contains(root);
            sample.pending = runtime.hasPendingFrameWork();
            sample.revision = runtime.publishedFrame().revision;
            ScrollProbe::record(sample);
        }
    }

    void JucePointerInputAdapter::pointerDown(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event, const TextInputCallbacks& inputCallbacks) const {
        if (!session.interactive(diagnostics)) {
            return;
        }

        runtime.enqueueIntent(arrange::core::InputIntent::pointer("native pointer down"));
        interaction.pointerDown(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, static_cast<float>(event.x), static_cast<float>(event.y), inputCallbacks);
    }

    bool JucePointerInputAdapter::pointerDrag(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, const ::juce::MouseEvent& event, const TextInputCallbacks& inputCallbacks) const {
        if (!session.interactive(diagnostics)) {
            return false;
        }

        const auto changed = interaction.pointerDrag(runtime.scene().tree(), session.loaded(), static_cast<float>(event.x), static_cast<float>(event.y), inputCallbacks);
        if (changed) runtime.enqueueIntent(arrange::core::InputIntent::pointer("原生指针拖动"));
        return changed;
    }

    bool JucePointerInputAdapter::pointerUp(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event) const {
        if (!session.interactive(diagnostics)) {
            return false;
        }

        const auto result = interaction.pointerUp(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, static_cast<float>(event.x), static_cast<float>(event.y));
        if (!result.clickTriggered || !result.eventSlot.valid()) {
            return false;
        }

        runtime.enqueueIntent(arrange::core::InputIntent::pointer("native pointer click", result.eventSlot.node));
        runtime.enqueueEvent(result.eventSlot);
        return true;
    }

    bool JucePointerInputAdapter::wheelMove(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) const {
        const auto input = readPlatformWheelInput(event, wheel);
        ScrollProbe::Sample sample;
        sample.sourceMillis = static_cast<double>(event.eventTime.toMilliseconds());
        sample.x = event.position.x;
        sample.y = event.position.y;
        sample.deltaX = wheel.deltaX;
        sample.deltaY = wheel.deltaY;
        sample.inertial = wheel.isInertial;
        sample.smooth = wheel.isSmooth;
        sample.reversed = wheel.isReversed;
        recordWheelInput(sample, input, runtime, session, diagnostics, root);
        return dispatchWheel(runtime, session, diagnostics, interaction, root, {event.position.x, event.position.y}, input);
    }

    bool JucePointerInputAdapter::wheelMove(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, arrange::core::Point point, const WheelInput& input) const {
        ScrollProbe::Sample sample;
        sample.sourceMillis = input.timeMillis;
        sample.x = point.x;
        sample.y = point.y;
        sample.deltaX = input.deltaX;
        sample.deltaY = input.deltaY;
        sample.inertial = input.inertial;
        sample.smooth = input.precise;
        recordWheelInput(sample, input, runtime, session, diagnostics, root);
        return dispatchWheel(runtime, session, diagnostics, interaction, root, point, input);
    }

    bool JucePointerInputAdapter::dispatchWheel(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, arrange::core::Point point, const WheelInput& input) const {
        if (!session.interactive(diagnostics) || !runtime.scene().contains(root)) {
            interaction.cancelWheel();
            return false;
        }
        const auto wheelResult = interaction.wheel(runtime.scene().tree(), root, point.x, point.y, input, runtime.publishedFrame().revision);
        const auto& result = wheelResult.scroll;
        if (ScrollProbe::active()) {
            const auto logicalDistance = [&](float delta, WheelUnit unit) { return delta * (unit == WheelUnit::Lines ? scrollLineDistance : unit == WheelUnit::Pages ? result.viewportSize : 1.0f); };
            ScrollProbe::Sample sample;
            sample.kind = ScrollProbe::Kind::Route;
            sample.deltaX = logicalDistance(input.deltaX, input.unitX);
            sample.deltaY = logicalDistance(input.deltaY, input.unitY);
            sample.phase = static_cast<std::uint8_t>(input.phase);
            sample.momentumPhase = static_cast<std::uint8_t>(input.momentumPhase);
            sample.nativePhases = input.nativePhases;
            sample.sessionId = wheelResult.sessionId;
            sample.locked = wheelResult.locked;
            sample.sessionStarted = wheelResult.sessionStarted;
            sample.sessionCancelled = wheelResult.sessionCancelled;
            sample.revision = runtime.publishedFrame().revision;
            sample.target = result.target;
            sample.modifierIdentity = result.modifier.identity;
            sample.horizontal = wheelResult.horizontal;
            sample.consumed = result.consumed;
            sample.valid = result.eventSlot.valid();
            sample.value = result.value;
            sample.maxValue = result.maxValue;
            ScrollProbe::record(sample);
        }
        if (!result.consumed) return false;
        runtime.enqueueIntent(arrange::core::InputIntent::wheel(wheelResult.horizontal ? "原生横向滚动" : "原生纵向滚动", result.target, result.eventSlot));
        runtime.enqueueScrollSnapshotEvent(result.eventSlot, result);
        return true;
    }
}

#endif
