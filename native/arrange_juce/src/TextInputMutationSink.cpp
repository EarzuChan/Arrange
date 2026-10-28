#include <arrange/juce/TextInputMutationSink.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/juce/ArrangeRuntime.h>

#include <utility>

namespace arrange::juce {
    TextInputCallbacks TextInputMutationSink::callbacks(ArrangeRuntime& runtime) const {
        TextInputCallbacks result;
        result.invokeStringEvent = [&runtime](const arrange::core::EventSlotId& slot, const std::string& value) {
            if (slot.valid()) runtime.enqueueStringEvent(slot, value);
        };
        result.invokeFocusEvent = [&runtime](const auto& slot, bool focused, bool hasFocus) {
            if (slot.valid()) runtime.enqueueFocusEvent(slot, focused, hasFocus);
        };
        result.invokeEvent = [&runtime](const auto& slot) {
            if (slot.valid()) runtime.enqueueEvent(slot);
        };
        result.invokeScrollEvent = [&runtime](const auto& slot, const auto& scroll) {
            if (slot.valid()) runtime.enqueueScrollSnapshotEvent(slot, scroll);
        };
        result.dispatchKeyEvent = [&runtime](const arrange::core::EventSlotId& slot, const arrange::core::KeyEventPayload& payload) {
            return runtime.dispatchInputEventNow(slot, payload, ::juce::Time::getMillisecondCounterHiRes());
        };
        result.invalidateNativeState = [&runtime](arrange::core::NodeId nodeId, arrange::core::DirtyFlag flag) {
            arrange::core::MutationTransaction transaction;
            transaction.operations.emplace_back(arrange::core::NativeInvalidationMutation{nodeId, flag});
            runtime.enqueueIntent(arrange::core::InputIntent::jsCommit(std::move(transaction)));
        };
        result.enqueueKeyIntent = [&runtime](arrange::core::NodeId) {
            runtime.enqueueIntent(arrange::core::InputIntent::key());
        };
        result.enqueueTextInputIntent = [&runtime](arrange::core::NodeId) {
            runtime.enqueueIntent(arrange::core::InputIntent::textInput());
        };
        result.enqueueImeCompositionIntent = [&runtime](arrange::core::NodeId) {
            runtime.enqueueIntent(arrange::core::InputIntent::imeComposition());
        };
        return result;
    }
}

#endif
