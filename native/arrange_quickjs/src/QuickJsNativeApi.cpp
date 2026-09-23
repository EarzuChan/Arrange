#include "QuickJsNativeApi.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsModifierReader.h"
#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <arrange/core/PropSchema.h>
#include <arrange/core/Version.h>
#include <arrange/Log.h>

#include <iterator>
#include <optional>
#include <cmath>

namespace arrange::quickjs {
    namespace {
        QuickJsRuntimeContext* runtime(JSContext* context) {
            return static_cast<QuickJsRuntimeContext*>(JS_GetContextOpaque(context));
        }

        arrange::core::NodeType nodeTypeFor(QuickJsRuntimeContext& runtime, arrange::core::NodeId id) {
            const auto it = runtime.nodeTypes.find(id);
            return it == runtime.nodeTypes.end() ? arrange::core::NodeType::Unknown : it->second;
        }

        std::string payloadStringField(JSContext* context, QuickJsValueReader& reader, JSValueConst object, const char* key, std::string_view fallback = {}) {
            if (!JS_IsObject(object)) return std::string(fallback);
            ScopedValue value(context, JS_GetPropertyStr(context, object, key));
            if (JS_IsUndefined(value.get()) || JS_IsNull(value.get())) return std::string(fallback);
            return reader.toString(value.get());
        }

        arrange::LogLevel readLogLevel(JSContext* context, QuickJsValueReader& reader, JSValueConst value) {
            const auto level = reader.toString(value);
            if (level == "v") return arrange::LogLevel::Verbose;
            if (level == "d") return arrange::LogLevel::Debug;
            if (level == "i") return arrange::LogLevel::Info;
            if (level == "w") return arrange::LogLevel::Warn;
            if (level == "e") return arrange::LogLevel::Error;
            JS_ThrowTypeError(context, "Log 级别无效: %s", level.c_str());
            return arrange::LogLevel::Info;
        }

        std::string readArgs(JSContext* context, QuickJsValueReader& reader, JSValueConst value) {
            if (!JS_IsArray(value)) return {};
            ScopedValue length(context, JS_GetPropertyStr(context, value, "length"));
            std::uint32_t count = 0;
            if (JS_ToUint32(context, &count, length.get()) < 0) return {};
            std::string result;
            for (std::uint32_t i = 0; i < count; ++i) {
                ScopedValue arg(context, JS_GetPropertyUint32(context, value, i));
                if (i != 0) result.push_back(' ');
                result += reader.toString(arg.get());
            }
            return result;
        }

        std::uint32_t readIndex(JSContext* context, JSValueConst value, bool allowZero = false) {
            double number = 0;
            if (!JS_IsNumber(value) || JS_ToFloat64(context, &number, value) < 0 || !std::isfinite(number) || std::floor(number) != number || number < (allowZero ? 0 : 1) || number > UINT32_MAX) {
                JS_ThrowTypeError(context, "Arrange identity/index must be an exact uint32 number");
                return 0;
            }
            return static_cast<std::uint32_t>(number);
        }

        JSValue nativeBeginRearrange(JSContext* context, JSValueConst, int, JSValueConst*) {
            auto* self = runtime(context);
            try {
                self->beginRearrange();
            } catch (const std::exception& error) {
                return JS_ThrowInternalError(context, "%s", error.what());
            }
            return JS_UNDEFINED;
        }

        JSValue nativeSubmitRearrange(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (!self->rearrangeCheckpoint || !JS_IsUndefined(self->rearrangeCompletion)) return JS_ThrowTypeError(context, "没有可提交的重排候选");
            if (argc != 1 || !JS_IsFunction(context, argv[0])) return JS_ThrowTypeError(context, "重排提交必须提供结果回调");
            self->rearrangeCompletion = JS_DupValue(context, argv[0]);
            self->pendingTransactions->ensurePending().rearrange = self->rearrangeSubmission;
            return JS_UNDEFINED;
        }

        JSValue nativeAbortRearrange(JSContext* context, JSValueConst, int, JSValueConst*) {
            auto* self = runtime(context);
            self->abortRearrange();
            JS_FreeValue(context, self->rearrangeCompletion);
            self->rearrangeCompletion = JS_UNDEFINED;
            return JS_UNDEFINED;
        }

