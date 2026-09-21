#include "QuickJsNativeApi.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsModifierReader.h"
#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <arrange/core/PropSchema.h>
#include <arrange/core/Version.h>

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

        std::optional<QuickJsDiagnosticLevel> diagnosticLevelFromName(std::string_view level) noexcept {
            if (level == "trace") return QuickJsDiagnosticLevel::Trace;
            if (level == "debug") return QuickJsDiagnosticLevel::Debug;
            if (level == "info") return QuickJsDiagnosticLevel::Info;
            if (level == "warn") return QuickJsDiagnosticLevel::Warn;
            if (level == "error") return QuickJsDiagnosticLevel::Error;
            return std::nullopt;
        }

        std::optional<QuickJsDiagnosticCategory> diagnosticCategoryFromName(std::string_view category) noexcept {
            if (category == "app") return QuickJsDiagnosticCategory::App;
            if (category == "host.live") return QuickJsDiagnosticCategory::HostLive;
            if (category == "host.dist") return QuickJsDiagnosticCategory::HostDist;
            if (category == "host.hmr") return QuickJsDiagnosticCategory::HostHmr;
            if (category == "runtime.script") return QuickJsDiagnosticCategory::RuntimeScript;
            if (category == "runtime.transaction") return QuickJsDiagnosticCategory::RuntimeTransaction;
            if (category == "pipeline.frame") return QuickJsDiagnosticCategory::PipelineFrame;
            if (category == "pipeline.layout") return QuickJsDiagnosticCategory::PipelineLayout;
            if (category == "pipeline.paint") return QuickJsDiagnosticCategory::PipelinePaint;
            if (category == "input.pointer") return QuickJsDiagnosticCategory::InputPointer;
            if (category == "input.key") return QuickJsDiagnosticCategory::InputKey;
            if (category == "input.ime") return QuickJsDiagnosticCategory::InputIme;
            if (category == "input.scroll") return QuickJsDiagnosticCategory::InputScroll;
            if (category == "resource.package") return QuickJsDiagnosticCategory::ResourcePackage;
            if (category == "resource.image") return QuickJsDiagnosticCategory::ResourceImage;
            if (category == "resource.icon") return QuickJsDiagnosticCategory::ResourceIcon;
            if (category == "diagnostics") return QuickJsDiagnosticCategory::Diagnostics;
            return std::nullopt;
        }

        QuickJsDiagnosticEventInput diagnosticPayload(JSContext* context, QuickJsDiagnosticLevel level, JSValueConst payload, bool forceToast = false) {
            QuickJsValueReader reader(context);
            if (JS_IsString(payload)) {
                QuickJsDiagnosticEventInput event;
                event.level = level;
                event.category = QuickJsDiagnosticCategory::RuntimeScript;
                event.message = reader.toString(payload);
                event.toast = forceToast;
                return event;
            }
            const auto categoryName = payloadStringField(context, reader, payload, "category", "runtime.script");
            auto category = diagnosticCategoryFromName(categoryName);
            QuickJsDiagnosticEventInput event;
            event.level = level;
            event.category = category.value_or(QuickJsDiagnosticCategory::RuntimeScript);
            event.code = payloadStringField(context, reader, payload, "code");
            event.message = payloadStringField(context, reader, payload, "message");
            if (event.message.empty()) event.message = reader.toString(payload);
            event.detail = payloadStringField(context, reader, payload, "detail");
            event.source = payloadStringField(context, reader, payload, "source");
            event.pathOrUrl = payloadStringField(context, reader, payload, "pathOrUrl");
            event.toast = forceToast || reader.boolField(payload, "toast", false);
            event.coalesceToast = reader.boolField(payload, "coalesceToast", true);
            if (!category && !categoryName.empty()) event.detail = event.detail.empty() ? "Unsupported diagnostics category '" + categoryName + "'; fell back to runtime.script." : event.detail + "\nUnsupported diagnostics category '" + categoryName + "'; fell back to runtime.script.";
            return event;
        }

        std::optional<QuickJsDiagnosticEventInput> diagnosticPayload(JSContext* context, std::string_view level, JSValueConst payload, bool forceToast = false) {
            const auto parsed = diagnosticLevelFromName(level);
            if (!parsed) return std::nullopt;
            return diagnosticPayload(context, *parsed, payload, forceToast);
        }

        QuickJsDiagnosticEventInput consoleDiagnostic(QuickJsDiagnosticLevel level, std::string code, std::string message) {
            QuickJsDiagnosticEventInput event;
            event.level = level;
            event.category = QuickJsDiagnosticCategory::RuntimeScript;
            event.code = std::move(code);
            event.message = std::move(message);
            return event;
        }

        std::optional<std::string> unsupportedPayloadCategory(JSContext* context, JSValueConst payload) {
            if (!JS_IsObject(payload)) return std::nullopt;
            QuickJsValueReader reader(context);
            const auto categoryName = payloadStringField(context, reader, payload, "category");
            if (categoryName.empty() || diagnosticCategoryFromName(categoryName)) return std::nullopt;
            return "Arrange diagnostics category is unsupported: " + categoryName;
        }

        std::string diagnosticsTextLine(const QuickJsDiagnosticEventInput& event) {
            const auto level = [event]() {
                switch (event.level) {
                    case QuickJsDiagnosticLevel::Trace:
                        return "trace";
                    case QuickJsDiagnosticLevel::Debug:
                        return "debug";
                    case QuickJsDiagnosticLevel::Info:
                        return "info";
                    case QuickJsDiagnosticLevel::Warn:
                        return "warn";
                    case QuickJsDiagnosticLevel::Error:
                        return "error";
                }
                return "info";
            }();
            const auto category = [event]() {
                switch (event.category) {
                    case QuickJsDiagnosticCategory::App:
                        return "app";
                    case QuickJsDiagnosticCategory::HostLive:
                        return "host.live";
                    case QuickJsDiagnosticCategory::HostDist:
                        return "host.dist";
                    case QuickJsDiagnosticCategory::HostHmr:
                        return "host.hmr";
                    case QuickJsDiagnosticCategory::RuntimeScript:
                        return "runtime.script";
                    case QuickJsDiagnosticCategory::RuntimeTransaction:
                        return "runtime.transaction";
                    case QuickJsDiagnosticCategory::PipelineFrame:
                        return "pipeline.frame";
                    case QuickJsDiagnosticCategory::PipelineLayout:
                        return "pipeline.layout";
                    case QuickJsDiagnosticCategory::PipelinePaint:
                        return "pipeline.paint";
                    case QuickJsDiagnosticCategory::InputPointer:
                        return "input.pointer";
                    case QuickJsDiagnosticCategory::InputKey:
                        return "input.key";
                    case QuickJsDiagnosticCategory::InputIme:
                        return "input.ime";
                    case QuickJsDiagnosticCategory::InputScroll:
                        return "input.scroll";
                    case QuickJsDiagnosticCategory::ResourcePackage:
                        return "resource.package";
                    case QuickJsDiagnosticCategory::ResourceImage:
                        return "resource.image";
                    case QuickJsDiagnosticCategory::ResourceIcon:
                        return "resource.icon";
                    case QuickJsDiagnosticCategory::Diagnostics:
                        return "diagnostics";
                }
                return "diagnostics";
            }();
            std::string line = std::string("[") + level + "][" + category + "]";
            if (!event.code.empty()) line += "[" + event.code + "]";
            line += " " + event.message;
            if (!event.detail.empty()) line += " - " + event.detail;
            if (!event.pathOrUrl.empty()) line += " (" + event.pathOrUrl + ")";
            return line;
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
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsLog(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto level = reader.toString(argv[0]);
            auto event = diagnosticPayload(context, level, argv[1]);
            if (!event) {
                return JS_ThrowTypeError(context, "Arrange diagnostics log level is unsupported: %s", level.c_str());
            }
            if (auto categoryError = unsupportedPayloadCategory(context, argv[1])) {
                return JS_ThrowTypeError(context, "%s", categoryError->c_str());
            }
            self->recordDiagnostic(std::move(*event));
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsToast(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            if (auto categoryError = unsupportedPayloadCategory(context, argv[0])) {
                return JS_ThrowTypeError(context, "%s", categoryError->c_str());
            }
            auto event = diagnosticPayload(context, QuickJsDiagnosticLevel::Info, argv[0], true);
            self->recordDiagnostic(event);
            return JS_UNDEFINED;
        }

        JSValue nativeReload(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            QuickJsDiagnosticAction action;
            action.kind = QuickJsDiagnosticActionKind::RequestReload;
            action.category = QuickJsDiagnosticCategory::Diagnostics;
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
            action.level = QuickJsDiagnosticLevel::Error;
            action.category = QuickJsDiagnosticCategory::Diagnostics;
            action.message = message;
            self->recordDiagnosticAction(std::move(action));
            return JS_ThrowInternalError(context, "%s", message.c_str());
        }

        JSValue nativeDiagnosticsCopyDiagnostics(JSContext* context, JSValueConst, int, JSValueConst*) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_NewString(context, "");
            std::string text;
            for (const auto& event : self->diagnosticEvents) text += diagnosticsTextLine(event) + "\n";
            return JS_NewStringLen(context, text.data(), text.size());
        }

        JSValue nativeDiagnosticsCopyRecentEvents(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            return nativeDiagnosticsCopyDiagnostics(context, JS_UNDEFINED, argc, argv);
        }

        JSValue nativeDiagnosticsSetLogLevel(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            QuickJsDiagnosticAction action;
            action.kind = QuickJsDiagnosticActionKind::SetLogLevel;
            const auto level = reader.toString(argv[0]);
            const auto parsed = diagnosticLevelFromName(level);
            if (!parsed) {
                return JS_ThrowTypeError(context, "Arrange diagnostics log level is unsupported: %s", level.c_str());
            }
            action.level = *parsed;
            self->recordDiagnosticAction(std::move(action));
            return JS_UNDEFINED;
        }

        JSValue consoleLog(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            std::string message;
            for (int i = 0; i < argc; ++i) {
                if (!message.empty()) message += " ";
                message += reader.toString(argv[i]);
            }
            self->recordDiagnostic(consoleDiagnostic(QuickJsDiagnosticLevel::Info, "console.log", message));
            return JS_UNDEFINED;
        }

        JSValue consoleWarn(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            std::string message;
            for (int i = 0; i < argc; ++i) {
                if (!message.empty()) message += " ";
                message += reader.toString(argv[i]);
            }
            self->recordDiagnostic(consoleDiagnostic(QuickJsDiagnosticLevel::Warn, "console.warn", message));
            return JS_UNDEFINED;
        }

        JSValue consoleError(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            std::string message;
            for (int i = 0; i < argc; ++i) {
                if (!message.empty()) message += " ";
                message += reader.toString(argv[i]);
            }
            self->recordDiagnostic(consoleDiagnostic(QuickJsDiagnosticLevel::Error, "console.error", message));
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsSetCategoryEnabled(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            QuickJsDiagnosticAction action;
            action.kind = QuickJsDiagnosticActionKind::SetCategoryEnabled;
            const auto categoryName = reader.toString(argv[0]);
            const auto category = diagnosticCategoryFromName(categoryName);
            if (!category) {
                return JS_ThrowTypeError(context, "Arrange diagnostics category is unsupported: %s", categoryName.c_str());
            }
            action.category = *category;
            action.enabled = reader.toBool(argv[1]);
            self->recordDiagnosticAction(std::move(action));
            return JS_UNDEFINED;
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

        JSValue requestAnimationFrame(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_NewUint32(context, 0);
            if (argc < 1 || !JS_IsFunction(context, argv[0])) return JS_ThrowTypeError(context, "requestAnimationFrame expects a callback");
            const auto handle = self->nextAnimationFrameHandle++;
            self->animationFrameCallbacks.emplace(handle, JS_DupValue(context, argv[0]));
            return JS_NewUint32(context, handle);
        }

        JSValue cancelAnimationFrame(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto handle = readIndex(context, argv[0]);
            if (JS_HasException(context)) return JS_EXCEPTION;
            if (const auto it = self->animationFrameCallbacks.find(handle); it != self->animationFrameCallbacks.end()) {
                JS_FreeValue(context, it->second);
                self->animationFrameCallbacks.erase(it);
            }
            return JS_UNDEFINED;
        }

        const JSCFunctionListEntry nativeApiFunctions[] = {
            JS_CFUNC_DEF("beginRearrange", 0, nativeBeginRearrange), JS_CFUNC_DEF("submitRearrange", 1, nativeSubmitRearrange), JS_CFUNC_DEF("abortRearrange", 0, nativeAbortRearrange), JS_CFUNC_DEF("createNode", 2, nativeCreateNode), JS_CFUNC_DEF("deleteNode", 1, nativeDeleteNode), JS_CFUNC_DEF("insertChild", 3, nativeInsertChild), JS_CFUNC_DEF("removeChild", 2, nativeRemoveChild), JS_CFUNC_DEF("setProp", 3, nativeSetProp), JS_CFUNC_DEF("setModifier", 2, nativeSetModifier), JS_CFUNC_DEF("registerBinding", 2, nativeRegisterBinding), JS_CFUNC_DEF("modifierInstances", 1, nativeModifierInstances), JS_CFUNC_DEF("registerModifierBinding", 2, nativeRegisterModifierBinding), JS_CFUNC_DEF("updateBinding", 2, nativeUpdateBinding), JS_CFUNC_DEF("releaseBinding", 1, nativeReleaseBinding), JS_CFUNC_DEF("unmount", 0, nativeUnmount), JS_CFUNC_DEF("reload", 1, nativeReload), JS_CFUNC_DEF("diagnosticsLog", 2, nativeDiagnosticsLog), JS_CFUNC_DEF("diagnosticsToast", 1, nativeDiagnosticsToast), JS_CFUNC_DEF("diagnosticsRequestReload", 1, nativeReload), JS_CFUNC_DEF("diagnosticsTriggerFakeError", 1, nativeDiagnosticsTriggerFakeError), JS_CFUNC_DEF("diagnosticsCopyDiagnostics", 0, nativeDiagnosticsCopyDiagnostics), JS_CFUNC_DEF("diagnosticsCopyRecentEvents", 0, nativeDiagnosticsCopyRecentEvents), JS_CFUNC_DEF("diagnosticsSetLogLevel", 1, nativeDiagnosticsSetLogLevel), JS_CFUNC_DEF("diagnosticsSetCategoryEnabled", 2, nativeDiagnosticsSetCategoryEnabled), JS_CFUNC_DEF("diagnosticsSetToastsEnabled", 1, nativeDiagnosticsSetToastsEnabled),
        };
    }  // namespace

    void QuickJsNativeApi::install(JSContext* context, QuickJsRuntimeContext& runtime) {
        ScopedValue global(context, JS_GetGlobalObject(context));
        ScopedValue native(context, JS_NewObject(context));
        JS_SetPropertyFunctionList(context, native.get(), nativeApiFunctions, static_cast<int>(std::size(nativeApiFunctions)));
        runtime.painters->install(native.get());
        JS_SetPropertyStr(context, native.get(), "runtimeVersion", JS_NewUint32(context, arrange::core::RuntimeVersion));
        JS_SetPropertyStr(context, global.get(), "__ARRANGE_NATIVE__", native.release());

        JS_SetPropertyStr(context, global.get(), "requestAnimationFrame", JS_NewCFunction(context, requestAnimationFrame, "requestAnimationFrame", 1));
        JS_SetPropertyStr(context, global.get(), "cancelAnimationFrame", JS_NewCFunction(context, cancelAnimationFrame, "cancelAnimationFrame", 1));
        ScopedValue performance(context, JS_NewObject(context));
        JS_SetPropertyStr(context, performance.get(), "now", JS_NewCFunction(context, performanceNow, "now", 0));
        JS_SetPropertyStr(context, performance.get(), "measureNow", JS_NewCFunction(context, performanceMeasureNow, "measureNow", 0));
        JS_SetPropertyStr(context, global.get(), "performance", performance.release());
        ScopedValue console(context, JS_NewObject(context));
        JS_SetPropertyStr(context, console.get(), "log", JS_NewCFunction(context, consoleLog, "log", 1));
        JS_SetPropertyStr(context, console.get(), "warn", JS_NewCFunction(context, consoleWarn, "warn", 1));
        JS_SetPropertyStr(context, console.get(), "error", JS_NewCFunction(context, consoleError, "error", 1));
        JS_SetPropertyStr(context, global.get(), "console", console.release());
    }
}  // namespace arrange::quickjs

#endif
