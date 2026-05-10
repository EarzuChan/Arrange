#include <arrange/juce/TextInputMutationSink.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/Bridge.h>
#include <arrange/core/InputIntent.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/juce/ArrangeRuntime.h>

#include <string>
#include <string_view>
#include <utility>

namespace arrange::juce {
    namespace {
        [[nodiscard]] std::string encodedString(std::string_view value) {
            return "s:" + std::string(value);
        }

        void enqueueSetPropMutation(
            ArrangeRuntime& runtime,
            arrange::core::NodeId nodeId,
            std::string key,
            std::string value) {
            arrange::core::BridgeBatch batch;
            batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
            arrange::core::BridgeOp op;
            op.opcode = arrange::core::BridgeOpcode::SetProp;
            op.id = nodeId;
            op.key = std::move(key);
            op.value = std::move(value);
            batch.ops.push_back(std::move(op));
            runtime.enqueueIntent(arrange::core::InputIntent::jsCommit(
                arrange::core::MutationTransaction::fromBridgeBatch(std::move(batch)),
                "native text input editing state"));
        }
    } // namespace

    TextInputCallbacks TextInputMutationSink::callbacks(ArrangeRuntime& runtime) const {
        TextInputCallbacks result;
        result.setModelValue = [&runtime](arrange::core::NodeId nodeId, std::string value) {
            enqueueSetPropMutation(runtime, nodeId, "modelValue", encodedString(value));
        };
        result.invokeStringEvent = [&runtime](
            const arrange::core::ArrangeNode& node,
            arrange::core::EventSlotKind kind,
            const char* camelCase,
            const char* kebabCase,
            const std::string& value) {
            runtime.enqueueNodeStringEvent(node, kind, camelCase, kebabCase, value);
        };
        result.invalidateNativeState = [&runtime](arrange::core::NodeId nodeId, arrange::core::DirtyFlag flag, std::string reason) {
            arrange::core::MutationTransaction transaction;
            transaction.treeMutations.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 1};
            arrange::core::BridgeOp op;
            op.opcode = arrange::core::BridgeOpcode::SetProp;
            op.id = nodeId;
            op.key = flag == arrange::core::DirtyFlag::Paint
                         ? "__arrangeNativeInputPaintInvalidation"
                         : "__arrangeNativeInputStateInvalidation";
            op.value = "s:" + std::move(reason);
            transaction.treeMutations.ops.push_back(std::move(op));
            runtime.enqueueIntent(arrange::core::InputIntent::jsCommit(
                std::move(transaction),
                flag == arrange::core::DirtyFlag::Paint ? "native input paint invalidation" : "native input state invalidation"));
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

