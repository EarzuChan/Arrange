#include <arrange/juce/TextInputMutationSink.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/juce/ArrangeRuntime.h>

#include <string>
#include <utility>

namespace arrange::juce {
    namespace {
        void enqueueMutation(ArrangeRuntime& runtime, arrange::core::MutationTransaction transaction, std::string reason) {
            runtime.enqueueIntent(arrange::core::InputIntent::jsCommit(std::move(transaction), std::move(reason)));
        }
    } // namespace

    TextInputCallbacks TextInputMutationSink::callbacks(ArrangeRuntime& runtime) const {
        TextInputCallbacks result;
        result.invokeStringEvent = [&runtime](const arrange::core::EventSlotId& slot, const std::string& value) {
            if (slot.valid()) runtime.enqueueStringEvent(slot, value);
        };
        result.invalidateNativeState = [&runtime](arrange::core::NodeId nodeId, arrange::core::DirtyFlag flag, std::string reason) {
            arrange::core::MutationTransaction transaction;
            transaction.operations.emplace_back(arrange::core::NativeInvalidationMutation{
                nodeId,
                flag,
                flag == arrange::core::DirtyFlag::Paint ? "nativeInputPaint" : "nativeInputState",
                std::move(reason),
            });
            enqueueMutation(runtime, std::move(transaction), flag == arrange::core::DirtyFlag::Paint ? "native input paint invalidation" : "native input state invalidation");
        };
        result.enqueueKeyIntent = [&runtime](arrange::core::NodeId nodeId, std::string reason) {
            runtime.enqueueIntent(arrange::core::InputIntent::key(std::move(reason), nodeId));
        };
        result.enqueueTextInputIntent = [&runtime](arrange::core::NodeId nodeId, std::string reason) {
            runtime.enqueueIntent(arrange::core::InputIntent::textInput(std::move(reason), nodeId));
        };
        result.enqueueImeCompositionIntent = [&runtime](arrange::core::NodeId nodeId, std::string reason) {
            runtime.enqueueIntent(arrange::core::InputIntent::imeComposition(std::move(reason), nodeId));
        };
        return result;
    }
} // namespace arrange::juce

#endif