        JSValue nativeCreateNode(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            if (!JS_IsString(argv[1])) return JS_ThrowTypeError(context, "Arrange node type must be a string");
            const auto type = arrange::core::nodeTypeFromName(reader.toString(argv[1]));
            if (type == arrange::core::NodeType::Unknown) return JS_ThrowTypeError(context, "Arrange unknown native node type");
            if (id == 0 || self->nodeTypes.contains(id)) return JS_ThrowTypeError(context, "Arrange createNode requires a fresh nonzero node id");
            const auto generation = arrange::core::allocateRuntimeIdentity();
            self->nodeGenerations[id] = generation;
            if (self->rootNodeId == 0) self->rootNodeId = id;
            self->nodeTypes[id] = type;
            self->push(arrange::core::CreateNodeMutation{id, type, generation});
            return JS_UNDEFINED;
        }

        JSValue nativeDeleteNode(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            self->retireSubtree(id);
            self->push(arrange::core::DeleteNodeMutation{id});
            return JS_UNDEFINED;
        }

        JSValue nativeInsertChild(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 3) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto parent = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            const auto child = readIndex(context, argv[1]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            const auto index = readIndex(context, argv[2], true);
            if (JS_HasException(context)) return JS_EXCEPTION;
            self->attachChild(parent, child, index);
            self->push(arrange::core::InsertChildMutation{parent, child, index});
            return JS_UNDEFINED;
        }

