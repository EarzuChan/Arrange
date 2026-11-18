#include <arrange/juce/JucePointerInputAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>
#include "PlatformWheelInput.h"

namespace arrange::juce {
    namespace {
        void dispatchGesture(ArrangeRuntime& runtime, InteractionStateOwner& interaction, const arrange::core::PointerGestureOutput& output) {
            interaction.notePointerEffects(output);
            for (const auto& event : output.events) {
                if (std::holds_alternative<std::monostate>(event.payload)) {
                    runtime.enqueueIntent(arrange::core::InputIntent::pointer());
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

    void JucePointerInputAdapter::pointerDown(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, const ::juce::MouseEvent& event, const arrange::core::InputCallbacks& inputCallbacks) const {
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
        runtime.enqueueIntent(arrange::core::InputIntent::pointer());
        dispatchGesture(runtime, interaction, interaction.pointerDown(runtime.scene().tree(), *runtime.publishedFrame().content.hitTest, event.position.x, event.position.y, inputCallbacks, {event.getNumberOfClicks(), event.mods.isShiftDown()}, modifiers));
    }

    bool JucePointerInputAdapter::pointerDrag(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, const ::juce::MouseEvent& event, const arrange::core::InputCallbacks& inputCallbacks) const {
        if (!session.interactive(diagnostics)) {
            return false;
        }

        if (!event.mods.isLeftButtonDown()) return false;
        arrange::core::PointerGestureOutput gesture;
        const auto changed = interaction.pointerDrag(runtime.scene().tree(), session.loaded(), event.position.x, event.position.y, inputCallbacks, &gesture, keyModifierState(event.mods));
        dispatchGesture(runtime, interaction, gesture);
        if (changed) runtime.enqueueIntent(arrange::core::InputIntent::pointer());
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
        return dispatchWheel(runtime, session, diagnostics, interaction, root, {event.position.x, event.position.y}, input);
    }

    bool JucePointerInputAdapter::wheelMove(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, arrange::core::Point point, const arrange::core::WheelInput& input) const {
        return dispatchWheel(runtime, session, diagnostics, interaction, root, point, input);
    }

    bool JucePointerInputAdapter::dispatchWheel(ArrangeRuntime& runtime, const RuntimeSessionState& session, const DiagnosticsState& diagnostics, InteractionStateOwner& interaction, arrange::core::NodeId root, arrange::core::Point point, const arrange::core::WheelInput& input) const {
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
        if (!result.consumed) return false;
        runtime.enqueueIntent(arrange::core::InputIntent::wheel());
        runtime.enqueueScrollSnapshotEvent(result.eventSlot, result);
        return true;
    }
}

#endif
