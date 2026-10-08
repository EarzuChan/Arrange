#include <arrange/juce/JucePointerInputAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>
#include "ScrollProbe.h"

namespace arrange::juce {
    namespace {
        float wheelDistanceScale([[maybe_unused]] const ::juce::MouseWheelDetails& wheel) noexcept {
            // JUCE 的 macOS 精细 delta 是 AppKit point 值的 1/512；恢复逻辑距离而不是套用滚轮步长。
#if JUCE_MAC
            if (wheel.isSmooth) return 512.0f;
#endif
            return 48.0f;
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
        if (ScrollProbe::active()) {
            ScrollProbe::Sample sample;
            sample.kind = ScrollProbe::Kind::Input;
            sample.sourceMillis = static_cast<double>(event.eventTime.toMilliseconds());
            sample.x = event.position.x;
            sample.y = event.position.y;
            sample.deltaX = wheel.deltaX;
            sample.deltaY = wheel.deltaY;
            sample.inertial = wheel.isInertial;
            sample.smooth = wheel.isSmooth;
            sample.reversed = wheel.isReversed;
            sample.interactive = session.interactive(diagnostics);
            sample.valid = runtime.scene().contains(root);
            sample.pending = runtime.hasPendingFrameWork();
            sample.revision = runtime.publishedFrame().revision;
            ScrollProbe::record(sample);
        }
        if (!session.interactive(diagnostics) || !runtime.scene().contains(root)) {
            return false;
        }

        const auto distanceScale = wheelDistanceScale(wheel);
        const auto wheelResult = interaction.wheel(runtime.scene().tree(), root, event.position.x, event.position.y, wheel.deltaX * distanceScale, wheel.deltaY * distanceScale, runtime.publishedFrame().revision, 1.0f);
        const auto& result = wheelResult.scroll;
        if (ScrollProbe::active()) {
            ScrollProbe::Sample sample;
            sample.kind = ScrollProbe::Kind::Route;
            sample.deltaX = wheel.deltaX * distanceScale;
            sample.deltaY = wheel.deltaY * distanceScale;
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
        if (!result.consumed) {
            return false;
        }

        runtime.enqueueIntent(arrange::core::InputIntent::wheel(wheelResult.horizontal ? "native horizontal wheel input" : "native vertical wheel input", result.target, result.eventSlot));
        runtime.enqueueScrollSnapshotEvent(result.eventSlot, result);
        return true;
    }
}

#endif