        JSValue nativeRemoveChild(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto parent = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            const auto child = readIndex(context, argv[1]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            self->detachChild(parent, child);
            self->push(arrange::core::RemoveChildMutation{parent, child});
            return JS_UNDEFINED;
        }

        JSValue nativeSetProp(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 3) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            if (!self->nodeGenerations.contains(id)) return JS_ThrowReferenceError(context, "Arrange node does not exist");
            const auto key = reader.toString(argv[1]);
            if (JS_IsFunction(context, argv[2])) {
                return JS_ThrowTypeError(context, "原生输入 %s 不接受函数，事件回调须通过正式 Modifier 字段注册", key.c_str());
            }
            auto value = reader.propValue(argv[2]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            std::string propError;
            if (!arrange::core::validateSetPropMutation(nodeTypeFor(*self, id), key, value, propError)) {
                return JS_ThrowTypeError(context, "%s", propError.c_str());
            }
            const auto input = arrange::core::hostInputFromName(key);
            if (!input) return JS_ThrowTypeError(context, "Arrange unsupported host input: %s", key.c_str());
            self->setHostInput(id, *input, std::move(value));
            return JS_UNDEFINED;
        }

        JSValue nativeSetModifier(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            if (!self->nodeGenerations.contains(id)) return JS_ThrowReferenceError(context, "Arrange node does not exist");
            QuickJsModifierReader modifierReader(context, self->events, self->currentTransaction());
            const auto previous = self->modifierInputDescriptors(id);
            auto modifier = modifierReader.read(id, argv[1], nullptr, previous);
            if (modifierReader.failed() || JS_HasException(context)) {
                return JS_EXCEPTION;
            }
            self->setModifierChain(id, std::move(modifier));
            return JS_UNDEFINED;
        }

        JSValue bindingValue(JSContext* context, arrange::core::BindingHandle handle) {
            const auto result = JS_NewObject(context);
            JS_SetPropertyStr(context, result, "identity", JS_NewBigUint64(context, handle.identity));
            JS_SetPropertyStr(context, result, "generation", JS_NewBigUint64(context, handle.generation));
            return result;
        }

        std::optional<arrange::core::BindingHandle> readBinding(JSContext* context, JSValueConst value) {
            if (!JS_IsObject(value)) {
                JS_ThrowTypeError(context, "Arrange binding handle must be an object");
                return std::nullopt;
            }
            ScopedValue identity(context, JS_GetPropertyStr(context, value, "identity"));
            ScopedValue generation(context, JS_GetPropertyStr(context, value, "generation"));
            if (!JS_IsBigInt(identity.get()) || !JS_IsBigInt(generation.get())) {
                JS_ThrowTypeError(context, "Arrange binding identity and generation must be bigint");
                return std::nullopt;
            }
            arrange::core::BindingHandle handle;
            if (JS_ToBigUint64(context, &handle.identity, identity.get()) < 0 || JS_ToBigUint64(context, &handle.generation, generation.get()) < 0) return std::nullopt;
            ScopedValue canonicalIdentity(context, JS_NewBigUint64(context, handle.identity));
            ScopedValue canonicalGeneration(context, JS_NewBigUint64(context, handle.generation));
            if (!handle.valid() || !JS_IsStrictEqual(context, identity.get(), canonicalIdentity.get()) || !JS_IsStrictEqual(context, generation.get(), canonicalGeneration.get())) {
                JS_ThrowRangeError(context, "Arrange binding identity and generation must be nonzero uint64");
                return std::nullopt;
            }
            return handle;
        }

        JSValue nativeModifierInstances(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (!self || argc != 1) return JS_ThrowTypeError(context, "Arrange modifierInstances expects node id");
            const auto id = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            std::vector<const QuickJsRuntimeContext::PublishedModifier*> instances;
            for (const auto& [_, instance] : self->publishedModifiers) {
                if (instance.node.id == id && self->nodeGenerations.contains(id) && self->nodeGenerations.at(id) == instance.node.generation) instances.push_back(&instance);
            }
            std::sort(instances.begin(), instances.end(), [](const auto* left, const auto* right) { return left->position < right->position; });
            const auto result = JS_NewArray(context);
            std::uint32_t index = 0;
            for (const auto* instance : instances) {
                const auto item = bindingValue(context, {instance->handle.identity, instance->handle.generation});
                JS_SetPropertyStr(context, item, "key", JS_NewString(context, instance->descriptor.key.c_str()));
                const auto kind = arrange::core::modifierKindName(instance->descriptor.value);
                JS_SetPropertyStr(context, item, "kind", JS_NewStringLen(context, kind.data(), kind.size()));
                JS_SetPropertyUint32(context, result, index++, item);
            }
            return result;
        }

        JSValue nativeRegisterModifierBinding(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (!self || argc != 2) return JS_ThrowTypeError(context, "Arrange registerModifierBinding expects node id and instance handle");
            const auto id = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            const auto handle = readBinding(context, argv[1]);
            if (!handle) return JS_EXCEPTION;
            const auto found = self->publishedModifiers.find(handle->identity);
            if (found == self->publishedModifiers.end() || found->second.handle.generation != handle->generation || found->second.node.id != id || !self->nodeGenerations.contains(id) || self->nodeGenerations.at(id) != found->second.node.generation) {
                ++self->rejectedBindingUpdates;
                return JS_ThrowReferenceError(context, "Arrange Modifier instance is retired or not published");
            }
            std::vector<arrange::core::BindingHandle> previous;
            for (const auto& [_, binding] : self->bindings) {
                const auto* target = std::get_if<arrange::core::ModifierInputTarget>(&binding.target);
                if (target && target->modifier == found->second.handle) previous.push_back(binding.handle);
            }
            for (auto binding : previous) self->retireBinding(binding);
            return bindingValue(context, self->registerBinding(arrange::core::ModifierInputTarget{found->second.node, found->second.handle}));
        }

        JSValue nativeRegisterBinding(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc != 2 || !JS_IsNumber(argv[0]) || !JS_IsString(argv[1])) return JS_ThrowTypeError(context, "Arrange registerBinding expects node id and input name");
            QuickJsValueReader reader(context);
            const auto id = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            if (!self->nodeGenerations.contains(id)) return JS_ThrowReferenceError(context, "Arrange binding node does not exist");
            const arrange::core::NodeHandle node{id, self->nodeGenerations.at(id)};
            const auto name = reader.toString(argv[1]);
            arrange::core::BindingHandle handle;
            if (name == "modifier") {
                if (const auto previous = self->modifierBindings.find(id); previous != self->modifierBindings.end()) self->retireBinding(previous->second);
                handle = self->registerBinding(arrange::core::ModifierChainTarget{node});
                self->modifierBindings[id] = handle;
            } else {
                const auto input = arrange::core::hostInputFromName(name);
                if (!input) return JS_ThrowTypeError(context, "Arrange unsupported binding input: %s", name.c_str());
                if (const auto previous = self->hostBindings[id].find(*input); previous != self->hostBindings[id].end()) self->retireBinding(previous->second);
                handle = self->registerBinding(arrange::core::HostInputTarget{node, *input});
                self->hostBindings[id][*input] = handle;
            }
            return bindingValue(context, handle);
        }

