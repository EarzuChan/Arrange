#include <arrange/quickjs/QuickJsScriptHost.h>
#include <arrange/core/Version.h>

#if ARRANGE_WITH_QUICKJS_NG

extern "C" {
#include <quickjs.h>
}

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

namespace arrange::quickjs {
    namespace {
        class ScopedValue {
        public:
            ScopedValue(JSContext* ctx, JSValue value) : ctx_(ctx), value_(value) {}
            ~ScopedValue() { JS_FreeValue(ctx_, value_); }
            ScopedValue(const ScopedValue&) = delete;
            ScopedValue& operator=(const ScopedValue&) = delete;
            JSValueConst get() const noexcept { return value_; }

            JSValue release() noexcept {
                auto value = value_;
                value_ = JS_UNDEFINED;
                return value;
            }

        private:
            JSContext* ctx_ = nullptr;
            JSValue value_ = JS_UNDEFINED;
        };

        std::string toString(JSContext* ctx, JSValueConst value) {
            const char* text = JS_ToCString(ctx, value);
            if (text == nullptr) return {};
            std::string result(text);
            JS_FreeCString(ctx, text);
            return result;
        }

        std::string jsonEscape(std::string_view value) {
            std::string result;
            result.reserve(value.size() + 2);
            result.push_back('"');
            for (const char ch : value) {
                switch (ch) {
                case '\\': result += "\\\\";
                    break;
                case '"': result += "\\\"";
                    break;
                case '\n': result += "\\n";
                    break;
                case '\r': result += "\\r";
                    break;
                case '\t': result += "\\t";
                    break;
                default: result.push_back(ch);
                    break;
                }
            }
            result.push_back('"');
            return result;
        }

        std::string numberToString(double value) {
            if (std::isfinite(value) && std::floor(value) == value) { return std::to_string(static_cast<long long>(value)); }
            std::ostringstream out;
            out << value;
            return out.str();
        }

        std::uint32_t arrayLength(JSContext* ctx, JSValueConst value) {
            ScopedValue lengthValue(ctx, JS_GetPropertyStr(ctx, value, "length"));
            std::uint32_t length = 0;
            JS_ToUint32(ctx, &length, lengthValue.get());
            return length;
        }

        using CallbackRegister = std::uint32_t (*)(JSContext* ctx, JSValueConst callback, void* opaque);

        std::string serializeJsValue(JSContext* ctx, JSValueConst value, CallbackRegister registerCallback, void* callbackOpaque);

        std::string serializeObject(JSContext* ctx, JSValueConst value, CallbackRegister registerCallback, void* callbackOpaque) {
            JSPropertyEnum* props = nullptr;
            std::uint32_t count = 0;
            if (JS_GetOwnPropertyNames(ctx, &props, &count, value, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) return "{}";

            std::string result = "{";
            bool first = true;
            for (std::uint32_t i = 0; i < count; ++i) {
                const char* name = JS_AtomToCString(ctx, props[i].atom);
                if (name == nullptr) continue;
                ScopedValue child(ctx, JS_GetProperty(ctx, value, props[i].atom));
                if (!first) result += ",";
                first = false;
                result += jsonEscape(name);
                result += ":";
                result += serializeJsValue(ctx, child.get(), registerCallback, callbackOpaque);
                JS_FreeCString(ctx, name);
            }
            for (std::uint32_t i = 0; i < count; ++i) JS_FreeAtom(ctx, props[i].atom);
            js_free(ctx, props);
            result += "}";
            return result;
        }

        std::string serializeArray(JSContext* ctx, JSValueConst value, CallbackRegister registerCallback, void* callbackOpaque) {
            std::string result = "[";
            const auto length = arrayLength(ctx, value);
            for (std::uint32_t i = 0; i < length; ++i) {
                ScopedValue child(ctx, JS_GetPropertyUint32(ctx, value, i));
                if (i != 0) result += ",";
                result += serializeJsValue(ctx, child.get(), registerCallback, callbackOpaque);
            }
            result += "]";
            return result;
        }

        std::string serializeCallbackHandle(std::uint32_t handle) { return std::string("{\"callbackHandle\":") + std::to_string(handle) + "}"; }

        std::string serializeJsValue(JSContext* ctx, JSValueConst value, CallbackRegister registerCallback, void* callbackOpaque) {
            if (JS_IsUndefined(value)) return "null";
            if (JS_IsNull(value)) return "null";
            if (JS_IsBool(value)) return JS_ToBool(ctx, value) ? "true" : "false";
            if (JS_IsNumber(value)) {
                double number = 0.0;
                JS_ToFloat64(ctx, &number, value);
                return numberToString(number);
            }
            if (JS_IsString(value)) return jsonEscape(toString(ctx, value));
            if (JS_IsFunction(ctx, value)) return serializeCallbackHandle(registerCallback != nullptr ? registerCallback(ctx, value, callbackOpaque) : 0);
            if (JS_IsArray(value)) return serializeArray(ctx, value, registerCallback, callbackOpaque);
            if (JS_IsObject(value)) return serializeObject(ctx, value, registerCallback, callbackOpaque);
            return "null";
        }

        std::string encodeBridgeValue(JSContext* ctx, JSValueConst value, CallbackRegister registerCallback = nullptr, void* callbackOpaque = nullptr) {
            if (JS_IsUndefined(value)) return "u:";
            if (JS_IsNull(value)) return "n:";
            if (JS_IsBool(value)) return JS_ToBool(ctx, value) ? "b:1" : "b:0";
            if (JS_IsNumber(value)) {
                double number = 0.0;
                JS_ToFloat64(ctx, &number, value);
                return std::string("f:") + numberToString(number);
            }
            if (JS_IsString(value)) return std::string("s:") + toString(ctx, value);
            return std::string("o:") + serializeJsValue(ctx, value, registerCallback, callbackOpaque);
        }

        bool isNativeCallbackProp(std::string_view key) {
            return key == "__arrangeVerticalScrollCallback" ||
                key == "__arrangeHorizontalScrollCallback" ||
                key == "__arrangeClickCallback" ||
                key == "onUpdate:modelValue" ||
                key == "onUpdate:model-value" ||
                key == "onSubmit" ||
                key == "onChange" ||
                key == "onBlur";
        }

        std::string encodeBridgePropValue(JSContext* ctx, std::string_view key, JSValueConst value, CallbackRegister registerCallback = nullptr, void* callbackOpaque = nullptr) {
            if (isNativeCallbackProp(key) && JS_IsFunction(ctx, value)) {
                const auto handle = registerCallback != nullptr ? registerCallback(ctx, value, callbackOpaque) : 0;
                return std::string("h:") + std::to_string(handle);
            }
            return encodeBridgeValue(ctx, value, registerCallback, callbackOpaque);
        }

        std::string serializeModifierElement(JSContext* ctx, JSValueConst element, CallbackRegister registerCallback, void* callbackOpaque) {
            ScopedValue typeValue(ctx, JS_GetPropertyStr(ctx, element, "type"));
            ScopedValue valueObject(ctx, JS_GetPropertyStr(ctx, element, "value"));

            std::string result = "{";
            result += "\"type\":";
            result += jsonEscape(toString(ctx, typeValue.get()));

            if (JS_IsObject(valueObject.get())) {
                JSPropertyEnum* props = nullptr;
                std::uint32_t count = 0;
                if (JS_GetOwnPropertyNames(ctx, &props, &count, valueObject.get(), JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) >= 0) {
                    for (std::uint32_t i = 0; i < count; ++i) {
                        const char* name = JS_AtomToCString(ctx, props[i].atom);
                        if (name == nullptr) continue;
                        ScopedValue child(ctx, JS_GetProperty(ctx, valueObject.get(), props[i].atom));
                        result += ",";
                        result += jsonEscape(name);
                        result += ":";
                        result += serializeJsValue(ctx, child.get(), registerCallback, callbackOpaque);
                        JS_FreeCString(ctx, name);
                    }
                    for (std::uint32_t i = 0; i < count; ++i) JS_FreeAtom(ctx, props[i].atom);
                    js_free(ctx, props);
                }
            }

            result += "}";
            return result;
        }

        std::string serializeModifier(JSContext* ctx, JSValueConst modifier, CallbackRegister registerCallback, void* callbackOpaque) {
            ScopedValue elements(ctx, JS_GetPropertyStr(ctx, modifier, "elements"));
            if (!JS_IsArray(elements.get())) return {};

            std::string result = "o:[";
            const auto length = arrayLength(ctx, elements.get());
            if (length == 0) return {};
            for (std::uint32_t i = 0; i < length; ++i) {
                ScopedValue element(ctx, JS_GetPropertyUint32(ctx, elements.get(), i));
                if (i != 0) result += ",";
                result += serializeModifierElement(ctx, element.get(), registerCallback, callbackOpaque);
            }
            result += "]";
            return result;
        }

        std::string exceptionText(JSContext* ctx) {
            ScopedValue exception(ctx, JS_GetException(ctx));
            std::string result = toString(ctx, exception.get());
            ScopedValue stack(ctx, JS_GetPropertyStr(ctx, exception.get(), "stack"));
            if (!JS_IsUndefined(stack.get())) {
                const auto stackText = toString(ctx, stack.get());
                if (!stackText.empty()) {
                    result += "\n";
                    result += stackText;
                }
            }
            return result.empty() ? "QuickJS exception" : result;
        }

        bool startsWithDotSpecifier(std::string_view specifier) { return specifier == "." || specifier == ".." || specifier.starts_with("./") || specifier.starts_with("../"); }

        struct CallbackRegistrationScope {
            QuickJsScriptHost* owner = nullptr;
            std::vector<std::uint32_t>* handles = nullptr;
        };

        struct DrainJobsResult {
            bool ok = true;
            std::string error;
        };
    } // namespace

