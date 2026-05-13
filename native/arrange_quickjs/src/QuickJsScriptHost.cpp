
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
            JSValue release() noexcept { auto value = value_; value_ = JS_UNDEFINED; return value; }
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

        std::uint32_t toU32(JSContext* ctx, JSValueConst value) { std::uint32_t result = 0; JS_ToUint32(ctx, &result, value); return result; }
        double toDouble(JSContext* ctx, JSValueConst value, double fallback = 0.0) { double result = fallback; JS_ToFloat64(ctx, &result, value); return result; }
        bool toBool(JSContext* ctx, JSValueConst value, bool fallback = false) { return JS_IsUndefined(value) || JS_IsNull(value) ? fallback : JS_ToBool(ctx, value) != 0; }
        std::uint32_t arrayLength(JSContext* ctx, JSValueConst value) { ScopedValue length(ctx, JS_GetPropertyStr(ctx, value, "length")); return toU32(ctx, length.get()); }
        bool startsWithDotSpecifier(std::string_view specifier) { return specifier == "." || specifier == ".." || specifier.starts_with("./") || specifier.starts_with("../"); }

        std::string exceptionText(JSContext* ctx) {
            ScopedValue exception(ctx, JS_GetException(ctx));
            std::string result = toString(ctx, exception.get());
            ScopedValue stack(ctx, JS_GetPropertyStr(ctx, exception.get(), "stack"));
            if (!JS_IsUndefined(stack.get())) {
                const auto stackText = toString(ctx, stack.get());
                if (!stackText.empty()) result += "\n" + stackText;
            }
            return result.empty() ? "QuickJS exception" : result;
        }

        arrange::core::PropValue readPropValue(JSContext* ctx, JSValueConst value, int depth = 0) {
            if (depth > 8 || JS_IsUndefined(value) || JS_IsNull(value) || JS_IsFunction(ctx, value)) return arrange::core::PropValue::nullValue();
            if (JS_IsBool(value)) return arrange::core::PropValue::booleanValue(JS_ToBool(ctx, value) != 0);
            if (JS_IsNumber(value)) return arrange::core::PropValue::numberValue(toDouble(ctx, value));
            if (JS_IsString(value)) return arrange::core::PropValue::stringValue(toString(ctx, value));
            if (!JS_IsObject(value) || JS_IsArray(value)) return arrange::core::PropValue::nullValue();
            JSPropertyEnum* props = nullptr;
            std::uint32_t count = 0;
            std::vector<arrange::core::PropObjectField> fields;
            if (JS_GetOwnPropertyNames(ctx, &props, &count, value, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) return arrange::core::PropValue::nullValue();
            fields.reserve(count);
            for (std::uint32_t i = 0; i < count; ++i) {
                const char* name = JS_AtomToCString(ctx, props[i].atom);
                if (name == nullptr) continue;
                ScopedValue child(ctx, JS_GetProperty(ctx, value, props[i].atom));
                fields.push_back({name, readPropValue(ctx, child.get(), depth + 1)});
                JS_FreeCString(ctx, name);
            }
            for (std::uint32_t i = 0; i < count; ++i) JS_FreeAtom(ctx, props[i].atom);
            js_free(ctx, props);
            return arrange::core::PropValue::objectValue(std::move(fields));
        }

        float numberField(JSContext* ctx, JSValueConst object, const char* key, float fallback = 0.0f) { ScopedValue value(ctx, JS_GetPropertyStr(ctx, object, key)); return JS_IsUndefined(value.get()) || JS_IsNull(value.get()) ? fallback : static_cast<float>(toDouble(ctx, value.get(), fallback)); }
        bool boolField(JSContext* ctx, JSValueConst object, const char* key, bool fallback = false) { ScopedValue value(ctx, JS_GetPropertyStr(ctx, object, key)); return toBool(ctx, value.get(), fallback); }
        std::string stringField(JSContext* ctx, JSValueConst object, const char* key, std::string_view fallback = {}) { ScopedValue value(ctx, JS_GetPropertyStr(ctx, object, key)); return JS_IsUndefined(value.get()) || JS_IsNull(value.get()) ? std::string(fallback) : toString(ctx, value.get()); }
        std::uint32_t colorField(JSContext* ctx, JSValueConst object, const char* key, std::uint32_t fallback = 0) { ScopedValue value(ctx, JS_GetPropertyStr(ctx, object, key)); return JS_IsUndefined(value.get()) || JS_IsNull(value.get()) ? fallback : toU32(ctx, value.get()); }

        std::uint32_t colorOrBrush(JSContext* ctx, JSValueConst object, const char* colorKey, const char* brushKey) {
            const auto color = colorField(ctx, object, colorKey, 0);
            if (color != 0) return color;
            ScopedValue brush(ctx, JS_GetPropertyStr(ctx, object, brushKey));
            if (JS_IsNumber(brush.get())) return toU32(ctx, brush.get());
            if (JS_IsObject(brush.get())) return colorField(ctx, brush.get(), "color", 0);
            return 0;
        }

        arrange::core::ModifierPadding readPadding(JSContext* ctx, JSValueConst value) {
            return {std::max(0.0f, numberField(ctx, value, "start")), std::max(0.0f, numberField(ctx, value, "top")), std::max(0.0f, numberField(ctx, value, "end")), std::max(0.0f, numberField(ctx, value, "bottom"))};
        }

        std::pair<float, float> transformOriginFrom(JSContext* ctx, JSValueConst value) {
            const auto name = stringField(ctx, value, "transformOrigin");
            if (name == "TopStart") return {0.0f, 0.0f};
            if (name == "TopCenter") return {0.5f, 0.0f};
            if (name == "TopEnd") return {1.0f, 0.0f};
            if (name == "CenterStart") return {0.0f, 0.5f};
            if (name == "CenterEnd") return {1.0f, 0.5f};
            if (name == "BottomStart") return {0.0f, 1.0f};
            if (name == "BottomCenter") return {0.5f, 1.0f};
            if (name == "BottomEnd") return {1.0f, 1.0f};
            ScopedValue origin(ctx, JS_GetPropertyStr(ctx, value, "transformOrigin"));
            if (JS_IsObject(origin.get())) return {std::clamp(numberField(ctx, origin.get(), "x", 0.5f), 0.0f, 1.0f), std::clamp(numberField(ctx, origin.get(), "y", 0.5f), 0.0f, 1.0f)};
            return {0.5f, 0.5f};
        }

        arrange::core::PaintStyleSemantics paintStyle(JSContext* ctx, JSValueConst value, arrange::core::PaintStyleKind kind) {
            arrange::core::PaintStyleSemantics style;
            style.kind = kind;
            style.color = colorOrBrush(ctx, value, "color", "brush");
            style.brush = style.color;
            style.strokeWidth = std::max(1.0f, numberField(ctx, value, "width", 1.0f));
            ScopedValue shape(ctx, JS_GetPropertyStr(ctx, value, "shape"));
            if (JS_IsObject(shape.get())) {
                style.shapeType = stringField(ctx, shape.get(), "type");
                style.cornerRadius = style.shapeType == "rounded" ? std::max(0.0f, numberField(ctx, shape.get(), "radius")) : 0.0f;
            }
            style.alpha = std::clamp(numberField(ctx, value, "value", 1.0f), 0.0f, 1.0f);
            ScopedValue offset(ctx, JS_GetPropertyStr(ctx, value, "offset"));
            style.shadowOffset = {numberField(ctx, value, "offsetX", JS_IsObject(offset.get()) ? numberField(ctx, offset.get(), "x") : 0.0f), numberField(ctx, value, "offsetY", JS_IsObject(offset.get()) ? numberField(ctx, offset.get(), "y") : 0.0f)};
            return style;
        }

        arrange::core::EventSlotKind propEventSlotKind(std::string_view key) noexcept {
            if (key == "onUpdate:modelValue" || key == "onUpdate:model-value") return arrange::core::EventSlotKind::InputUpdate;
            if (key == "onSubmit") return arrange::core::EventSlotKind::InputSubmit;
            if (key == "onChange") return arrange::core::EventSlotKind::InputChange;
            if (key == "onBlur") return arrange::core::EventSlotKind::InputBlur;
            return arrange::core::EventSlotKind::None;
        }

        struct DrainJobsResult { bool ok = true; std::string error; };
    } // namespace
    struct QuickJsScriptHost::Impl {
        JSRuntime* runtime = nullptr;
        JSContext* context = nullptr;
        arrange::core::NodeId rootNodeId = 0;
        std::uint32_t nextAnimationFrameHandle = 1;
        double frameTimeMillis = 0.0;
        QuickJsScriptHost* owner = nullptr;
        std::unordered_map<arrange::core::EventSlotId, JSValue, arrange::core::EventSlotIdHash> eventSlots;
        std::unordered_set<arrange::core::EventSlotId, arrange::core::EventSlotIdHash> retiredEventSlots;
        std::unordered_map<std::uint32_t, JSValue> animationFrameCallbacks;
        std::unordered_map<arrange::core::NodeId, std::vector<arrange::core::NodeId>> childrenByNode;
        std::unordered_map<arrange::core::NodeId, arrange::core::NodeId> parentByNode;
        std::filesystem::path moduleRoot;

        ~Impl() { reset(); }

        static std::vector<arrange::core::EventSlotId> builtinEventSlotsForNode(arrange::core::NodeId id) {
            return {arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click), arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::VerticalScroll), arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::HorizontalScroll), arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputUpdate), arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputSubmit), arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputChange), arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::InputBlur)};
        }

        void reset() {
            if (context != nullptr) {
                for (auto& [_, callback] : eventSlots) JS_FreeValue(context, callback);
                for (auto& [_, callback] : animationFrameCallbacks) JS_FreeValue(context, callback);
            }
            eventSlots.clear(); retiredEventSlots.clear(); animationFrameCallbacks.clear(); childrenByNode.clear(); parentByNode.clear();
            if (context != nullptr) { JS_FreeContext(context); context = nullptr; }
            if (runtime != nullptr) { JS_FreeRuntime(runtime); runtime = nullptr; }
            rootNodeId = 0; nextAnimationFrameHandle = 1; frameTimeMillis = 0.0; owner = nullptr; moduleRoot.clear();
        }

        void initialise(QuickJsScriptHost* owner, const std::filesystem::path& entryPath) {
            reset(); this->owner = owner; moduleRoot = std::filesystem::absolute(entryPath).lexically_normal().parent_path();
            runtime = JS_NewRuntime(); JS_SetModuleLoaderFunc(runtime, &Impl::normalizeModuleName, &Impl::loadModule, owner); context = JS_NewContext(runtime); JS_SetContextOpaque(context, owner);
            ScopedValue global(context, JS_GetGlobalObject(context)); ScopedValue native(context, JS_NewObject(context));
            JS_SetPropertyStr(context, native.get(), "beginTransaction", JS_NewCFunction(context, &Impl::nativeBeginTransaction, "beginTransaction", 0));
            JS_SetPropertyStr(context, native.get(), "endTransaction", JS_NewCFunction(context, &Impl::nativeEndTransaction, "endTransaction", 0));
            JS_SetPropertyStr(context, native.get(), "createNode", JS_NewCFunction(context, &Impl::nativeCreateNode, "createNode", 2));
            JS_SetPropertyStr(context, native.get(), "deleteNode", JS_NewCFunction(context, &Impl::nativeDeleteNode, "deleteNode", 1));
            JS_SetPropertyStr(context, native.get(), "insertChild", JS_NewCFunction(context, &Impl::nativeInsertChild, "insertChild", 3));
            JS_SetPropertyStr(context, native.get(), "removeChild", JS_NewCFunction(context, &Impl::nativeRemoveChild, "removeChild", 2));
            JS_SetPropertyStr(context, native.get(), "setText", JS_NewCFunction(context, &Impl::nativeSetText, "setText", 2));
            JS_SetPropertyStr(context, native.get(), "setProp", JS_NewCFunction(context, &Impl::nativeSetProp, "setProp", 3));
            JS_SetPropertyStr(context, native.get(), "setModifier", JS_NewCFunction(context, &Impl::nativeSetModifier, "setModifier", 2));
            JS_SetPropertyStr(context, native.get(), "invalidate", JS_NewCFunction(context, &Impl::nativeInvalidate, "invalidate", 3));
            JS_SetPropertyStr(context, native.get(), "unmount", JS_NewCFunction(context, &Impl::nativeUnmount, "unmount", 0));
            JS_SetPropertyStr(context, native.get(), "reload", JS_NewCFunction(context, &Impl::nativeReload, "reload", 1));
            JS_SetPropertyStr(context, native.get(), "runtimeVersion", JS_NewUint32(context, arrange::core::RuntimeVersion));
            JS_SetPropertyStr(context, global.get(), "__ARRANGE_NATIVE__", native.release());
            JS_SetPropertyStr(context, global.get(), "requestAnimationFrame", JS_NewCFunction(context, &Impl::requestAnimationFrame, "requestAnimationFrame", 1));
            JS_SetPropertyStr(context, global.get(), "cancelAnimationFrame", JS_NewCFunction(context, &Impl::cancelAnimationFrame, "cancelAnimationFrame", 1));
            ScopedValue performance(context, JS_NewObject(context)); JS_SetPropertyStr(context, performance.get(), "now", JS_NewCFunction(context, &Impl::performanceNow, "now", 0)); JS_SetPropertyStr(context, global.get(), "performance", performance.release());
        }

        DrainJobsResult drainJobs() { JSContext* jobContext = nullptr; int jobResult = 0; while ((jobResult = JS_ExecutePendingJob(runtime, &jobContext)) > 0) {} if (jobResult < 0) return {false, exceptionText(jobContext != nullptr ? jobContext : context)}; return {}; }
        arrange::core::MutationTransaction* currentTransaction() noexcept { return owner == nullptr ? nullptr : &owner->pendingTransactions_.ensurePending(); }
        void push(arrange::core::TreeMutation mutation) { if (auto* transaction = currentTransaction()) transaction->treeMutations.push_back(std::move(mutation)); }

        void attachChild(arrange::core::NodeId parent, arrange::core::NodeId child, std::uint32_t index) {
            if (parent == 0 || child == 0) return;
            if (const auto oldParent = parentByNode.find(child); oldParent != parentByNode.end()) detachChild(oldParent->second, child);
            auto& children = childrenByNode[parent]; children.erase(std::remove(children.begin(), children.end(), child), children.end());
            const auto insertIndex = std::min<std::size_t>(index, children.size()); children.insert(children.begin() + static_cast<std::ptrdiff_t>(insertIndex), child); parentByNode[child] = parent;
        }
        void detachChild(arrange::core::NodeId parent, arrange::core::NodeId child) {
            if (const auto childrenIt = childrenByNode.find(parent); childrenIt != childrenByNode.end()) { auto& children = childrenIt->second; children.erase(std::remove(children.begin(), children.end(), child), children.end()); if (children.empty()) childrenByNode.erase(childrenIt); }
            if (const auto parentIt = parentByNode.find(child); parentIt != parentByNode.end() && parentIt->second == parent) parentByNode.erase(parentIt);
        }
        void releaseEventSlot(const arrange::core::EventSlotId& slot) { if (context == nullptr || !slot.valid()) return; if (auto* transaction = currentTransaction()) { transaction->retiredEventSlots.push_back(slot); transaction->treeMutations.push_back(arrange::core::ClearEventSlotMutation{slot.node, slot.kind}); } retiredEventSlots.insert(slot); }
        void replaceEventSlot(const arrange::core::EventSlotId& slot, JSValueConst callback) {
            if (context == nullptr || !slot.valid()) return;
            if (const auto old = eventSlots.find(slot); old != eventSlots.end()) { JS_FreeValue(context, old->second); eventSlots.erase(old); }
            if (!JS_IsFunction(context, callback)) { releaseEventSlot(slot); return; }
            retiredEventSlots.erase(slot); eventSlots.emplace(slot, JS_DupValue(context, callback)); if (auto* transaction = currentTransaction()) { transaction->eventSlotUpdates.push_back(slot); transaction->treeMutations.push_back(arrange::core::SetEventSlotMutation{slot.node, slot.kind, slot}); }
        }
        void releaseNodeCallbacksRecursive(arrange::core::NodeId id) { if (const auto it = childrenByNode.find(id); it != childrenByNode.end()) { const auto children = it->second; for (const auto child : children) releaseNodeCallbacksRecursive(child); } for (const auto& slot : builtinEventSlotsForNode(id)) releaseEventSlot(slot); if (const auto it = parentByNode.find(id); it != parentByNode.end()) detachChild(it->second, id); childrenByNode.erase(id); parentByNode.erase(id); }
        void releaseAllEventSlots() { if (auto* transaction = currentTransaction()) { for (const auto& [slot, _] : eventSlots) { if (slot.valid()) { transaction->retiredEventSlots.push_back(slot); transaction->treeMutations.push_back(arrange::core::ClearEventSlotMutation{slot.node, slot.kind}); } } } for (const auto& [slot, _] : eventSlots) retiredEventSlots.insert(slot); childrenByNode.clear(); parentByNode.clear(); rootNodeId = 0; }
        void flushRetiredEventSlots() { if (context == nullptr) { retiredEventSlots.clear(); return; } for (const auto& slot : retiredEventSlots) { const auto it = eventSlots.find(slot); if (it == eventSlots.end()) continue; JS_FreeValue(context, it->second); eventSlots.erase(it); } retiredEventSlots.clear(); }
        arrange::core::CompiledModifier readModifier(arrange::core::NodeId id, JSValueConst modifier) {
            arrange::core::CompiledModifier result; ScopedValue elements(context, JS_GetPropertyStr(context, modifier, "elements")); JSValueConst array = JS_IsArray(elements.get()) ? elements.get() : modifier; if (!JS_IsArray(array)) return result;
            const auto length = arrayLength(context, array); bool hasClick = false; bool hasVerticalScroll = false; bool hasHorizontalScroll = false;
            for (std::uint32_t i = 0; i < length; ++i) {
                ScopedValue element(context, JS_GetPropertyUint32(context, array, i)); const auto type = stringField(context, element.get(), "type"); ScopedValue value(context, JS_GetPropertyStr(context, element.get(), "value")); JSValueConst payload = JS_IsObject(value.get()) ? value.get() : element.get();
                if (type == "padding") { arrange::core::LayoutModifierSemantics item; item.kind = arrange::core::LayoutModifierKind::Padding; item.padding = readPadding(context, payload); result.layout.push_back(item); result.paintContentPadding.push_back(item.padding); result.paint.chain.push_back({arrange::core::PaintChainOpKind::ContentPadding, paintStyle(context, payload, arrange::core::PaintStyleKind::Background), item.padding}); }
                else if (type == "width" || type == "height" || type == "requiredWidth" || type == "requiredHeight") { arrange::core::LayoutModifierSemantics item; if (type == "width") item.kind = arrange::core::LayoutModifierKind::Width; else if (type == "height") item.kind = arrange::core::LayoutModifierKind::Height; else if (type == "requiredWidth") item.kind = arrange::core::LayoutModifierKind::RequiredWidth; else item.kind = arrange::core::LayoutModifierKind::RequiredHeight; item.value = numberField(context, payload, type == "requiredWidth" ? "width" : type == "requiredHeight" ? "height" : "value"); result.layout.push_back(item); }
                else if (type == "size" || type == "requiredSize") { arrange::core::LayoutModifierSemantics item; item.kind = type == "size" ? arrange::core::LayoutModifierKind::Size : arrange::core::LayoutModifierKind::RequiredSize; item.width = numberField(context, payload, "width"); item.height = numberField(context, payload, "height"); result.layout.push_back(item); }
                else if (type == "fillMaxWidth" || type == "fillMaxHeight" || type == "fillMaxSize") { arrange::core::LayoutModifierSemantics item; if (type == "fillMaxWidth") item.kind = arrange::core::LayoutModifierKind::FillMaxWidth; else if (type == "fillMaxHeight") item.kind = arrange::core::LayoutModifierKind::FillMaxHeight; else item.kind = arrange::core::LayoutModifierKind::FillMaxSize; item.fraction = numberField(context, payload, "fraction", 1.0f); result.layout.push_back(item); }
                else if (type == "widthIn" || type == "heightIn" || type == "sizeIn") { arrange::core::LayoutModifierSemantics item; if (type == "widthIn") item.kind = arrange::core::LayoutModifierKind::WidthIn; else if (type == "heightIn") item.kind = arrange::core::LayoutModifierKind::HeightIn; else item.kind = arrange::core::LayoutModifierKind::SizeIn; item.minWidth = numberField(context, payload, "min", numberField(context, payload, "minWidth", -1.0f)); item.maxWidth = numberField(context, payload, "max", numberField(context, payload, "maxWidth", -1.0f)); item.minHeight = numberField(context, payload, "min", numberField(context, payload, "minHeight", -1.0f)); item.maxHeight = numberField(context, payload, "max", numberField(context, payload, "maxHeight", -1.0f)); result.layout.push_back(item); }
                else if (type == "defaultMinSize") { arrange::core::LayoutModifierSemantics item; item.kind = arrange::core::LayoutModifierKind::DefaultMinSize; item.minWidth = numberField(context, payload, "minWidth"); item.minHeight = numberField(context, payload, "minHeight"); result.layout.push_back(item); }
                else if (type == "verticalScroll" || type == "horizontalScroll") { arrange::core::LayoutModifierSemantics item; item.kind = type == "verticalScroll" ? arrange::core::LayoutModifierKind::VerticalScroll : arrange::core::LayoutModifierKind::HorizontalScroll; ScopedValue state(context, JS_GetPropertyStr(context, payload, "state")); item.scrollValue = std::max(0.0f, JS_IsObject(state.get()) ? numberField(context, state.get(), "value") : numberField(context, payload, "value")); result.layout.push_back(item); const auto kind = type == "verticalScroll" ? arrange::core::EventSlotKind::VerticalScroll : arrange::core::EventSlotKind::HorizontalScroll; const auto slot = arrange::core::makeEventSlotId(id, kind); if (type == "verticalScroll") { result.scroll.vertical = boolField(context, payload, "enabled", true); result.scroll.verticalValue = item.scrollValue; result.scroll.verticalEventSlot = slot; hasVerticalScroll = true; } else { result.scroll.horizontal = boolField(context, payload, "enabled", true); result.scroll.horizontalValue = item.scrollValue; result.scroll.horizontalEventSlot = slot; hasHorizontalScroll = true; } if (JS_IsObject(state.get())) { ScopedValue callback(context, JS_GetPropertyStr(context, state.get(), "__arrangeNativeScroll")); replaceEventSlot(slot, callback.get()); } result.paint.chain.push_back({arrange::core::PaintChainOpKind::Clip, paintStyle(context, payload, arrange::core::PaintStyleKind::Background), {}}); result.paint.clips.push_back(paintStyle(context, payload, arrange::core::PaintStyleKind::Background)); }
                else if (type == "weight") { result.parentData.weight = std::max(0.0f, numberField(context, payload, "weight")); result.parentData.weightFill = boolField(context, payload, "fill", true); }
                else if (type == "align") result.parentData.align = stringField(context, payload, "alignment");
                else if (type == "offset" || type == "absoluteOffset") { result.transform.layoutOffsetX += numberField(context, payload, "x"); result.transform.layoutOffsetY += numberField(context, payload, "y"); }
                else if (type == "graphicsLayer") { result.transform.translationX += numberField(context, payload, "translationX"); result.transform.translationY += numberField(context, payload, "translationY"); result.transform.layoutOffsetX += numberField(context, payload, "translationX"); result.transform.layoutOffsetY += numberField(context, payload, "translationY"); result.transform.scaleX = numberField(context, payload, "scaleX", 1.0f); result.transform.scaleY = numberField(context, payload, "scaleY", 1.0f); result.transform.rotationZ = numberField(context, payload, "rotationZ"); const auto origin = transformOriginFrom(context, payload); result.transform.transformOriginX = origin.first; result.transform.transformOriginY = origin.second; result.transform.hasPaintTransform = std::fabs(result.transform.scaleX - 1.0f) > 0.0001f || std::fabs(result.transform.scaleY - 1.0f) > 0.0001f || std::fabs(result.transform.rotationZ) > 0.0001f; }
                else if (type == "zIndex") result.zIndex = numberField(context, payload, "value");
                else if (type == "background" || type == "border" || type == "alpha" || type == "dropShadow" || type == "innerShadow") { auto kind = arrange::core::PaintStyleKind::Background; if (type == "border") kind = arrange::core::PaintStyleKind::Border; else if (type == "alpha") kind = arrange::core::PaintStyleKind::Alpha; else if (type == "dropShadow") kind = arrange::core::PaintStyleKind::DropShadow; else if (type == "innerShadow") kind = arrange::core::PaintStyleKind::InnerShadow; const auto style = paintStyle(context, payload, kind); result.paint.chain.push_back({arrange::core::PaintChainOpKind::Style, style, {}}); result.paint.styles.push_back(style); }
                else if (type == "clip") { const auto style = paintStyle(context, payload, arrange::core::PaintStyleKind::Background); result.paint.chain.push_back({arrange::core::PaintChainOpKind::Clip, style, {}}); result.paint.clips.push_back(style); }
                else if (type == "clickable") { result.input.clickable = boolField(context, payload, "enabled", true); result.input.focusable = boolField(context, payload, "focusable", true); result.input.clickEventSlot = arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click); ScopedValue callback(context, JS_GetPropertyStr(context, payload, "onClick")); replaceEventSlot(result.input.clickEventSlot, callback.get()); hasClick = JS_IsFunction(context, callback.get()); }
                else if (type == "hoverable") result.input.hoverable = boolField(context, payload, "enabled", true);
                else if (type == "focusable") result.input.focusable = boolField(context, payload, "enabled", true);
                else if (type == "pointerInput") result.input.pointerInput = true;
            }
            if (!hasClick) releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click)); if (!hasVerticalScroll) releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::VerticalScroll)); if (!hasHorizontalScroll) releaseEventSlot(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::HorizontalScroll));
            return result;
        }

        void readReloadRequest(QuickJsScriptHost& owner, JSContext* ctx, JSValueConst payload) { owner.reloadRequest_ = {}; if (!JS_IsObject(payload)) return; ScopedValue path(ctx, JS_GetPropertyStr(ctx, payload, "path")); if (JS_IsString(path.get())) owner.reloadRequest_.path = toString(ctx, path.get()); ScopedValue timestamp(ctx, JS_GetPropertyStr(ctx, payload, "timestamp")); if (JS_IsNumber(timestamp.get())) owner.reloadRequest_.timestamp = toDouble(ctx, timestamp.get()); }
        static JSValue performanceNow(JSContext* ctx, JSValueConst, int, JSValueConst*) { auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx)); return JS_NewFloat64(ctx, owner == nullptr || owner->impl_ == nullptr ? 0.0 : owner->impl_->frameTimeMillis); }
        static JSValue requestAnimationFrame(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx)); if (owner == nullptr || owner->impl_ == nullptr) return JS_NewUint32(ctx, 0); if (argc < 1 || !JS_IsFunction(ctx, argv[0])) return JS_ThrowTypeError(ctx, "requestAnimationFrame expects a callback"); const auto handle = owner->impl_->nextAnimationFrameHandle++; owner->impl_->animationFrameCallbacks.emplace(handle, JS_DupValue(ctx, argv[0])); return JS_NewUint32(ctx, handle); }
        static JSValue cancelAnimationFrame(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx)); if (owner == nullptr || owner->impl_ == nullptr || argc < 1) return JS_UNDEFINED; const auto handle = toU32(ctx, argv[0]); if (const auto it = owner->impl_->animationFrameCallbacks.find(handle); it != owner->impl_->animationFrameCallbacks.end()) { JS_FreeValue(ctx, it->second); owner->impl_->animationFrameCallbacks.erase(it); } return JS_UNDEFINED; }
        static char* normalizeModuleName(JSContext* ctx, const char* moduleBaseName, const char* moduleName, void* opaque) { auto* owner = static_cast<QuickJsScriptHost*>(opaque); if (owner == nullptr || moduleName == nullptr) return nullptr; const std::string_view specifier(moduleName); std::filesystem::path resolved; if (std::filesystem::path(moduleName).is_absolute()) resolved = moduleName; else if (startsWithDotSpecifier(specifier)) { const std::filesystem::path base = moduleBaseName != nullptr && *moduleBaseName != '\0' ? std::filesystem::path(moduleBaseName).parent_path() : owner->impl_->moduleRoot; resolved = base / moduleName; } else { JS_ThrowReferenceError(ctx, "unsupported bare module specifier '%s' in Arrange UI package", moduleName); return nullptr; } const auto normalized = std::filesystem::absolute(resolved).lexically_normal().generic_string(); return js_strdup(ctx, normalized.c_str()); }
        static JSModuleDef* loadModule(JSContext* ctx, const char* moduleName, void*) { const std::filesystem::path modulePath = std::filesystem::path(moduleName).lexically_normal(); std::ifstream stream(modulePath, std::ios::binary); if (!stream) { JS_ThrowReferenceError(ctx, "could not load Arrange UI module '%s'", moduleName); return nullptr; } const std::string source((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>()); ScopedValue compiled(ctx, JS_Eval(ctx, source.data(), source.size(), modulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY)); if (JS_IsException(compiled.get())) return nullptr; return static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled.get())); }
        static Impl* impl(JSContext* ctx) { auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx)); return owner == nullptr ? nullptr : owner->impl_.get(); }
        static JSValue nativeBeginTransaction(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }
        static JSValue nativeEndTransaction(JSContext*, JSValueConst, int, JSValueConst*) { return JS_UNDEFINED; }
        static JSValue nativeCreateNode(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 2) return JS_UNDEFINED; const auto id = toU32(ctx, argv[0]); if (self->rootNodeId == 0) self->rootNodeId = id; self->push(arrange::core::CreateNodeMutation{id, arrange::core::nodeTypeFromName(toString(ctx, argv[1]))}); return JS_UNDEFINED; }
        static JSValue nativeDeleteNode(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 1) return JS_UNDEFINED; const auto id = toU32(ctx, argv[0]); self->releaseNodeCallbacksRecursive(id); self->push(arrange::core::DeleteNodeMutation{id}); return JS_UNDEFINED; }
        static JSValue nativeInsertChild(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 3) return JS_UNDEFINED; const auto parent = toU32(ctx, argv[0]); const auto child = toU32(ctx, argv[1]); const auto index = toU32(ctx, argv[2]); self->attachChild(parent, child, index); self->push(arrange::core::InsertChildMutation{parent, child, index}); return JS_UNDEFINED; }
        static JSValue nativeRemoveChild(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 2) return JS_UNDEFINED; const auto parent = toU32(ctx, argv[0]); const auto child = toU32(ctx, argv[1]); self->detachChild(parent, child); self->push(arrange::core::RemoveChildMutation{parent, child}); return JS_UNDEFINED; }
        static JSValue nativeSetText(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 2) return JS_UNDEFINED; self->push(arrange::core::SetTextMutation{toU32(ctx, argv[0]), toString(ctx, argv[1])}); return JS_UNDEFINED; }
        static JSValue nativeSetProp(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 3) return JS_UNDEFINED; const auto id = toU32(ctx, argv[0]); const auto key = toString(ctx, argv[1]); const auto slotKind = propEventSlotKind(key); if (slotKind != arrange::core::EventSlotKind::None) { self->replaceEventSlot(arrange::core::makeEventSlotId(id, slotKind), argv[2]); return JS_UNDEFINED; } self->push(arrange::core::SetPropMutation{id, key, readPropValue(ctx, argv[2])}); return JS_UNDEFINED; }
        static JSValue nativeSetModifier(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 2) return JS_UNDEFINED; const auto id = toU32(ctx, argv[0]); self->push(arrange::core::SetModifierMutation{id, self->readModifier(id, argv[1])}); return JS_UNDEFINED; }
        static JSValue nativeInvalidate(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* self = impl(ctx); if (self == nullptr || argc < 2) return JS_UNDEFINED; const auto flagName = toString(ctx, argv[1]); auto flag = arrange::core::DirtyFlag::EventSlot; if (flagName == "paint") flag = arrange::core::DirtyFlag::Paint; else if (flagName == "layout") flag = arrange::core::DirtyFlag::Layout; else if (flagName == "structure") flag = arrange::core::DirtyFlag::Structure; else if (flagName == "hitTest") flag = arrange::core::DirtyFlag::HitTest; self->push(arrange::core::NativeInvalidationMutation{toU32(ctx, argv[0]), flag, flagName, argc > 2 ? toString(ctx, argv[2]) : flagName}); return JS_UNDEFINED; }
        static JSValue nativeUnmount(JSContext* ctx, JSValueConst, int, JSValueConst*) { auto* self = impl(ctx); if (self == nullptr) return JS_UNDEFINED; if (self->rootNodeId != 0) self->push(arrange::core::DeleteNodeMutation{self->rootNodeId}); self->releaseAllEventSlots(); return JS_UNDEFINED; }
        static JSValue nativeReload(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) { auto* owner = static_cast<QuickJsScriptHost*>(JS_GetContextOpaque(ctx)); if (owner == nullptr || owner->impl_ == nullptr) return JS_UNDEFINED; owner->reloadRequested_ = true; owner->impl_->readReloadRequest(*owner, ctx, argc > 0 ? argv[0] : JS_UNDEFINED); return JS_UNDEFINED; }
    };
    QuickJsScriptHost::QuickJsScriptHost() : impl_(std::make_unique<Impl>()) {}
    QuickJsScriptHost::~QuickJsScriptHost() = default;

    std::size_t QuickJsScriptHost::eventSlotCount() const noexcept { return impl_ ? impl_->eventSlots.size() : 0; }
    void QuickJsScriptHost::flushRetiredEventSlots() { if (impl_) impl_->flushRetiredEventSlots(); }
    std::optional<arrange::core::MutationTransaction> QuickJsScriptHost::takePendingTransaction() noexcept { return pendingTransactions_.take(); }
    void QuickJsScriptHost::clearPendingTransactions() noexcept { pendingTransactions_.clear(); }
    void QuickJsScriptHost::setFrameTimeMillis(double nowMillis) noexcept { if (impl_) impl_->frameTimeMillis = std::max(0.0, nowMillis); }
    bool QuickJsScriptHost::hasPendingAnimationFrame() const noexcept { return impl_ && !impl_->animationFrameCallbacks.empty(); }

    CallbackInvokeResult QuickJsScriptHost::pumpAnimationFrame(double nowMillis) {
        if (impl_->context == nullptr) return {false, "QuickJS runtime is not initialised"};
        setFrameTimeMillis(nowMillis); pendingTransactions_.clear();
        if (impl_->animationFrameCallbacks.empty()) { const auto drained = impl_->drainJobs(); return {drained.ok, drained.error}; }
        std::vector<std::pair<std::uint32_t, JSValue>> callbacks; callbacks.reserve(impl_->animationFrameCallbacks.size());
        for (auto& [handle, callback] : impl_->animationFrameCallbacks) callbacks.emplace_back(handle, callback);
        impl_->animationFrameCallbacks.clear();
        ScopedValue timestamp(impl_->context, JS_NewFloat64(impl_->context, impl_->frameTimeMillis)); JSValueConst argv[1] = {timestamp.get()};
        for (std::size_t i = 0; i < callbacks.size(); ++i) { JSValue callbackValue = callbacks[i].second; callbacks[i].second = JS_UNDEFINED; ScopedValue result(impl_->context, JS_Call(impl_->context, callbackValue, JS_UNDEFINED, 1, argv)); JS_FreeValue(impl_->context, callbackValue); if (JS_IsException(result.get())) { for (std::size_t j = i + 1; j < callbacks.size(); ++j) JS_FreeValue(impl_->context, callbacks[j].second); return {false, exceptionText(impl_->context)}; } }
        const auto drained = impl_->drainJobs(); return {drained.ok, drained.error};
    }

    ScriptExecutionResult QuickJsScriptHost::executeModule(const std::filesystem::path& modulePath, std::string_view source) {
        pendingTransactions_.clear(); reloadRequested_ = false; reloadRequest_ = {};
        const auto normalizedModulePath = std::filesystem::absolute(modulePath).lexically_normal(); impl_->initialise(this, normalizedModulePath);
        ScopedValue result(impl_->context, JS_Eval(impl_->context, source.data(), source.size(), normalizedModulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE));
        if (JS_IsException(result.get())) return {false, exceptionText(impl_->context)};
        const auto drained = impl_->drainJobs(); if (!drained.ok) return {false, drained.error};
        const auto& pending = pendingTransactions_.pending(); if (!pending || !pending->hasTreeMutations()) return {false, "Arrange app did not mount. Expected createApp(App).mount() to commit native mutations."};
        return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::invokeEventSlot(const arrange::core::EventSlotId& slot, const CallbackInvokeOptions& options) {
        if (impl_->context == nullptr) return {false, "QuickJS runtime is not initialised"}; if (!slot.valid()) return {false, "Arrange event slot is invalid"};
        const auto it = impl_->eventSlots.find(slot); if (it == impl_->eventSlots.end()) return {false, "Arrange event slot is not registered in QuickJS"};
        ScopedValue callback(impl_->context, JS_DupValue(impl_->context, it->second)); pendingTransactions_.clear(); JSValueConst* argv = nullptr; int argc = 0; JSValue argument = JS_UNDEFINED;
        if (options.hasStringArgument) { argument = JS_NewStringLen(impl_->context, options.stringArgument.data(), options.stringArgument.size()); argv = &argument; argc = 1; }
        ScopedValue result(impl_->context, JS_Call(impl_->context, callback.get(), JS_UNDEFINED, argc, argv)); if (options.hasStringArgument) JS_FreeValue(impl_->context, argument);
        if (JS_IsException(result.get())) return {false, exceptionText(impl_->context)}; const auto drained = impl_->drainJobs(); if (!drained.ok) return {false, drained.error}; return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::invokeEventSlot(const arrange::core::EventSlotId& slot, const arrange::core::ScrollResult& scroll) {
        if (impl_->context == nullptr) return {false, "QuickJS runtime is not initialised"}; if (!slot.valid()) return {false, "Arrange event slot is invalid"};
        const auto it = impl_->eventSlots.find(slot); if (it == impl_->eventSlots.end()) return {false, "Arrange event slot is not registered in QuickJS"};
        ScopedValue argument(impl_->context, JS_NewObject(impl_->context)); JS_SetPropertyStr(impl_->context, argument.get(), "value", JS_NewFloat64(impl_->context, scroll.value)); JS_SetPropertyStr(impl_->context, argument.get(), "maxValue", JS_NewFloat64(impl_->context, scroll.maxValue)); JS_SetPropertyStr(impl_->context, argument.get(), "viewportSize", JS_NewFloat64(impl_->context, scroll.viewportSize)); JS_SetPropertyStr(impl_->context, argument.get(), "contentSize", JS_NewFloat64(impl_->context, scroll.contentSize)); JS_SetPropertyStr(impl_->context, argument.get(), "isScrollInProgress", JS_NewBool(impl_->context, false));
        ScopedValue callback(impl_->context, JS_DupValue(impl_->context, it->second)); pendingTransactions_.clear(); JSValueConst argv[1] = {argument.get()}; ScopedValue result(impl_->context, JS_Call(impl_->context, callback.get(), JS_UNDEFINED, 1, argv));
        if (JS_IsException(result.get())) return {false, exceptionText(impl_->context)}; const auto drained = impl_->drainJobs(); if (!drained.ok) return {false, drained.error}; return {true, {}};
    }
} // namespace arrange::quickjs

#endif