        JSValue nativeUpdateBinding(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc != 2) return JS_ThrowTypeError(context, "Arrange updateBinding expects handle and value");
            const auto handle = readBinding(context, argv[0]);
            if (!handle) return JS_EXCEPTION;
            const auto found = self->bindings.find(handle->identity);
            if (found == self->bindings.end() || found->second.handle != *handle) {
                ++self->rejectedBindingUpdates;
                return JS_ThrowReferenceError(context, "Arrange binding is retired or belongs to another context");
            }
            const auto target = found->second.target;
            return std::visit(
                [&](const auto& input) -> JSValue {
                    using T = std::decay_t<decltype(input)>;
                    if constexpr (std::is_same_v<T, arrange::core::HostInputTarget>) {
                        QuickJsValueReader reader(context);
                        auto value = reader.propValue(argv[1]);
                        if (JS_HasException(context)) return JS_EXCEPTION;
                        std::string error;
                        if (!arrange::core::validateSetPropMutation(nodeTypeFor(*self, input.node.id), std::string(arrange::core::hostInputName(input.input)), value, error)) return JS_ThrowTypeError(context, "%s", error.c_str());
                        self->updateBinding(*handle, std::move(value));
                    } else if constexpr (std::is_same_v<T, arrange::core::ModifierChainTarget>) {
                        QuickJsModifierReader reader(context, self->events, self->currentTransaction());
                        const auto previous = self->modifierInputDescriptors(input.node.id);
                        auto value = reader.read(input.node.id, argv[1], nullptr, previous);
                        if (reader.failed() || JS_HasException(context)) return JS_EXCEPTION;
                        self->updateBinding(*handle, std::move(value));
                    } else if constexpr (std::is_same_v<T, arrange::core::ModifierInputTarget>) {
                        auto& inputs = self->modifierInputs[input.node.id];
                        const auto instance = std::find_if(inputs.begin(), inputs.end(), [&](const auto& value) { return value.handle == input.modifier; });
                        if (instance == inputs.end()) return JS_ThrowReferenceError(context, "Modifier 实例已从当前候选退出");
                        ScopedValue array(context, JS_NewArray(context));
                        JS_SetPropertyUint32(context, array.get(), 0, JS_DupValue(context, argv[1]));
                        QuickJsModifierReader reader(context, self->events, self->currentTransaction());
                        auto descriptors = reader.read(input.node.id, array.get(), &instance->descriptor.value);
                        if (reader.failed() || JS_HasException(context)) return JS_EXCEPTION;
                        self->updateBinding(*handle, std::move(descriptors.front().value));
                    }
                    return JS_UNDEFINED;
                },
                target);
        }