    struct QuickJsScriptHost::Impl {
        JSRuntime* runtime = nullptr;
        JSContext* context = nullptr;
        arrange::core::NodeId nextNodeId = 1;
        arrange::core::NodeId rootNodeId = 0;
        std::uint32_t nextCallbackHandle = 1;
        std::uint32_t nextAnimationFrameHandle = 1;
        double frameTimeMillis = 0.0;
        std::unordered_map<std::uint32_t, JSValue> callbacks;
        std::unordered_map<std::uint32_t, JSValue> animationFrameCallbacks;
        std::unordered_map<arrange::core::NodeId, std::vector<std::uint32_t>> modifierCallbacksByNode;
        std::unordered_map<arrange::core::NodeId, std::unordered_map<std::string, std::vector<std::uint32_t>>> propCallbacksByNode;
        std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>> childrenByNode;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeId> parentByNode;
        std::filesystem::path moduleRoot;

        ~Impl() { reset(); }

        void reset() {
            if (context != nullptr) {
                for (auto& [_, callback] : callbacks) JS_FreeValue(context, callback);
                for (auto& [_, callback] : animationFrameCallbacks) JS_FreeValue(context, callback);
            }
            callbacks.clear();
            animationFrameCallbacks.clear();
            modifierCallbacksByNode.clear();
            propCallbacksByNode.clear();
            childrenByNode.clear();
            parentByNode.clear();
            if (context != nullptr) {
                JS_FreeContext(context);
                context = nullptr;
            }
            if (runtime != nullptr) {
                JS_FreeRuntime(runtime);
                runtime = nullptr;
            }
            nextNodeId = 1;
            rootNodeId = 0;
            nextCallbackHandle = 1;
            nextAnimationFrameHandle = 1;
            frameTimeMillis = 0.0;
            moduleRoot.clear();
        }

        void initialise(QuickJsScriptHost* owner, const std::filesystem::path& entryPath) {
            reset();
            moduleRoot = std::filesystem::absolute(entryPath).lexically_normal().parent_path();
            runtime = JS_NewRuntime();
            JS_SetModuleLoaderFunc(runtime, &Impl::normalizeModuleName, &Impl::loadModule, owner);
            context = JS_NewContext(runtime);
            JS_SetContextOpaque(context, owner);

            ScopedValue global(context, JS_GetGlobalObject(context));
            ScopedValue native(context, JS_NewObject(context));
            JS_SetPropertyStr(context, native.get(), "commit", JS_NewCFunction(context, &Impl::nativeCommit, "commit", 1));
            JS_SetPropertyStr(context, native.get(), "reload", JS_NewCFunction(context, &Impl::nativeReload, "reload", 1));
            JS_SetPropertyStr(context, native.get(), "protocolVersion", JS_NewUint32(context, arrange::core::BridgeVersion));
            JS_SetPropertyStr(context, native.get(), "bridgeVersion", JS_NewUint32(context, arrange::core::BridgeVersion));
            JS_SetPropertyStr(context, global.get(), "__ARRANGE_NATIVE__", native.release());
            JS_SetPropertyStr(context, global.get(), "requestAnimationFrame", JS_NewCFunction(context, &Impl::requestAnimationFrame, "requestAnimationFrame", 1));
            JS_SetPropertyStr(context, global.get(), "cancelAnimationFrame", JS_NewCFunction(context, &Impl::cancelAnimationFrame, "cancelAnimationFrame", 1));
            ScopedValue performance(context, JS_NewObject(context));
            JS_SetPropertyStr(context, performance.get(), "now", JS_NewCFunction(context, &Impl::performanceNow, "now", 0));
            JS_SetPropertyStr(context, global.get(), "performance", performance.release());
        }

        DrainJobsResult drainJobs() {
            JSContext* jobContext = nullptr;
            int jobResult = 0;
            while ((jobResult = JS_ExecutePendingJob(runtime, &jobContext)) > 0) {}
            if (jobResult < 0) return {false, exceptionText(jobContext != nullptr ? jobContext : context)};
            return {};
        }

