#include "QuickJsNativeApi.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsModifierReader.h"
#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <arrange/core/PropSchema.h>
#include <arrange/core/Version.h>

#include <iterator>
#include <optional>

namespace arrange::quickjs {
    namespace {
        arrange::core::EventSlotKind propEventSlotKind(std::string_view key) noexcept {
            if (key == "onUpdate:modelValue" || key == "onUpdate:model-value") return arrange::core::EventSlotKind::InputUpdate;
            if (key == "onSubmit") return arrange::core::EventSlotKind::InputSubmit;
            if (key == "onChange") return arrange::core::EventSlotKind::InputChange;
            if (key == "onBlur") return arrange::core::EventSlotKind::InputBlur;
            return arrange::core::EventSlotKind::None;
        }

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
            if (!category && !categoryName.empty()) {
                event.detail = event.detail.empty()
                                   ? "Unsupported diagnostics category '" + categoryName + "'; fell back to runtime.script."
                                   : event.detail + "\nUnsupported diagnostics category '" + categoryName + "'; fell back to runtime.script.";
            }
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
                case QuickJsDiagnosticLevel::Trace: return "trace";
                case QuickJsDiagnosticLevel::Debug: return "debug";
                case QuickJsDiagnosticLevel::Info: return "info";
                case QuickJsDiagnosticLevel::Warn: return "warn";
                case QuickJsDiagnosticLevel::Error: return "error";
                }
                return "info";
            }();
            const auto category = [event]() {
                switch (event.category) {
                case QuickJsDiagnosticCategory::App: return "app";
                case QuickJsDiagnosticCategory::HostLive: return "host.live";
                case QuickJsDiagnosticCategory::HostDist: return "host.dist";
                case QuickJsDiagnosticCategory::HostHmr: return "host.hmr";
                case QuickJsDiagnosticCategory::RuntimeScript: return "runtime.script";
                case QuickJsDiagnosticCategory::RuntimeTransaction: return "runtime.transaction";
                case QuickJsDiagnosticCategory::PipelineFrame: return "pipeline.frame";
                case QuickJsDiagnosticCategory::PipelineLayout: return "pipeline.layout";
                case QuickJsDiagnosticCategory::PipelinePaint: return "pipeline.paint";
                case QuickJsDiagnosticCategory::InputPointer: return "input.pointer";
                case QuickJsDiagnosticCategory::InputKey: return "input.key";
                case QuickJsDiagnosticCategory::InputIme: return "input.ime";
                case QuickJsDiagnosticCategory::InputScroll: return "input.scroll";
                case QuickJsDiagnosticCategory::ResourcePackage: return "resource.package";
                case QuickJsDiagnosticCategory::ResourceImage: return "resource.image";
                case QuickJsDiagnosticCategory::ResourceIcon: return "resource.icon";
                case QuickJsDiagnosticCategory::Diagnostics: return "diagnostics";
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

        JSValue nativeBeginTransaction(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }
        JSValue nativeEndTransaction(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }

        JSValue nativeCreateNode(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = reader.toU32(argv[0]);
            const auto type = arrange::core::nodeTypeFromName(reader.toString(argv[1]));
            if (self->rootNodeId == 0) self->rootNodeId = id;
            self->nodeTypes[id] = type;
            self->push(arrange::core::CreateNodeMutation{id, type});
            return JS_UNDEFINED;
        }

        JSValue nativeDeleteNode(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = reader.toU32(argv[0]);
            self->releaseNodeCallbacksRecursive(id);
            self->releaseNodeTypesRecursive(id);
            self->push(arrange::core::DeleteNodeMutation{id});
            return JS_UNDEFINED;
        }

        JSValue nativeInsertChild(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 3) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto parent = reader.toU32(argv[0]);
            const auto child = reader.toU32(argv[1]);
            const auto index = reader.toU32(argv[2]);
            self->attachChild(parent, child, index);
            self->push(arrange::core::InsertChildMutation{parent, child, index});
            return JS_UNDEFINED;
        }

        JSValue nativeRemoveChild(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto parent = reader.toU32(argv[0]);
            const auto child = reader.toU32(argv[1]);
            self->detachChild(parent, child);
            self->push(arrange::core::RemoveChildMutation{parent, child});
            return JS_UNDEFINED;
        }

        JSValue nativeSetText(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            self->push(arrange::core::SetTextMutation{reader.toU32(argv[0]), reader.toString(argv[1])});
            return JS_UNDEFINED;
        }

        JSValue nativeSetProp(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 3) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = reader.toU32(argv[0]);
            const auto key = reader.toString(argv[1]);
            const auto slotKind = propEventSlotKind(key);
            if (slotKind != arrange::core::EventSlotKind::None) {
                self->events.replace(arrange::core::makeEventSlotId(id, slotKind), argv[2], self->currentTransaction());
                return JS_UNDEFINED;
            }
            if (JS_IsFunction(context, argv[2])) {
                return JS_ThrowTypeError(context, "Arrange prop '%s' is a function. Event callbacks must use typed EventSlot registration.", key.c_str());
            }
            auto value = reader.propValue(argv[2]);
            std::string propError;
            if (!arrange::core::validateSetPropMutation(nodeTypeFor(*self, id), key, value, propError)) {
                self->nativeError = propError;
                return JS_ThrowTypeError(context, "%s", propError.c_str());
            }
            self->push(arrange::core::SetPropMutation{id, key, std::move(value)});
            return JS_UNDEFINED;
        }

        JSValue nativeSetModifier(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = reader.toU32(argv[0]);
            QuickJsModifierReader modifierReader(context, self->events, self->currentTransaction());
            auto modifier = modifierReader.read(id, argv[1]);
            if (modifierReader.failed() || JS_HasException(context)) {
                self->nativeError = "Arrange native setModifier rejected invalid modifier";
                return JS_EXCEPTION;
            }
            self->push(arrange::core::SetModifierMutation{id, std::move(modifier)});
            return JS_UNDEFINED;
        }

        JSValue nativeInvalidate(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto flagName = reader.toString(argv[1]);
            auto flag = arrange::core::DirtyFlag::EventSlot;
            if (flagName == "paint") flag = arrange::core::DirtyFlag::Paint;
            else if (flagName == "layout") flag = arrange::core::DirtyFlag::Layout;
            else if (flagName == "structure") flag = arrange::core::DirtyFlag::Structure;
            else if (flagName == "hitTest") flag = arrange::core::DirtyFlag::HitTest;
            self->push(arrange::core::NativeInvalidationMutation{reader.toU32(argv[0]), flag, flagName, argc > 2 ? reader.toString(argv[2]) : flagName});
            return JS_UNDEFINED;
        }

        JSValue nativeUnmount(JSContext* context, JSValueConst, int, JSValueConst*) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            if (self->rootNodeId != 0) self->push(arrange::core::DeleteNodeMutation{self->rootNodeId});
            self->events.releaseAll(self->currentTransaction());
            self->childrenByNode.clear();
            self->parentByNode.clear();
            self->nodeTypes.clear();
            self->rootNodeId = 0;
            return JS_UNDEFINED;
        }

        JSValue nativeReload(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            self->reloadRequested = true;
            self->reloadRequest = {};
            const auto payload = argc > 0 ? argv[0] : JS_UNDEFINED;
            if (!JS_IsObject(payload)) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            ScopedValue path(context, JS_GetPropertyStr(context, payload, "path"));
            if (JS_IsString(path.get())) self->reloadRequest.path = reader.toString(path.get());
            ScopedValue timestamp(context, JS_GetPropertyStr(context, payload, "timestamp"));
            if (JS_IsNumber(timestamp.get())) self->reloadRequest.timestamp = reader.toDouble(timestamp.get());
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsLog(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto level = reader.toString(argv[0]);
            auto event = diagnosticPayload(context, level, argv[1]);
            if (!event) {
                self->nativeError = "Arrange diagnostics log level is unsupported: " + level;
                return JS_ThrowTypeError(context, "%s", self->nativeError.c_str());
            }
            if (auto categoryError = unsupportedPayloadCategory(context, argv[1])) {
                self->nativeError = std::move(*categoryError);
                return JS_ThrowTypeError(context, "%s", self->nativeError.c_str());
            }
            self->recordDiagnostic(std::move(*event));
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsToast(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            if (auto categoryError = unsupportedPayloadCategory(context, argv[0])) {
                self->nativeError = std::move(*categoryError);
                return JS_ThrowTypeError(context, "%s", self->nativeError.c_str());
            }
            auto event = diagnosticPayload(context, QuickJsDiagnosticLevel::Info, argv[0], true);
            self->recordDiagnostic(event);
            return JS_UNDEFINED;
        }

        JSValue nativeDiagnosticsRequestReload(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
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
        self->recordDiagnosticAction(std::move(action));
        JSValue reloadPayload = argc > 0 ? JS_DupValue(context, argv[0]) : JS_UNDEFINED;
        JSValueConst reloadArgv[1] = {reloadPayload};
        auto result = nativeReload(context, JS_UNDEFINED, JS_IsUndefined(reloadPayload) ? 0 : 1, reloadArgv);
        JS_FreeValue(context, reloadPayload);
        return result;
    }

        JSValue nativeDiagnosticsTriggerFakeError(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto message = argc > 0 ? payloadStringField(context, reader, argv[0], "Manual script diagnostic error") : std::string("Manual script diagnostic error");
            self->nativeError = message;
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
                self->nativeError = "Arrange diagnostics log level is unsupported: " + level;
                return JS_ThrowTypeError(context, "%s", self->nativeError.c_str());
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
                self->nativeError = "Arrange diagnostics category is unsupported: " + categoryName;
                return JS_ThrowTypeError(context, "%s", self->nativeError.c_str());
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
            const auto handle = reader.toU32(argv[0]);
            if (const auto it = self->animationFrameCallbacks.find(handle); it != self->animationFrameCallbacks.end()) {
                JS_FreeValue(context, it->second);
                self->animationFrameCallbacks.erase(it);
            }
            return JS_UNDEFINED;
        }

        const JSCFunctionListEntry nativeApiFunctions[] = {
            JS_CFUNC_DEF("beginTransaction", 0, nativeBeginTransaction),
            JS_CFUNC_DEF("endTransaction", 0, nativeEndTransaction),
            JS_CFUNC_DEF("createNode", 2, nativeCreateNode),
            JS_CFUNC_DEF("deleteNode", 1, nativeDeleteNode),
            JS_CFUNC_DEF("insertChild", 3, nativeInsertChild),
            JS_CFUNC_DEF("removeChild", 2, nativeRemoveChild),
            JS_CFUNC_DEF("setText", 2, nativeSetText),
            JS_CFUNC_DEF("setProp", 3, nativeSetProp),
            JS_CFUNC_DEF("setModifier", 2, nativeSetModifier),
            JS_CFUNC_DEF("invalidate", 3, nativeInvalidate),
            JS_CFUNC_DEF("unmount", 0, nativeUnmount),
            JS_CFUNC_DEF("reload", 1, nativeReload),
            JS_CFUNC_DEF("diagnosticsLog", 2, nativeDiagnosticsLog),
            JS_CFUNC_DEF("diagnosticsToast", 1, nativeDiagnosticsToast),
            JS_CFUNC_DEF("diagnosticsRequestReload", 1, nativeDiagnosticsRequestReload),
            JS_CFUNC_DEF("diagnosticsTriggerFakeError", 1, nativeDiagnosticsTriggerFakeError),
            JS_CFUNC_DEF("diagnosticsCopyDiagnostics", 0, nativeDiagnosticsCopyDiagnostics),
            JS_CFUNC_DEF("diagnosticsCopyRecentEvents", 0, nativeDiagnosticsCopyRecentEvents),
            JS_CFUNC_DEF("diagnosticsSetLogLevel", 1, nativeDiagnosticsSetLogLevel),
            JS_CFUNC_DEF("diagnosticsSetCategoryEnabled", 2, nativeDiagnosticsSetCategoryEnabled),
            JS_CFUNC_DEF("diagnosticsSetToastsEnabled", 1, nativeDiagnosticsSetToastsEnabled),
        };
    }

    void QuickJsNativeApi::install(JSContext* context, QuickJsRuntimeContext&) {
        ScopedValue global(context, JS_GetGlobalObject(context));
        ScopedValue native(context, JS_NewObject(context));
        JS_SetPropertyFunctionList(context, native.get(), nativeApiFunctions, static_cast<int>(std::size(nativeApiFunctions)));
        JS_SetPropertyStr(context, native.get(), "runtimeVersion", JS_NewUint32(context, arrange::core::RuntimeVersion));
        JS_SetPropertyStr(context, global.get(), "__ARRANGE_NATIVE__", native.release());

        JS_SetPropertyStr(context, global.get(), "requestAnimationFrame", JS_NewCFunction(context, requestAnimationFrame, "requestAnimationFrame", 1));
        JS_SetPropertyStr(context, global.get(), "cancelAnimationFrame", JS_NewCFunction(context, cancelAnimationFrame, "cancelAnimationFrame", 1));
        ScopedValue performance(context, JS_NewObject(context));
        JS_SetPropertyStr(context, performance.get(), "now", JS_NewCFunction(context, performanceNow, "now", 0));
        JS_SetPropertyStr(context, global.get(), "performance", performance.release());
        ScopedValue console(context, JS_NewObject(context));
        JS_SetPropertyStr(context, console.get(), "log", JS_NewCFunction(context, consoleLog, "log", 1));
        JS_SetPropertyStr(context, console.get(), "warn", JS_NewCFunction(context, consoleWarn, "warn", 1));
        JS_SetPropertyStr(context, console.get(), "error", JS_NewCFunction(context, consoleError, "error", 1));
        JS_SetPropertyStr(context, global.get(), "console", console.release());
    }
}

#endif