        JSValue nativeReleaseBinding(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc != 1) return JS_ThrowTypeError(context, "Arrange releaseBinding expects handle");
            const auto handle = readBinding(context, argv[0]);
            if (!handle) return JS_EXCEPTION;
            self->retireBinding(*handle);
            return JS_UNDEFINED;
        }

        JSValue nativeUnmount(JSContext* context, JSValueConst, int, JSValueConst*) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            if (self->rootNodeId != 0) self->retireSubtree(self->rootNodeId);
            self->events.releaseAll(self->currentTransaction());
            if (self->rootNodeId != 0) self->push(arrange::core::DeleteNodeMutation{self->rootNodeId});
            self->childrenByNode.clear();
            self->parentByNode.clear();
            self->nodeTypes.clear();
            self->publishedModifiers.clear();
            self->nodeGenerations.clear();
            self->hostBindings.clear();
            self->bindings.clear();
            self->modifierBindings.clear();
            self->rootNodeId = 0;
            self->frameRequested = false;
            self->framePrepared = false;
            JS_FreeValue(context, self->prepareFrame);
            JS_FreeValue(context, self->completeFrame);
            JS_FreeValue(context, self->disposeApp);
            self->prepareFrame = self->completeFrame = self->disposeApp = JS_UNDEFINED;
            return JS_UNDEFINED;
        }

        JSValue nativeLog(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc != 3 || !JS_IsArray(argv[2])) return JS_ThrowTypeError(context, "Log 需要级别、TAG 和参数数组");
            QuickJsValueReader reader(context);
            const auto tag = reader.toString(argv[1]);
            if (tag.empty()) return JS_ThrowTypeError(context, "Log TAG 不能为空");
            const auto mapped = readLogLevel(context, reader, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            arrange::Log::write(mapped, tag, readArgs(context, reader, argv[2]));
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsToast(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc != 5 || !JS_IsArray(argv[3])) return JS_ThrowTypeError(context, "DiagnosticsToast 需要级别、TAG、标题、参数数组和合并选项");
            QuickJsValueReader reader(context);
            const auto level = readLogLevel(context, reader, argv[0]);
            const auto tag = reader.toString(argv[1]);
            if (tag.empty()) return JS_ThrowTypeError(context, "DiagnosticsToast TAG 不能为空");
            QuickJsToastRequest toast;
            toast.level = level;
            toast.tag = tag;
            toast.title = reader.toString(argv[2]);
            if (toast.title.empty()) return JS_ThrowTypeError(context, "DiagnosticsToast 标题不能为空");
            toast.content = readArgs(context, reader, argv[3]);
            toast.coalesce = reader.toBool(argv[4]);
            self->recordToast(std::move(toast));
            return JS_UNDEFINED;
        }

        JSValue nativeReload(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            QuickJsDiagnosticAction action;
            action.kind = QuickJsDiagnosticActionKind::RequestReload;
            action.message = "Script requested reload";
            const auto payload = argc > 0 ? argv[0] : JS_UNDEFINED;
            if (JS_IsObject(payload)) {
                action.path = payloadStringField(context, reader, payload, "path");
                ScopedValue timestamp(context, JS_GetPropertyStr(context, payload, "timestamp"));
                if (JS_IsNumber(timestamp.get())) action.timestamp = reader.toDouble(timestamp.get());
            }
            if (JS_HasException(context)) return JS_EXCEPTION;
            self->recordDiagnosticAction(std::move(action));
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsTriggerFakeError(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto message = argc > 0 ? payloadStringField(context, reader, argv[0], "Manual script diagnostic error") : std::string("Manual script diagnostic error");
            QuickJsDiagnosticAction action;
            action.kind = QuickJsDiagnosticActionKind::TriggerFakeError;
            action.message = message;
            self->recordDiagnosticAction(std::move(action));
            return JS_ThrowInternalError(context, "%s", message.c_str());
        }

        JSValue nativeDiagnosticsSetToastsEnabled(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            QuickJsDiagnosticAction action;
            action.kind = QuickJsDiagnosticActionKind::SetToastsEnabled;
            action.enabled = reader.toBool(argv[0]);
            self->recordDiagnosticAction(std::move(action));
            return JS_UNDEFINED;
        }

        JSValue performanceMeasureNow(JSContext* context, JSValueConst, int, JSValueConst*) {
            const auto now = std::chrono::steady_clock::now().time_since_epoch();
            return JS_NewFloat64(context, std::chrono::duration<double, std::milli>(now).count());
        }

        JSValue performanceNow(JSContext* context, JSValueConst, int, JSValueConst*) {
            auto* self = runtime(context);
            return JS_NewFloat64(context, self == nullptr ? 0.0 : self->frameTimeMillis);
        }

        JSValue nativeInstallFrameDriver(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (!self || argc != 3) return JS_ThrowTypeError(context, "帧驱动需要准备、完成和销毁回调");
            if (!JS_IsUndefined(self->prepareFrame)) return JS_ThrowTypeError(context, "一个 Owner 只能安装一个帧驱动");
            for (int i = 0; i < argc; ++i)
                if (!JS_IsFunction(context, argv[i])) return JS_ThrowTypeError(context, "帧驱动参数必须是函数");

            self->prepareFrame = JS_DupValue(context, argv[0]);
            self->completeFrame = JS_DupValue(context, argv[1]);
            self->disposeApp = JS_DupValue(context, argv[2]);
            return JS_UNDEFINED;
        }

        JSValue nativeRequestFrame(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            if (auto* self = runtime(context)) {
                if (argc != 1 || !JS_IsBool(argv[0])) return JS_ThrowTypeError(context, "帧需求必须是布尔值");
                self->frameRequested = JS_ToBool(context, argv[0]);
                if (self->frameRequested && self->wakeOwner) self->wakeOwner();
            }
            return JS_UNDEFINED;
        }

        const JSCFunctionListEntry nativeApiFunctions[] = {
            JS_CFUNC_DEF("currentTime", 0, performanceNow), JS_CFUNC_DEF("installFrameDriver", 3, nativeInstallFrameDriver), JS_CFUNC_DEF("requestFrame", 1, nativeRequestFrame), JS_CFUNC_DEF("beginRearrange", 0, nativeBeginRearrange), JS_CFUNC_DEF("submitRearrange", 1, nativeSubmitRearrange), JS_CFUNC_DEF("abortRearrange", 0, nativeAbortRearrange), JS_CFUNC_DEF("createNode", 2, nativeCreateNode), JS_CFUNC_DEF("deleteNode", 1, nativeDeleteNode), JS_CFUNC_DEF("insertChild", 3, nativeInsertChild), JS_CFUNC_DEF("removeChild", 2, nativeRemoveChild), JS_CFUNC_DEF("setProp", 3, nativeSetProp), JS_CFUNC_DEF("setModifier", 2, nativeSetModifier), JS_CFUNC_DEF("registerBinding", 2, nativeRegisterBinding), JS_CFUNC_DEF("modifierInstances", 1, nativeModifierInstances), JS_CFUNC_DEF("registerModifierBinding", 2, nativeRegisterModifierBinding), JS_CFUNC_DEF("updateBinding", 2, nativeUpdateBinding), JS_CFUNC_DEF("releaseBinding", 1, nativeReleaseBinding), JS_CFUNC_DEF("unmount", 0, nativeUnmount), JS_CFUNC_DEF("reload", 1, nativeReload), JS_CFUNC_DEF("log", 3, nativeLog), JS_CFUNC_DEF("diagnosticsToast", 5, nativeDiagnosticsToast), JS_CFUNC_DEF("diagnosticsRequestReload", 1, nativeReload), JS_CFUNC_DEF("diagnosticsTriggerFakeError", 1, nativeDiagnosticsTriggerFakeError), JS_CFUNC_DEF("diagnosticsSetToastsEnabled", 1, nativeDiagnosticsSetToastsEnabled),
        };
    }  // namespace

    void QuickJsNativeApi::install(JSContext* context, QuickJsRuntimeContext& runtime) {
        ScopedValue global(context, JS_GetGlobalObject(context));
        ScopedValue native(context, JS_NewObject(context));
        JS_SetPropertyFunctionList(context, native.get(), nativeApiFunctions, static_cast<int>(std::size(nativeApiFunctions)));
        runtime.painters->install(native.get());
        JS_SetPropertyStr(context, native.get(), "runtimeVersion", JS_NewUint32(context, arrange::core::RuntimeVersion));
        JS_SetPropertyStr(context, global.get(), "__ARRANGE_NATIVE__", native.release());

        ScopedValue performance(context, JS_NewObject(context));
        JS_SetPropertyStr(context, performance.get(), "now", JS_NewCFunction(context, performanceNow, "now", 0));
        JS_SetPropertyStr(context, performance.get(), "measureNow", JS_NewCFunction(context, performanceMeasureNow, "measureNow", 0));
        JS_SetPropertyStr(context, global.get(), "performance", performance.release());
    }
}  // namespace arrange::quickjs

#endif
