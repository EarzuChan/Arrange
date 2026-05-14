#include "QuickJsNativeApi.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsModifierReader.h"
#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <arrange/core/Version.h>

#include <iterator>

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

        JSValue nativeBeginTransaction(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }
        JSValue nativeEndTransaction(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }

        JSValue nativeCreateNode(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 2) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = reader.toU32(argv[0]);
            if (self->rootNodeId == 0) self->rootNodeId = id;
            self->push(arrange::core::CreateNodeMutation{id, arrange::core::nodeTypeFromName(reader.toString(argv[1]))});
            return JS_UNDEFINED;
        }

        JSValue nativeDeleteNode(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
            auto* self = runtime(context);
            if (self == nullptr || argc < 1) return JS_UNDEFINED;
            QuickJsValueReader reader(context);
            const auto id = reader.toU32(argv[0]);
            self->releaseNodeCallbacksRecursive(id);
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
            self->push(arrange::core::SetPropMutation{id, key, reader.propValue(argv[2])});
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
    }
}

#endif
