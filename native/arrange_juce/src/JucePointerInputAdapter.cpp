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

        void dispatchGesture(ArrangeRuntime& runtime, InteractionStateOwner& interaction, const arrange::core::PointerGestureOutput& output) {
            interaction.notePointerEffects(output);
            for (const auto& event : output.events) {
                if (std::holds_alternative<std::monostate>(event.payload)) {
                    runtime.enqueueIntent(arrange::core::InputIntent::pointer("原生指针点击", event.slot.node));
                    runtime.enqueueEvent(event.slot);
                } else
                    runtime.enqueueInputEvent(event.slot, event.payload);
            }
        }
    }

    arrange::core::KeyModifierState keyModifierState(const ::juce::ModifierKeys& modifiers) noexcept {
        arrange::core::KeyModifierState state;
        state.shift = modifiers.isShiftDown();
        state.alt = modifiers.isAltDown();
        state.ctrl = modifiers.isCtrlDown();
        state.command = modifiers.isCommandDown();
#if JUCE_MAC
        state.meta = modifiers.isCommandDown();
#endif
        return state;
    }

    void JucePointerInputAdapter::pointerMove(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, const ::juce::MouseEvent& event) const {
        if (!session.interactive(diagnostics) || !runtime.publishedFrame().content.hitTest) return;
        dispatchGesture(runtime, interaction, interaction.pointerMove(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, event.position.x, event.position.y));
    }

    void JucePointerInputAdapter::pointerExit(ArrangeRuntime& runtime, InteractionStateOwner& interaction) const {
        dispatchGesture(runtime, interaction, interaction.pointerExit(runtime.scene().tree()));
    }

    void JucePointerInputAdapter::cancelPointer(ArrangeRuntime& runtime, InteractionStateOwner& interaction) const {
        dispatchGesture(runtime, interaction, interaction.cancelPointer(runtime.scene().tree()));
    }

    void JucePointerInputAdapter::pointerDown(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event, const TextInputCallbacks& inputCallbacks) const {
        if (!session.interactive(diagnostics)) {
            return;
        }

        const auto modifiers = keyModifierState(event.mods);
        // 上下文点击（右键，macOS 上 Ctrl+点击）单独路由，不触发 clickable
        if (event.mods.isPopupMenu()) {
            dispatchGesture(runtime, interaction, interaction.contextClick(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, event.position.x, event.position.y, modifiers));
            return;
        }
        if (!event.mods.isLeftButtonDown()) return;
        runtime.enqueueIntent(arrange::core::InputIntent::pointer("原生指针按下"));
        dispatchGesture(runtime, interaction, interaction.pointerDown(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, event.position.x, event.position.y, inputCallbacks, {event.getNumberOfClicks(), event.mods.isShiftDown()}, modifiers));
    }

    bool JucePointerInputAdapter::pointerDrag(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, const ::juce::MouseEvent& event, const TextInputCallbacks& inputCallbacks) const {
        if (!session.interactive(diagnostics)) {
            return false;
        }

        if (!event.mods.isLeftButtonDown()) return false;
        arrange::core::PointerGestureOutput gesture;
        const auto changed = interaction.pointerDrag(runtime.scene().tree(), session.loaded(), event.position.x, event.position.y, inputCallbacks, &gesture, keyModifierState(event.mods));
        dispatchGesture(runtime, interaction, gesture);
        if (changed) runtime.enqueueIntent(arrange::core::InputIntent::pointer("原生指针拖动"));
        return changed;
    }

    bool JucePointerInputAdapter::pointerUp(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event) const {
        if (!session.interactive(diagnostics)) {
            return false;
        }

        // 主键之外的抬起不结束主键会话
        if (event.mods.isPopupMenu() || event.mods.isMiddleButtonDown()) return false;
        const auto result = interaction.pointerUp(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, event.position.x, event.position.y, keyModifierState(event.mods));
        dispatchGesture(runtime, interaction, result.gesture);
        return result.clickTriggered && result.eventSlot.valid();
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
        const auto wheelResult = interaction.wheel(runtime.scene().tree(), root, point.x, point.y, input, runtime.publishedFrame().revision, runtime.publishedFrame().content.hitTest.get());
        if (wheelResult.wheelEvent) {
            auto payload = std::get<arrange::core::WheelEventPayload>(wheelResult.wheelEvent->payload);
            payload.modifiers = keyModifierState(::juce::ModifierKeys::getCurrentModifiers());
            runtime.enqueueInputEvent(wheelResult.wheelEvent->slot, payload);
            return true;
        }
        if (wheelResult.locked && !wheelResult.scroll.target) return true;
        const auto& result = wheelResult.scroll;
        if (ScrollProbe::active()) {
            const auto logicalDistance = [&](float delta, WheelUnit unit) {
                return delta * (unit == WheelUnit::Lines ? scrollLineDistance : unit == WheelUnit::Pages ? result.viewportSize : 1.0f);
            };
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
