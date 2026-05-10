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
#include <unordered_set>
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

        std::string serializeJsValue(JSContext* ctx, JSValueConst value);

        std::string serializeObject(JSContext* ctx, JSValueConst value) {
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
                result += serializeJsValue(ctx, child.get());
                JS_FreeCString(ctx, name);
            }
            for (std::uint32_t i = 0; i < count; ++i) JS_FreeAtom(ctx, props[i].atom);
            js_free(ctx, props);
            result += "}";
            return result;
        }

        std::string serializeArray(JSContext* ctx, JSValueConst value) {
            std::string result = "[";
            const auto length = arrayLength(ctx, value);
            for (std::uint32_t i = 0; i < length; ++i) {
                ScopedValue child(ctx, JS_GetPropertyUint32(ctx, value, i));
                if (i != 0) result += ",";
                result += serializeJsValue(ctx, child.get());
            }
            result += "]";
            return result;
        }

        std::string serializeJsValue(JSContext* ctx, JSValueConst value) {
            if (JS_IsUndefined(value)) return "null";
            if (JS_IsNull(value)) return "null";
            if (JS_IsBool(value)) return JS_ToBool(ctx, value) ? "true" : "false";
            if (JS_IsNumber(value)) {
                double number = 0.0;
                JS_ToFloat64(ctx, &number, value);
                return numberToString(number);
            }
            if (JS_IsString(value)) return jsonEscape(toString(ctx, value));
            if (JS_IsFunction(ctx, value)) return "null";
            if (JS_IsArray(value)) return serializeArray(ctx, value);
            if (JS_IsObject(value)) return serializeObject(ctx, value);
            return "null";
        }

        std::string encodeBridgeValue(JSContext* ctx, JSValueConst value) {
            if (JS_IsUndefined(value)) return "u:";
            if (JS_IsNull(value)) return "n:";
            if (JS_IsBool(value)) return JS_ToBool(ctx, value) ? "b:1" : "b:0";
            if (JS_IsNumber(value)) {
                double number = 0.0;
                JS_ToFloat64(ctx, &number, value);
                return std::string("f:") + numberToString(number);
            }
            if (JS_IsString(value)) return std::string("s:") + toString(ctx, value);
            return std::string("o:") + serializeJsValue(ctx, value);
        }

        bool isEventFunctionProp(std::string_view key) {
            return key == "onUpdate:modelValue" ||
                key == "onUpdate:model-value" ||
                key == "onSubmit" ||
                key == "onChange" ||
                key == "onBlur";
        }

        arrange::core::EventSlotKind propEventSlotKind(std::string_view key) noexcept {
            if (key == "onUpdate:modelValue" || key == "onUpdate:model-value") return arrange::core::EventSlotKind::InputUpdate;
            if (key == "onSubmit") return arrange::core::EventSlotKind::InputSubmit;
            if (key == "onChange") return arrange::core::EventSlotKind::InputChange;
            if (key == "onBlur") return arrange::core::EventSlotKind::InputBlur;
            return arrange::core::EventSlotKind::None;
        }

        std::string eventSlotPropKey(std::string_view key) {
            if (key == "onUpdate:modelValue") return "__arrangeEventSlot.onUpdate:modelValue";
            if (key == "onUpdate:model-value") return "__arrangeEventSlot.onUpdate:model-value";
            if (key == "onSubmit") return "__arrangeEventSlot.onSubmit";
            if (key == "onChange") return "__arrangeEventSlot.onChange";
            if (key == "onBlur") return "__arrangeEventSlot.onBlur";
            return {};
        }

        std::string encodeBridgePropValue(JSContext* ctx, std::string_view key, JSValueConst value) {
            if (isEventFunctionProp(key) && JS_IsFunction(ctx, value)) return "s:[Function]";
            return encodeBridgeValue(ctx, value);
        }

        JSValue eventSlotCallbackValue(JSContext* ctx, JSValueConst value) {
            if (JS_IsFunction(ctx, value)) return JS_DupValue(ctx, value);
            if (!JS_IsObject(value)) return JS_UNDEFINED;
            return JS_GetPropertyStr(ctx, value, "callback");
        }

        std::string encodeNativeEventSlotPropValue(
            JSContext* ctx,
            JSValueConst value,
            const arrange::core::EventSlotId& slot) {
            if (!slot.valid() || !JS_IsFunction(ctx, value)) return "n:";
            return arrange::core::encodeEventSlotProp(slot);
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
        std::uint32_t nextAnimationFrameHandle = 1;
        double frameTimeMillis = 0.0;
        QuickJsScriptHost* owner = nullptr;
        std::unordered_map<std::string, JSValue> eventSlots;
        std::unordered_set<std::string> retiredEventSlots;
        std::unordered_map<std::uint32_t, JSValue> animationFrameCallbacks;
        std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>> childrenByNode;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeId> parentByNode;
        std::filesystem::path moduleRoot;

        ~Impl() { reset(); }

        static std::vector<arrange::core::EventSlotId> builtinEventSlotsForNode(arrange::core::NodeId id) {
            return {
                arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click),
                arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::VerticalScroll),
                arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::HorizontalScroll),
                arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputUpdate),
                arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputSubmit),
                arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputChange),
                arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputBlur),
            };
        }

        void reset() {
            if (context != nullptr) {
                for (auto& [_, callback] : eventSlots) JS_FreeValue(context, callback);
                for (auto& [_, callback] : animationFrameCallbacks) JS_FreeValue(context, callback);
            }
            eventSlots.clear();
            retiredEventSlots.clear();
            animationFrameCallbacks.clear();
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
            nextAnimationFrameHandle = 1;
            frameTimeMillis = 0.0;
            owner = nullptr;
            moduleRoot.clear();
        }

        void initialise(QuickJsScriptHost* owner, const std::filesystem::path& entryPath) {
            reset();
            this->owner = owner;
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

        void replaceEventSlot(const arrange::core::EventSlotId& slot, JSValueConst callback) {
            if (context == nullptr || !slot.valid()) return;
            const auto key = slot.toString();
            const auto old = eventSlots.find(key);
            if (old != eventSlots.end()) {
                JS_FreeValue(context, old->second);
                eventSlots.erase(old);
            }
            if (!JS_IsFunction(context, callback)) {
                releaseEventSlot(slot);
                return;
            }
            retiredEventSlots.erase(key);
            eventSlots.emplace(key, JS_DupValue(context, callback));
            if (auto* transaction = currentTransaction()) transaction->eventSlotUpdates.push_back(slot);
        }

        void releaseEventSlot(const arrange::core::EventSlotId& slot) {
            if (context == nullptr || !slot.valid()) return;
            if (auto* transaction = currentTransaction()) transaction->retiredEventSlots.push_back(slot);
            retiredEventSlots.insert(slot.toString());
        }

        void flushRetiredEventSlots() {
            if (context == nullptr) {
                retiredEventSlots.clear();
                return;
            }
            for (const auto& slot : retiredEventSlots) {
                const auto it = eventSlots.find(slot);
                if (it == eventSlots.end()) continue;
                JS_FreeValue(context, it->second);
                eventSlots.erase(it);
            }
            retiredEventSlots.clear();
        }

        arrange::core::MutationTransaction* currentTransaction() noexcept {
            if (owner == nullptr) return nullptr;
            return &owner->pendingTransactions_.ensurePending();
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

            for (const auto& slot : builtinEventSlotsForNode(id)) releaseEventSlot(slot);

            const auto parentIt = parentByNode.find(id);
            if (parentIt != parentByNode.end()) detachChild(parentIt->second, id);
            childrenByNode.erase(id);
            parentByNode.erase(id);
        }

        void releaseAllEventSlots() {
            if (auto* transaction = currentTransaction()) {
                for (const auto& [key, _] : eventSlots) {
                    const auto slot = arrange::core::parseEventSlotId(key);
                    if (slot.valid()) transaction->retiredEventSlots.push_back(slot);
                }
            }
            for (const auto& [key, _] : eventSlots) retiredEventSlots.insert(key);
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
            releaseAllEventSlots();
        }

        void appendSetPropOp(arrange::core::BridgeBatch& batch, arrange::core::NodeId id, std::string key, std::string value) {
            arrange::core::BridgeOp setProp;
            setProp.opcode = arrange::core::BridgeOpcode::SetProp;
            setProp.id = id;
            setProp.key = std::move(key);
            setProp.value = std::move(value);
            batch.ops.push_back(std::move(setProp));
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
            owner->reloadPayloadJson_ = argc > 0 ? serializeJsValue(ctx, argv[0]) : "{}";
            return JS_UNDEFINED;
        }


        void registerStandardModifierEventSlots(QuickJsScriptHost& owner, JSContext* ctx, arrange::core::NodeId id, JSValueConst payload) {
            if (!JS_IsArray(payload)) {
                owner.impl_->releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click));
                owner.impl_->releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::VerticalScroll));
                owner.impl_->releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::HorizontalScroll));
                return;
            }

            bool hasClickCallback = false;
            bool hasVerticalScrollCallback = false;
            bool hasHorizontalScrollCallback = false;
            const auto length = arrayLength(ctx, payload);
            for (std::uint32_t i = 0; i < length; ++i) {
                ScopedValue element(ctx, JS_GetPropertyUint32(ctx, payload, i));
                ScopedValue typeValue(ctx, JS_GetPropertyStr(ctx, element.get(), "type"));
                const auto type = toString(ctx, typeValue.get());
                if (type == "clickable") {
                    ScopedValue binding(ctx, JS_GetPropertyStr(ctx, element.get(), "onClick"));
                    ScopedValue callback(ctx, JS_GetPropertyStr(ctx, binding.get(), "callback"));
                    if (JS_IsFunction(ctx, callback.get())) {
                        owner.impl_->replaceEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click), callback.get());
                        hasClickCallback = true;
                    }
                }
                else if (type == "verticalScroll" || type == "horizontalScroll") {
                    ScopedValue state(ctx, JS_GetPropertyStr(ctx, element.get(), "state"));
                    ScopedValue binding(ctx, JS_GetPropertyStr(ctx, state.get(), "__arrangeNativeScroll"));
                    ScopedValue callback(ctx, JS_GetPropertyStr(ctx, binding.get(), "callback"));
                    const auto kind = type == "verticalScroll" ? arrange::core::EventSlotKind::VerticalScroll : arrange::core::EventSlotKind::HorizontalScroll;
                    if (JS_IsFunction(ctx, callback.get())) {
                        owner.impl_->replaceEventSlot(arrange::core::makeEventSlotId(id, kind), callback.get());
                        if (kind == arrange::core::EventSlotKind::VerticalScroll) hasVerticalScrollCallback = true;
                        else hasHorizontalScrollCallback = true;
                    }
                }
            }

            if (!hasClickCallback) owner.impl_->releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click));
            if (!hasVerticalScrollCallback) owner.impl_->releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::VerticalScroll));
            if (!hasHorizontalScrollCallback) owner.impl_->releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::HorizontalScroll));
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
                if (rootNodeId == 0) rootNodeId = parsedId;
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
                const auto slotKind = propEventSlotKind(bridgeOp.key);
                const auto eventSlot = slotKind == arrange::core::EventSlotKind::None ? arrange::core::EventSlotId{} : arrange::core::makeEventSlotId(parsedId, slotKind);
                ScopedValue eventCallback(ctx, eventSlot.valid() ? eventSlotCallbackValue(ctx, value.get()) : JS_UNDEFINED);
                bridgeOp.value = eventSlot.valid() && JS_IsFunction(ctx, eventCallback.get())
                    ? encodeBridgePropValue(ctx, bridgeOp.key, eventCallback.get())
                    : encodeBridgePropValue(ctx, bridgeOp.key, value.get());
                if (eventSlot.valid()) {
                    arrange::core::BridgeOp slotProp;
                    slotProp.opcode = arrange::core::BridgeOpcode::SetProp;
                    slotProp.id = parsedId;
                    slotProp.key = eventSlotPropKey(bridgeOp.key);
                    owner.impl_->replaceEventSlot(eventSlot, eventCallback.get());
                    slotProp.value = encodeNativeEventSlotPropValue(ctx, eventCallback.get(), eventSlot);
                    batch.ops.push_back(std::move(slotProp));
                }
            }
            else if (op == "setModifier") {
                ScopedValue id(ctx, JS_GetPropertyStr(ctx, item, "id"));
                ScopedValue modifier(ctx, JS_GetPropertyStr(ctx, item, "modifier"));
                std::uint32_t parsedId = 0;
                JS_ToUint32(ctx, &parsedId, id.get());
                bridgeOp.opcode = arrange::core::BridgeOpcode::SetModifier;
                bridgeOp.id = parsedId;
                registerStandardModifierEventSlots(owner, ctx, parsedId, modifier.get());
                bridgeOp.modifierPayload = JS_IsArray(modifier.get())
                    ? std::string("o:") + serializeJsValue(ctx, modifier.get())
                    : std::string{};
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
                if (opName == "mount") continue;
                (void)appendBridgeOp(owner, ctx, item.get(), incrementalBatch);
                continue;
            }

            if (!incrementalBatch.ops.empty()) {
                owner.pendingTransactions_.push(
                    arrange::core::MutationTransaction::fromBridgeBatch(std::move(incrementalBatch)));
            }
        }
    };

    QuickJsScriptHost::QuickJsScriptHost() : impl_(std::make_unique<Impl>()) {}
    QuickJsScriptHost::~QuickJsScriptHost() = default;

        std::size_t QuickJsScriptHost::eventSlotCount() const noexcept { return impl_ ? impl_->eventSlots.size() : 0; }
    void QuickJsScriptHost::flushRetiredEventSlots() {
        if (impl_) impl_->flushRetiredEventSlots();
    }

    std::optional<arrange::core::MutationTransaction> QuickJsScriptHost::takePendingTransaction() noexcept {
        return pendingTransactions_.take();
    }

    void QuickJsScriptHost::clearPendingTransactions() noexcept {
        pendingTransactions_.clear();
    }

    void QuickJsScriptHost::setFrameTimeMillis(double nowMillis) noexcept {
        if (!impl_) return;
        impl_->frameTimeMillis = std::max(0.0, nowMillis);
    }

    bool QuickJsScriptHost::hasPendingAnimationFrame() const noexcept { return impl_ && !impl_->animationFrameCallbacks.empty(); }

    CallbackInvokeResult QuickJsScriptHost::pumpAnimationFrame(double nowMillis) {
        if (impl_->context == nullptr) return {false, "QuickJS runtime is not initialised"};
        setFrameTimeMillis(nowMillis);
        pendingTransactions_.clear();

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
        pendingTransactions_.clear();
        reloadRequested_ = false;
        reloadPayloadJson_.clear();
        const auto normalizedModulePath = std::filesystem::absolute(modulePath).lexically_normal();
        impl_->initialise(this, normalizedModulePath);

        ScopedValue result(impl_->context, JS_Eval(impl_->context, source.data(), source.size(), normalizedModulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE));
        if (JS_IsException(result.get())) { return {false, exceptionText(impl_->context)}; }

        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};

        const auto& pending = pendingTransactions_.pending();
        if (!pending || !pending->hasTreeMutations()) return {false, "Arrange app did not mount. Expected createApp(App).mount() to commit bridge mutations."};
        return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::invokeEventSlot(const arrange::core::EventSlotId& slot, const CallbackInvokeOptions& options) {
        if (impl_->context == nullptr) return {false, "QuickJS runtime is not initialised"};
        if (!slot.valid()) return {false, "Arrange event slot is invalid"};
        const auto it = impl_->eventSlots.find(slot.toString());
        if (it == impl_->eventSlots.end()) return {false, "Arrange event slot is not registered in QuickJS"};
        ScopedValue callback(impl_->context, JS_DupValue(impl_->context, it->second));
        pendingTransactions_.clear();

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