        static JSValue performanceNow(JSContext* ctx, JSValueConst, int, JSValueConst*) {
            auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx));
            if (owner == nullptr || owner->impl_ == nullptr) return JS_NewFloat64(ctx, 0.0);
            return JS_NewFloat64(ctx, owner->impl_->frameTimeMillis);
        }

        static JSValue requestAnimationFrame(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
            auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx));
            if (owner == nullptr || owner->impl_ == nullptr) return JS_NewUint32(ctx, 0);
            if (argc < 1 || !JS_IsFunction(ctx, argv[0])) { return JS_ThrowTypeError(ctx, "requestAnimationFrame expects a callback"); }
            const auto handle = owner->impl_->nextAnimationFrameHandle++;
            owner->impl_->animationFrameCallbacks.emplace(handle, JS_DupValue(ctx, argv[0]));
            return JS_NewUint32(ctx, handle);
        }

        static JSValue cancelAnimationFrame(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
            auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx));
            if (owner == nullptr || owner->impl_ == nullptr || argc < 1) return JS_UNDEFINED;
            std::uint32_t handle = 0;
            JS_ToUint32(ctx, &handle, argv[0]);
            const auto it = owner->impl_->animationFrameCallbacks.find(handle);
            if (it != owner->impl_->animationFrameCallbacks.end()) {
                JS_FreeValue(ctx, it->second);
                owner->impl_->animationFrameCallbacks.erase(it);
            }
            return JS_UNDEFINED;
        }

        static char* normalizeModuleName(JSContext* ctx, const char* moduleBaseName, const char* moduleName, void* opaque) {
            auto* owner = static_cast<QuickJsScriptHost*>(opaque);
            if (owner == nullptr || moduleName == nullptr) return nullptr;

            const std::string_view specifier(moduleName);
            std::filesystem::path resolved;
            if (std::filesystem::path(moduleName).is_absolute()) { resolved = moduleName; }
            else if (startsWithDotSpecifier(specifier)) {
                const std::filesystem::path base =
                    moduleBaseName != nullptr && *moduleBaseName != '\0'
                        ? std::filesystem::path(moduleBaseName).parent_path()
                        : owner->impl_->moduleRoot;
                resolved = base / moduleName;
            }
            else {
                JS_ThrowReferenceError(ctx, "unsupported bare module specifier '%s' in Arrange UI package", moduleName);
                return nullptr;
            }

            const auto normalized = std::filesystem::absolute(resolved).lexically_normal().generic_string();
            return js_strdup(ctx, normalized.c_str());
        }

        static JSModuleDef* loadModule(JSContext* ctx, const char* moduleName, void*) {
            const std::filesystem::path modulePath = std::filesystem::path(moduleName).lexically_normal();
            std::ifstream stream(modulePath, std::ios::binary);
            if (!stream) {
                JS_ThrowReferenceError(ctx, "could not load Arrange UI module '%s'", moduleName);
                return nullptr;
            }

            const std::string source((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
            ScopedValue compiled(ctx, JS_Eval(ctx, source.data(), source.size(), modulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY));
            if (JS_IsException(compiled.get())) return nullptr;

            auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled.get()));
            return module;
        }

        static std::uint32_t registerCallback(JSContext* ctx, JSValueConst callback, void* opaque) {
            auto* scope = static_cast<CallbackRegistrationScope*>(opaque);
            auto* owner = scope != nullptr ? scope->owner : nullptr;
            if (owner == nullptr) return 0;
            const auto handle = owner->impl_->nextCallbackHandle++;
            owner->impl_->callbacks.emplace(handle, JS_DupValue(ctx, callback));
            if (scope->handles != nullptr) scope->handles->push_back(handle);
            return handle;
        }

        void freeCallback(std::uint32_t handle) {
            if (context == nullptr) return;
            const auto it = callbacks.find(handle);
            if (it == callbacks.end()) return;
            JS_FreeValue(context, it->second);
            callbacks.erase(it);
        }

        void releaseCallbacks(const std::vector<std::uint32_t>& handles) { for (const auto handle : handles) freeCallback(handle); }

        void replaceModifierCallbacks(arrange::core::NodeId id, std::vector<std::uint32_t> handles) {
            const auto it = modifierCallbacksByNode.find(id);
            if (it != modifierCallbacksByNode.end()) releaseCallbacks(it->second);
            if (handles.empty()) {
                modifierCallbacksByNode.erase(id);
                return;
            }
            modifierCallbacksByNode[id] = std::move(handles);
        }

        void replacePropCallbacks(arrange::core::NodeId id, const std::string& key, std::vector<std::uint32_t> handles) {
            auto nodeIt = propCallbacksByNode.find(id);
            if (nodeIt != propCallbacksByNode.end()) {
                const auto propIt = nodeIt->second.find(key);
                if (propIt != nodeIt->second.end()) releaseCallbacks(propIt->second);
            }

            if (handles.empty()) {
                if (nodeIt != propCallbacksByNode.end()) {
                    nodeIt->second.erase(key);
                    if (nodeIt->second.empty()) propCallbacksByNode.erase(nodeIt);
                }
                return;
            }

            propCallbacksByNode[id][key] = std::move(handles);
        }

        void detachChild(arrange::core::NodeId parent, arrange::core::NodeId child) {
            const auto childrenIt = childrenByNode.find(parent);
            if (childrenIt != childrenByNode.end()) {
                auto& children = childrenIt->second;
                children.erase(std::remove(children.begin(), children.end(), child), children.end());
                if (children.empty()) childrenByNode.erase(childrenIt);
            }
            const auto parentIt = parentByNode.find(child);
            if (parentIt != parentByNode.end() && parentIt->second == parent) parentByNode.erase(parentIt);
        }

        void attachChild(arrange::core::NodeId parent, arrange::core::NodeId child, std::uint32_t index) {
            if (parent == 0 || child == 0) return;
            const auto oldParent = parentByNode.find(child);
            if (oldParent != parentByNode.end()) detachChild(oldParent->second, child);

            auto& children = childrenByNode[parent];
            const auto duplicate = std::find(children.begin(), children.end(), child);
            if (duplicate != children.end()) children.erase(duplicate);
            const auto insertIndex = std::min<std::size_t>(index, children.size());
            children.insert(children.begin() + static_cast<std::ptrdiff_t>(insertIndex), child);
            parentByNode[child] = parent;
        }

        void releaseNodeCallbacksRecursive(arrange::core::NodeId id) {
            const auto childrenIt = childrenByNode.find(id);
            if (childrenIt != childrenByNode.end()) {
                const auto children = childrenIt->second;
                for (const auto child : children) releaseNodeCallbacksRecursive(child);
            }

            const auto modifierIt = modifierCallbacksByNode.find(id);
            if (modifierIt != modifierCallbacksByNode.end()) {
                releaseCallbacks(modifierIt->second);
                modifierCallbacksByNode.erase(modifierIt);
            }

            const auto propIt = propCallbacksByNode.find(id);
            if (propIt != propCallbacksByNode.end()) {
                for (const auto& [_, handles] : propIt->second) releaseCallbacks(handles);
                propCallbacksByNode.erase(propIt);
            }

            const auto parentIt = parentByNode.find(id);
            if (parentIt != parentByNode.end()) detachChild(parentIt->second, id);
            childrenByNode.erase(id);
            parentByNode.erase(id);
        }

        void releaseAllTrackedCallbacks() {
            if (context != nullptr) { for (auto& [_, callback] : callbacks) JS_FreeValue(context, callback); }
            callbacks.clear();
            modifierCallbacksByNode.clear();
            propCallbacksByNode.clear();
            childrenByNode.clear();
            parentByNode.clear();
            rootNodeId = 0;
        }

        void appendUnmountOp(arrange::core::BridgeBatch& batch) {
            if (rootNodeId != 0) {
                arrange::core::BridgeOp deleteRoot;
                deleteRoot.opcode = arrange::core::BridgeOpcode::DeleteNode;
                deleteRoot.id = rootNodeId;
                batch.ops.push_back(std::move(deleteRoot));
            }
            releaseAllTrackedCallbacks();
        }

        void appendSetPropOp(arrange::core::BridgeBatch& batch, arrange::core::NodeId id, std::string key, std::string value) {
            arrange::core::BridgeOp setProp;
            setProp.opcode = arrange::core::BridgeOpcode::SetProp;
            setProp.id = id;
            setProp.key = std::move(key);
            setProp.value = std::move(value);
            batch.ops.push_back(std::move(setProp));
        }

        std::string encodeTypedModifierValue(JSContext* ctx, JSValueConst value) {
            if (JS_IsFunction(ctx, value)) return "n:";
            return encodeBridgeValue(ctx, value);
        }

        void appendFlattenedModifierValue(
            JSContext* ctx,
            arrange::core::NodeId id,
            std::string_view prefix,
            std::string path,
            JSValueConst value,
            arrange::core::BridgeBatch& batch) {
            if (JS_IsArray(value)) {
                const auto length = arrayLength(ctx, value);
                for (std::uint32_t index = 0; index < length; ++index) {
                    ScopedValue child(ctx, JS_GetPropertyUint32(ctx, value, index));
                    appendFlattenedModifierValue(
                        ctx,
                        id,
                        prefix,
                        path.empty() ? std::to_string(index) : path + "." + std::to_string(index),
                        child.get(),
                        batch);
                }
                return;
            }

            if (JS_IsObject(value) && !JS_IsFunction(ctx, value)) {
                JSPropertyEnum* props = nullptr;
                std::uint32_t count = 0;
                if (JS_GetOwnPropertyNames(ctx, &props, &count, value, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) { return; }
                for (std::uint32_t propIndex = 0; propIndex < count; ++propIndex) {
                    const char* name = JS_AtomToCString(ctx, props[propIndex].atom);
                    if (name == nullptr) continue;
                    ScopedValue child(ctx, JS_GetProperty(ctx, value, props[propIndex].atom));
                    const std::string childPath = path.empty() ? std::string(name) : path + "." + name;
                    appendFlattenedModifierValue(
                        ctx,
                        id,
                        prefix,
                        childPath,
                        child.get(),
                        batch);
                    JS_FreeCString(ctx, name);
                }
                for (std::uint32_t propIndex = 0; propIndex < count; ++propIndex) JS_FreeAtom(ctx, props[propIndex].atom);
                js_free(ctx, props);
                return;
            }

            if (!path.empty()) {
                appendSetPropOp(
                    batch,
                    id,
                    std::string(prefix) + path,
                    encodeTypedModifierValue(ctx, value));
            }
        }

        void appendTypedModifierElementProps(
            JSContext* ctx,
            arrange::core::NodeId id,
            JSValueConst elements,
            arrange::core::BridgeBatch& batch) {
            const auto length = arrayLength(ctx, elements);
            appendSetPropOp(
                batch,
                id,
                "__arrangeModifierCount",
                std::string("f:") + numberToString(length));
            for (std::uint32_t index = 0; index < length; ++index) {
                ScopedValue element(ctx, JS_GetPropertyUint32(ctx, elements, index));
                if (!JS_IsObject(element.get())) continue;
                const auto prefix = "__arrangeModifier." + std::to_string(index) + ".";
                ScopedValue typeValue(ctx, JS_GetPropertyStr(ctx, element.get(), "type"));
                appendSetPropOp(batch, id, prefix + "type", encodeBridgeValue(ctx, typeValue.get()));
                ScopedValue valueObject(ctx, JS_GetPropertyStr(ctx, element.get(), "value"));
                if (JS_IsObject(valueObject.get())) { appendFlattenedModifierValue(ctx, id, prefix, {}, valueObject.get(), batch); }
            }
        }

        void appendNativeScrollProps(QuickJsScriptHost& owner, JSContext* ctx, arrange::core::NodeId id, std::string_view direction, JSValueConst elementValue, arrange::core::BridgeBatch& batch) {
            ScopedValue state(ctx, JS_GetPropertyStr(ctx, elementValue, "state"));
            ScopedValue enabledValue(ctx, JS_GetPropertyStr(ctx, elementValue, "enabled"));
            const auto enabled = JS_IsUndefined(enabledValue.get()) ? true : JS_ToBool(ctx, enabledValue.get()) != 0;
            const auto directionText = std::string(direction);

            appendSetPropOp(batch, id, "__arrange" + directionText + "ScrollEnabled", enabled ? "b:1" : "b:0");

            double value = 0.0;
            if (JS_IsObject(state.get())) {
                ScopedValue scrollValue(ctx, JS_GetPropertyStr(ctx, state.get(), "value"));
                if (JS_IsNumber(scrollValue.get())) JS_ToFloat64(ctx, &value, scrollValue.get());
            }
            appendSetPropOp(batch, id, "__arrange" + directionText + "ScrollValue", std::string("f:") + numberToString(value));

            std::vector<std::uint32_t> propHandles;
            CallbackRegistrationScope propScope{&owner, &propHandles};
            const auto callbackKey = "__arrange" + directionText + "ScrollCallback";
            if (JS_IsObject(state.get())) {
                ScopedValue callback(ctx, JS_GetPropertyStr(ctx, state.get(), "__arrangeNativeScroll"));
                appendSetPropOp(batch, id, callbackKey, encodeBridgePropValue(ctx, callbackKey, callback.get(), &Impl::registerCallback, &propScope));
            }
            else { appendSetPropOp(batch, id, callbackKey, "n:"); }
            replacePropCallbacks(id, callbackKey, std::move(propHandles));
        }

        void appendDisabledNativeScrollProps(arrange::core::NodeId id, std::string_view direction, arrange::core::BridgeBatch& batch) {
            const auto directionText = std::string(direction);
            const auto callbackKey = "__arrange" + directionText + "ScrollCallback";
            appendSetPropOp(batch, id, "__arrange" + directionText + "ScrollEnabled", "b:0");
            appendSetPropOp(batch, id, "__arrange" + directionText + "ScrollValue", "f:0");
            appendSetPropOp(batch, id, callbackKey, "n:");
            replacePropCallbacks(id, callbackKey, {});
        }

        void appendNativeClickableProps(QuickJsScriptHost& owner, JSContext* ctx, arrange::core::NodeId id, JSValueConst elementValue, arrange::core::BridgeBatch& batch) {
            ScopedValue enabledValue(ctx, JS_GetPropertyStr(ctx, elementValue, "enabled"));
            const auto enabled = JS_IsUndefined(enabledValue.get()) ? true : JS_ToBool(ctx, enabledValue.get()) != 0;
            appendSetPropOp(batch, id, "__arrangeClickableEnabled", enabled ? "b:1" : "b:0");

            std::vector<std::uint32_t> propHandles;
            CallbackRegistrationScope propScope{&owner, &propHandles};
            ScopedValue callback(ctx, JS_GetPropertyStr(ctx, elementValue, "onClick"));
            appendSetPropOp(batch, id, "__arrangeClickCallback", encodeBridgePropValue(ctx, "__arrangeClickCallback", callback.get(), &Impl::registerCallback, &propScope));
            replacePropCallbacks(id, "__arrangeClickCallback", std::move(propHandles));
        }

        void appendDisabledNativeClickableProps(arrange::core::NodeId id, arrange::core::BridgeBatch& batch) {
            appendSetPropOp(batch, id, "__arrangeClickableEnabled", "b:0");
            appendSetPropOp(batch, id, "__arrangeClickCallback", "n:");
            replacePropCallbacks(id, "__arrangeClickCallback", {});
        }

        void appendNativeWeightProps(JSContext* ctx, arrange::core::NodeId id, JSValueConst elementValue, arrange::core::BridgeBatch& batch) {
            double weight = 0.0;
            ScopedValue weightValue(ctx, JS_GetPropertyStr(ctx, elementValue, "weight"));
            if (JS_IsNumber(weightValue.get())) JS_ToFloat64(ctx, &weight, weightValue.get());

            ScopedValue fillValue(ctx, JS_GetPropertyStr(ctx, elementValue, "fill"));
            const auto fill = JS_IsUndefined(fillValue.get()) ? true : JS_ToBool(ctx, fillValue.get()) != 0;

            appendSetPropOp(batch, id, "__arrangeWeight", std::string("f:") + numberToString(std::max(0.0, weight)));
            appendSetPropOp(batch, id, "__arrangeWeightFill", fill ? "b:1" : "b:0");
        }

        void appendDisabledNativeWeightProps(arrange::core::NodeId id, arrange::core::BridgeBatch& batch) {
            appendSetPropOp(batch, id, "__arrangeWeight", "f:0");
            appendSetPropOp(batch, id, "__arrangeWeightFill", "b:1");
        }

        double numericProperty(JSContext* ctx, JSValueConst object, const char* key, double fallback = 0.0) {
            ScopedValue value(ctx, JS_GetPropertyStr(ctx, object, key));
            double number = fallback;
            if (JS_IsNumber(value.get())) JS_ToFloat64(ctx, &number, value.get());
            return number;
        }

        void appendNativeAlignProps(JSContext* ctx, arrange::core::NodeId id, JSValueConst elementValue, arrange::core::BridgeBatch& batch) {
            ScopedValue alignment(ctx, JS_GetPropertyStr(ctx, elementValue, "alignment"));
            appendSetPropOp(batch, id, "__arrangeAlign", std::string("s:") + (JS_IsString(alignment.get()) ? toString(ctx, alignment.get()) : ""));
        }

        void appendDisabledNativeAlignProps(arrange::core::NodeId id, arrange::core::BridgeBatch& batch) { appendSetPropOp(batch, id, "__arrangeAlign", "s:"); }

        void appendNativeZIndexProps(JSContext* ctx, arrange::core::NodeId id, JSValueConst elementValue, arrange::core::BridgeBatch& batch) { appendSetPropOp(batch, id, "__arrangeZIndex", std::string("f:") + numberToString(numericProperty(ctx, elementValue, "value"))); }

        void appendDisabledNativeZIndexProps(arrange::core::NodeId id, arrange::core::BridgeBatch& batch) { appendSetPropOp(batch, id, "__arrangeZIndex", "f:0"); }

        void appendNativeLayoutOffsetProps(arrange::core::NodeId id, double x, double y, arrange::core::BridgeBatch& batch) {
            appendSetPropOp(batch, id, "__arrangeLayoutOffsetX", std::string("f:") + numberToString(x));
            appendSetPropOp(batch, id, "__arrangeLayoutOffsetY", std::string("f:") + numberToString(y));
        }

        void appendDisabledNativeLayoutOffsetProps(arrange::core::NodeId id, arrange::core::BridgeBatch& batch) { appendNativeLayoutOffsetProps(id, 0.0, 0.0, batch); }

        std::pair<double, double> transformOriginPair(JSContext* ctx, JSValueConst value) {
            if (JS_IsString(value)) {
                const auto text = toString(ctx, value);
                if (text == "TopStart") return {0.0, 0.0};
                if (text == "TopCenter") return {0.5, 0.0};
                if (text == "TopEnd") return {1.0, 0.0};
                if (text == "CenterStart") return {0.0, 0.5};
                if (text == "CenterEnd") return {1.0, 0.5};
                if (text == "BottomStart") return {0.0, 1.0};
                if (text == "BottomCenter") return {0.5, 1.0};
                if (text == "BottomEnd") return {1.0, 1.0};
            }
            if (JS_IsObject(value)) {
                return {
                    std::clamp(numericProperty(ctx, value, "x", 0.5), 0.0, 1.0),
                    std::clamp(numericProperty(ctx, value, "y", 0.5), 0.0, 1.0),
                };
            }
            return {0.5, 0.5};
        }

        void appendNativeLayerTransformProps(arrange::core::NodeId id, double scaleX, double scaleY, double rotationZ, double originX, double originY, arrange::core::BridgeBatch& batch) {
            appendSetPropOp(batch, id, "__arrangeLayerScaleX", std::string("f:") + numberToString(scaleX));
            appendSetPropOp(batch, id, "__arrangeLayerScaleY", std::string("f:") + numberToString(scaleY));
            appendSetPropOp(batch, id, "__arrangeLayerRotationZ", std::string("f:") + numberToString(rotationZ));
            appendSetPropOp(batch, id, "__arrangeLayerTransformOriginX", std::string("f:") + numberToString(originX));
            appendSetPropOp(batch, id, "__arrangeLayerTransformOriginY", std::string("f:") + numberToString(originY));
        }

        void appendDisabledNativeLayerTransformProps(arrange::core::NodeId id, arrange::core::BridgeBatch& batch) { appendNativeLayerTransformProps(id, 1.0, 1.0, 0.0, 0.5, 0.5, batch); }

        void appendNativeModifierProps(QuickJsScriptHost& owner, JSContext* ctx, arrange::core::NodeId id, JSValueConst modifier, arrange::core::BridgeBatch& batch) {
            ScopedValue elements(ctx, JS_GetPropertyStr(ctx, modifier, "elements"));
            if (!JS_IsArray(elements.get())) return;
            const auto length = arrayLength(ctx, elements.get());
            appendTypedModifierElementProps(ctx, id, elements.get(), batch);
            bool hasVerticalScroll = false;
            bool hasHorizontalScroll = false;
            bool hasClickable = false;
            bool hasWeight = false;
            bool hasAlign = false;
            bool hasZIndex = false;
            bool hasLayoutOffset = false;
            bool hasLayer = false;
            double layoutOffsetX = 0.0;
            double layoutOffsetY = 0.0;
            double layerScaleX = 1.0;
            double layerScaleY = 1.0;
            double layerRotationZ = 0.0;
            double layerOriginX = 0.5;
            double layerOriginY = 0.5;
            for (std::uint32_t i = 0; i < length; ++i) {
                ScopedValue element(ctx, JS_GetPropertyUint32(ctx, elements.get(), i));
                ScopedValue typeValue(ctx, JS_GetPropertyStr(ctx, element.get(), "type"));
                const auto type = toString(ctx, typeValue.get());
                if (type != "verticalScroll" && type != "horizontalScroll" && type != "clickable" && type != "weight" &&
                    type != "align" && type != "zIndex" && type != "offset" && type != "absoluteOffset" && type != "graphicsLayer")
                    continue;
                ScopedValue valueObject(ctx, JS_GetPropertyStr(ctx, element.get(), "value"));
                if (!JS_IsObject(valueObject.get())) continue;
                if (type == "verticalScroll") {
                    hasVerticalScroll = true;
                    appendNativeScrollProps(owner, ctx, id, "Vertical", valueObject.get(), batch);
                }
                else if (type == "horizontalScroll") {
                    hasHorizontalScroll = true;
                    appendNativeScrollProps(owner, ctx, id, "Horizontal", valueObject.get(), batch);
                }
                else if (type == "clickable") {
                    hasClickable = true;
                    appendNativeClickableProps(owner, ctx, id, valueObject.get(), batch);
                }
                else if (type == "weight") {
                    hasWeight = true;
                    appendNativeWeightProps(ctx, id, valueObject.get(), batch);
                }
                else if (type == "align" && !hasAlign) {
                    hasAlign = true;
                    appendNativeAlignProps(ctx, id, valueObject.get(), batch);
                }
                else if (type == "zIndex") {
                    hasZIndex = true;
                    appendNativeZIndexProps(ctx, id, valueObject.get(), batch);
                }
                else if (type == "offset" || type == "absoluteOffset") {
                    hasLayoutOffset = true;
                    layoutOffsetX += numericProperty(ctx, valueObject.get(), "x");
                    layoutOffsetY += numericProperty(ctx, valueObject.get(), "y");
                }
                else if (type == "graphicsLayer") {
                    hasLayoutOffset = true;
                    hasLayer = true;
                    layoutOffsetX += numericProperty(ctx, valueObject.get(), "translationX");
                    layoutOffsetY += numericProperty(ctx, valueObject.get(), "translationY");
                    layerScaleX = numericProperty(ctx, valueObject.get(), "scaleX", 1.0);
                    layerScaleY = numericProperty(ctx, valueObject.get(), "scaleY", 1.0);
                    layerRotationZ = numericProperty(ctx, valueObject.get(), "rotationZ");
                    ScopedValue origin(ctx, JS_GetPropertyStr(ctx, valueObject.get(), "transformOrigin"));
                    const auto originPair = transformOriginPair(ctx, origin.get());
                    layerOriginX = originPair.first;
                    layerOriginY = originPair.second;
                }
            }
            if (!hasVerticalScroll) appendDisabledNativeScrollProps(id, "Vertical", batch);
            if (!hasHorizontalScroll) appendDisabledNativeScrollProps(id, "Horizontal", batch);
            if (!hasClickable) appendDisabledNativeClickableProps(id, batch);
            if (!hasWeight) appendDisabledNativeWeightProps(id, batch);
            if (!hasAlign) appendDisabledNativeAlignProps(id, batch);
            if (!hasZIndex) appendDisabledNativeZIndexProps(id, batch);
            if (hasLayoutOffset) appendNativeLayoutOffsetProps(id, layoutOffsetX, layoutOffsetY, batch);
            else appendDisabledNativeLayoutOffsetProps(id, batch);
            if (hasLayer) appendNativeLayerTransformProps(id, layerScaleX, layerScaleY, layerRotationZ, layerOriginX, layerOriginY, batch);
            else appendDisabledNativeLayerTransformProps(id, batch);
        }

        static JSValue nativeCommit(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
            if (argc < 1) return JS_UNDEFINED;
            auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx));
            if (owner == nullptr) return JS_UNDEFINED;
            owner->impl_->captureCommit(*owner, ctx, argv[0]);
            return JS_UNDEFINED;
        }

        static JSValue nativeReload(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
            auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx));
            if (owner == nullptr) return JS_UNDEFINED;
            owner->reloadRequested_ = true;
            owner->reloadPayloadJson_ = argc > 0 ? serializeJsValue(ctx, argv[0], nullptr, nullptr) : "{}";
            return JS_UNDEFINED;
        }

        arrange::core::NodeId emitNode(QuickJsScriptHost& owner, JSContext* ctx, JSValueConst jsNode, arrange::core::NodeId parent, std::uint32_t index, arrange::core::BridgeBatch& batch) {
            const auto id = nextNodeId++;
            ScopedValue typeValue(ctx, JS_GetPropertyStr(ctx, jsNode, "type"));
            const auto type = toString(ctx, typeValue.get());

            arrange::core::BridgeOp create;
            create.opcode = arrange::core::BridgeOpcode::CreateNode;
            create.id = id;
            create.nodeType = type;
            batch.ops.push_back(std::move(create));

            ScopedValue props(ctx, JS_GetPropertyStr(ctx, jsNode, "props"));
            if (JS_IsObject(props.get())) {
                ScopedValue text(ctx, JS_GetPropertyStr(ctx, props.get(), "text"));
                if (!JS_IsUndefined(text.get()) && type == "Text") {
                    arrange::core::BridgeOp setText;
                    setText.opcode = arrange::core::BridgeOpcode::SetText;
                    setText.id = id;
                    setText.text = toString(ctx, text.get());
                    batch.ops.push_back(std::move(setText));
                }

                ScopedValue modifier(ctx, JS_GetPropertyStr(ctx, props.get(), "modifier"));
                std::vector<std::uint32_t> modifierHandles;
                CallbackRegistrationScope modifierScope{&owner, &modifierHandles};
                const auto modifierText = serializeModifier(ctx, modifier.get(), &Impl::registerCallback, &modifierScope);
                if (!modifierText.empty()) {
                    arrange::core::BridgeOp setModifier;
                    setModifier.opcode = arrange::core::BridgeOpcode::SetModifier;
                    setModifier.id = id;
                    setModifier.modifierDebugJson = modifierText;
                    batch.ops.push_back(std::move(setModifier));
                    appendNativeModifierProps(owner, ctx, id, modifier.get(), batch);
                }
                replaceModifierCallbacks(id, std::move(modifierHandles));

                JSPropertyEnum* propNames = nullptr;
                std::uint32_t propCount = 0;
                if (JS_GetOwnPropertyNames(ctx, &propNames, &propCount, props.get(), JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) >= 0) {
                    for (std::uint32_t propIndex = 0; propIndex < propCount; ++propIndex) {
                        const char* name = JS_AtomToCString(ctx, propNames[propIndex].atom);
                        if (name == nullptr) continue;
                        const std::string key(name);
                        JS_FreeCString(ctx, name);
                        if (key == "modifier" || (key == "text" && type == "Text")) continue;

                        ScopedValue value(ctx, JS_GetProperty(ctx, props.get(), propNames[propIndex].atom));
                        std::vector<std::uint32_t> propHandles;
                        CallbackRegistrationScope propScope{&owner, &propHandles};
                        arrange::core::BridgeOp setProp;
                        setProp.opcode = arrange::core::BridgeOpcode::SetProp;
                        setProp.id = id;
                        setProp.key = key;
                        setProp.value = encodeBridgePropValue(ctx, key, value.get(), &Impl::registerCallback, &propScope);
                        batch.ops.push_back(std::move(setProp));
                        replacePropCallbacks(id, key, std::move(propHandles));
                    }
                    for (std::uint32_t propIndex = 0; propIndex < propCount; ++propIndex) JS_FreeAtom(ctx, propNames[propIndex].atom);
                    js_free(ctx, propNames);
                }
            }

            if (parent != 0) {
                arrange::core::BridgeOp insert;
                insert.opcode = arrange::core::BridgeOpcode::InsertChild;
                insert.parent = parent;
                insert.child = id;
                insert.index = index;
                batch.ops.push_back(insert);
                attachChild(parent, id, index);
            }

            ScopedValue children(ctx, JS_GetPropertyStr(ctx, jsNode, "children"));
            if (JS_IsArray(children.get())) {
                const auto length = arrayLength(ctx, children.get());
                for (std::uint32_t childIndex = 0; childIndex < length; ++childIndex) {
                    ScopedValue child(ctx, JS_GetPropertyUint32(ctx, children.get(), childIndex));
                    if (JS_IsObject(child.get())) emitNode(owner, ctx, child.get(), id, childIndex, batch);
                }
            }

            return id;
        }

        bool appendBridgeOp(QuickJsScriptHost& owner, JSContext* ctx, JSValueConst item, arrange::core::BridgeBatch& batch) {
            ScopedValue opValue(ctx, JS_GetPropertyStr(ctx, item, "op"));
            const auto op = toString(ctx, opValue.get());
            arrange::core::BridgeOp bridgeOp;

            if (op == "createNode") {
                ScopedValue id(ctx, JS_GetPropertyStr(ctx, item, "id"));
                ScopedValue nodeType(ctx, JS_GetPropertyStr(ctx, item, "nodeType"));
                std::uint32_t parsedId = 0;
                JS_ToUint32(ctx, &parsedId, id.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::CreateNode;
                bridgeOp.id = parsedId;
                bridgeOp.nodeType = toString(ctx, nodeType.get());
            }
            else if (op == "deleteNode") {
                ScopedValue id(ctx, JS_GetPropertyStr(ctx, item, "id"));
                std::uint32_t parsedId = 0;
                JS_ToUint32(ctx, &parsedId, id.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::DeleteNode;
                bridgeOp.id = parsedId;
                releaseNodeCallbacksRecursive(parsedId);
            }
            else if (op == "insertChild") {
                ScopedValue parent(ctx, JS_GetPropertyStr(ctx, item, "parent"));
                ScopedValue child(ctx, JS_GetPropertyStr(ctx, item, "child"));
                ScopedValue index(ctx, JS_GetPropertyStr(ctx, item, "index"));
                std::uint32_t parsedParent = 0;
                std::uint32_t parsedChild = 0;
                std::uint32_t parsedIndex = 0;
                JS_ToUint32(ctx, &parsedParent, parent.get());
                JS_ToUint32(ctx, &parsedChild, child.get());
                JS_ToUint32(ctx, &parsedIndex, index.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::InsertChild;
                bridgeOp.parent = parsedParent;
                bridgeOp.child = parsedChild;
                bridgeOp.index = parsedIndex;
                attachChild(parsedParent, parsedChild, parsedIndex);
            }
            else if (op == "removeChild") {
                ScopedValue parent(ctx, JS_GetPropertyStr(ctx, item, "parent"));
                ScopedValue child(ctx, JS_GetPropertyStr(ctx, item, "child"));
                std::uint32_t parsedParent = 0;
                std::uint32_t parsedChild = 0;
                JS_ToUint32(ctx, &parsedParent, parent.get());
                JS_ToUint32(ctx, &parsedChild, child.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::RemoveChild;
                bridgeOp.parent = parsedParent;
                bridgeOp.child = parsedChild;
                detachChild(parsedParent, parsedChild);
            }
            else if (op == "setProp") {
                ScopedValue id(ctx, JS_GetPropertyStr(ctx, item, "id"));
                ScopedValue key(ctx, JS_GetPropertyStr(ctx, item, "key"));
                ScopedValue value(ctx, JS_GetPropertyStr(ctx, item, "value"));
                std::uint32_t parsedId = 0;
                JS_ToUint32(ctx, &parsedId, id.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::SetProp;
                bridgeOp.id = parsedId;
                bridgeOp.key = toString(ctx, key.get());
                std::vector<std::uint32_t> propHandles;
                CallbackRegistrationScope propScope{&owner, &propHandles};
                bridgeOp.value = encodeBridgePropValue(ctx, bridgeOp.key, value.get(), &Impl::registerCallback, &propScope);
                replacePropCallbacks(parsedId, bridgeOp.key, std::move(propHandles));
            }
            else if (op == "setModifier") {
                ScopedValue id(ctx, JS_GetPropertyStr(ctx, item, "id"));
                ScopedValue modifier(ctx, JS_GetPropertyStr(ctx, item, "modifier"));
                std::uint32_t parsedId = 0;
                JS_ToUint32(ctx, &parsedId, id.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::SetModifier;
                bridgeOp.id = parsedId;
                std::vector<std::uint32_t> modifierHandles;
                CallbackRegistrationScope modifierScope{&owner, &modifierHandles};
                bridgeOp.modifierDebugJson = serializeModifier(ctx, modifier.get(), &Impl::registerCallback, &modifierScope);
                replaceModifierCallbacks(parsedId, std::move(modifierHandles));
            }
            else if (op == "setText") {
                ScopedValue id(ctx, JS_GetPropertyStr(ctx, item, "id"));
                ScopedValue text(ctx, JS_GetPropertyStr(ctx, item, "text"));
                std::uint32_t parsedId = 0;
                JS_ToUint32(ctx, &parsedId, id.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::SetText;
                bridgeOp.id = parsedId;
                bridgeOp.text = toString(ctx, text.get());
            }
            else { return false; }

            batch.ops.push_back(std::move(bridgeOp));
            return true;
        }

        void captureCommit(QuickJsScriptHost& owner, JSContext* ctx, JSValueConst commitBatch) {
            if (!JS_IsArray(commitBatch)) return;
            arrange::core::BridgeBatch incrementalBatch;
            incrementalBatch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 0};
            const auto count = arrayLength(ctx, commitBatch);
            for (std::uint32_t i = 0; i < count; ++i) {
                ScopedValue item(ctx, JS_GetPropertyUint32(ctx, commitBatch, i));
                ScopedValue op(ctx, JS_GetPropertyStr(ctx, item.get(), "op"));
                const auto opName = toString(ctx, op.get());
                if (opName == "unmount") {
                    appendUnmountOp(incrementalBatch);
                    continue;
                }
                if (opName != "mount") {
                    (void)appendBridgeOp(owner, ctx, item.get(), incrementalBatch);
                    continue;
                }

                ScopedValue tree(ctx, JS_GetPropertyStr(ctx, item.get(), "tree"));
                if (!JS_IsObject(tree.get())) continue;

                arrange::core::BridgeBatch batch;
                batch.header = {arrange::core::BridgeMagic, arrange::core::BridgeVersion, 0, 0};
                releaseAllTrackedCallbacks();
                nextNodeId = 1;
                rootNodeId = emitNode(owner, ctx, tree.get(), 0, 0, batch);
                batch.header.opCount = static_cast<std::uint32_t>(batch.ops.size());
                owner.mountedBatch_ = std::move(batch);
                return;
            }

            if (!incrementalBatch.ops.empty()) {
                incrementalBatch.header.opCount = static_cast<std::uint32_t>(incrementalBatch.ops.size());
                if (owner.mountedBatch_) {
                    owner.mountedBatch_->ops.insert(owner.mountedBatch_->ops.end(), incrementalBatch.ops.begin(), incrementalBatch.ops.end());
                    owner.mountedBatch_->header.opCount = static_cast<std::uint32_t>(owner.mountedBatch_->ops.size());
                }
                else { owner.mountedBatch_ = std::move(incrementalBatch); }
            }
        }
    };

    QuickJsScriptHost::QuickJsScriptHost() : impl_(std::make_unique<Impl>()) {}
    QuickJsScriptHost::~QuickJsScriptHost() = default;

    std::size_t QuickJsScriptHost::callbackCount() const noexcept { return impl_ ? impl_->callbacks.size() : 0; }

    void QuickJsScriptHost::setFrameTimeMillis(double nowMillis) noexcept {
        if (!impl_) return;
        impl_->frameTimeMillis = std::max(0.0, nowMillis);
    }

    bool QuickJsScriptHost::hasPendingAnimationFrame() const noexcept { return impl_ && !impl_->animationFrameCallbacks.empty(); }

    CallbackInvokeResult QuickJsScriptHost::pumpAnimationFrame(double nowMillis) {
        if (impl_->context == nullptr) return {false, "QuickJS runtime is not initialised"};
        setFrameTimeMillis(nowMillis);
        mountedBatch_.reset();

        if (impl_->animationFrameCallbacks.empty()) {
            const auto drained = impl_->drainJobs();
            return {drained.ok, drained.error};
        }

        std::vector<std::pair<std::uint32_t, JSValue>> callbacks;
        callbacks.reserve(impl_->animationFrameCallbacks.size());
        for (auto& [handle, callback] : impl_->animationFrameCallbacks) callbacks.emplace_back(handle, callback);
        impl_->animationFrameCallbacks.clear();

        ScopedValue timestamp(impl_->context, JS_NewFloat64(impl_->context, impl_->frameTimeMillis));
        JSValueConst argv[1] = {timestamp.get()};
        for (std::size_t i = 0; i < callbacks.size(); ++i) {
            JSValue callbackValue = callbacks[i].second;
            callbacks[i].second = JS_UNDEFINED;
            ScopedValue result(impl_->context, JS_Call(impl_->context, callbackValue, JS_UNDEFINED, 1, argv));
            JS_FreeValue(impl_->context, callbackValue);
            if (JS_IsException(result.get())) {
                for (std::size_t j = i + 1; j < callbacks.size(); ++j) JS_FreeValue(impl_->context, callbacks[j].second);
                return {false, exceptionText(impl_->context)};
            }
        }

        const auto drained = impl_->drainJobs();
        return {drained.ok, drained.error};
    }

    ScriptExecutionResult QuickJsScriptHost::executeModule(const std::filesystem::path& modulePath, std::string_view source) {
        mountedBatch_.reset();
        reloadRequested_ = false;
        reloadPayloadJson_.clear();
        const auto normalizedModulePath = std::filesystem::absolute(modulePath).lexically_normal();
        impl_->initialise(this, normalizedModulePath);

        ScopedValue result(impl_->context, JS_Eval(impl_->context, source.data(), source.size(), normalizedModulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE));
        if (JS_IsException(result.get())) { return {false, exceptionText(impl_->context)}; }

        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};

        if (!mountedBatch_) return {false, "Arrange app did not mount. Expected createApp(App).mount() to commit a tree."};
        return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::invokeCallback(std::uint32_t callbackHandle, const CallbackInvokeOptions& options) {
        if (impl_->context == nullptr) return {false, "QuickJS runtime is not initialised"};
        const auto it = impl_->callbacks.find(callbackHandle);
        if (it == impl_->callbacks.end()) return {false, "Arrange callback handle is not registered in QuickJS"};
        ScopedValue callback(impl_->context, JS_DupValue(impl_->context, it->second));
        mountedBatch_.reset();

        JSValueConst* argv = nullptr;
        int argc = 0;
        JSValue argument = JS_UNDEFINED;
        if (options.hasStringArgument) {
            argument = JS_NewStringLen(impl_->context, options.stringArgument.data(), options.stringArgument.size());
            argv = &argument;
            argc = 1;
        }

        ScopedValue result(impl_->context, JS_Call(impl_->context, callback.get(), JS_UNDEFINED, argc, argv));
        if (options.hasStringArgument) JS_FreeValue(impl_->context, argument);
        if (JS_IsException(result.get())) return {false, exceptionText(impl_->context)};

        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
        return {true, {}};
    }
} // namespace arrange::quickjs

#endif
