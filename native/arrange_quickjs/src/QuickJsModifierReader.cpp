#include "QuickJsModifierReader.h"

#if ARRANGE_WITH_QUICKJS_NG

#include <algorithm>
#include <cmath>

namespace arrange::quickjs {
    JSValue QuickJsModifierReader::throwTypeError(const char* message) {
        failed_ = true;
        JS_ThrowTypeError(context_, "%s", message);
        return JS_EXCEPTION;
    }

    JSValue QuickJsModifierReader::throwUnknownModifier(std::string_view type) {
        failed_ = true;
        JS_ThrowTypeError(context_, "Arrange modifier type '%.*s' is not supported by native runtime", static_cast<int>(type.size()), type.data());
        return JS_EXCEPTION;
    }

    JSValueConst QuickJsModifierReader::payloadFor(JSValueConst element, ScopedValue& value, std::string_view type) {
        if (!JS_IsObject(element) || JS_IsArray(element)) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange modifier element for '%.*s' must be an object", static_cast<int>(type.size()), type.data());
            return JS_UNDEFINED;
        }
        value = ScopedValue(context_, JS_GetPropertyStr(context_, element, "value"));
        if (!JS_IsObject(value.get()) || JS_IsArray(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange modifier '%.*s' requires object field 'value'", static_cast<int>(type.size()), type.data());
            return JS_UNDEFINED;
        }
        return value.get();
    }

    float QuickJsModifierReader::numberField(JSValueConst object, const char* key, float fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get())) return fallback;
        if (!JS_IsNumber(value.get())) { JS_ThrowTypeError(context_, "Arrange modifier field '%s' must be a number", key); return fallback; }
        return static_cast<float>(reader_.toDouble(value.get()));
    }

    bool QuickJsModifierReader::boolField(JSValueConst object, const char* key, bool fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get())) return fallback;
        if (!JS_IsBool(value.get())) { JS_ThrowTypeError(context_, "Arrange modifier field '%s' must be a boolean", key); return fallback; }
        return reader_.toBool(value.get());
    }

    float QuickJsModifierReader::requiredNumberField(JSValueConst object, const char* key, std::string_view owner) {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get()) || JS_IsNull(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s requires numeric field '%s'", static_cast<int>(owner.size()), owner.data(), key);
            return 0.0f;
        }
        if (!JS_IsNumber(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s field '%s' must be a number", static_cast<int>(owner.size()), owner.data(), key);
            return 0.0f;
        }
        return static_cast<float>(reader_.toDouble(value.get()));
    }

    std::string QuickJsModifierReader::requiredStringField(JSValueConst object, const char* key, std::string_view owner) {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get()) || JS_IsNull(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s requires string field '%s'", static_cast<int>(owner.size()), owner.data(), key);
            return {};
        }
        if (!JS_IsString(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s field '%s' must be a string", static_cast<int>(owner.size()), owner.data(), key);
            return {};
        }
        return reader_.toString(value.get());
    }

    arrange::core::ModifierPadding QuickJsModifierReader::readPadding(JSValueConst value) {
        return {
            requiredNumberField(value, "start", "padding modifier"),
            requiredNumberField(value, "top", "padding modifier"),
            requiredNumberField(value, "end", "padding modifier"),
            requiredNumberField(value, "bottom", "padding modifier"),
        };
    }

    std::pair<float, float> QuickJsModifierReader::transformOriginFrom(JSValueConst value) const {
        const auto name = reader_.stringField(value, "transformOrigin");
        if (name == "TopStart") return {0.0f, 0.0f};
        if (name == "TopCenter") return {0.5f, 0.0f};
        if (name == "TopEnd") return {1.0f, 0.0f};
        if (name == "CenterStart") return {0.0f, 0.5f};
        if (name == "CenterEnd") return {1.0f, 0.5f};
        if (name == "BottomStart") return {0.0f, 1.0f};
        if (name == "BottomCenter") return {0.5f, 1.0f};
        if (name == "BottomEnd") return {1.0f, 1.0f};
        ScopedValue origin(context_, JS_GetPropertyStr(context_, value, "transformOrigin"));
        if (JS_IsObject(origin.get())) {
            return {
                numberField(origin.get(), "x", 0.5f),
                numberField(origin.get(), "y", 0.5f),
            };
        }
        return {0.5f, 0.5f};
    }

    std::uint32_t QuickJsModifierReader::colorOrBrush(JSValueConst object, const char* colorKey, const char* brushKey) const {
        const auto color = reader_.colorField(object, colorKey, 0);
        if (color != 0) return color;
        ScopedValue brush(context_, JS_GetPropertyStr(context_, object, brushKey));
        if (JS_IsNumber(brush.get())) return reader_.toU32(brush.get());
        if (JS_IsObject(brush.get())) return reader_.colorField(brush.get(), "color", 0);
        return 0;
    }

    arrange::core::PaintStyleSemantics QuickJsModifierReader::paintStyle(JSValueConst value, arrange::core::PaintStyleKind kind) const {
        arrange::core::PaintStyleSemantics style;
        style.kind = kind;
        style.color = colorOrBrush(value, "color", "brush");
        style.strokeWidth = numberField(value, "width", 1.0f);
        ScopedValue shape(context_, JS_GetPropertyStr(context_, value, "shape"));
        if (JS_IsObject(shape.get())) {
            style.shapeType = reader_.stringField(shape.get(), "type");
            style.cornerRadius = style.shapeType == "rounded" ? numberField(shape.get(), "radius") : 0.0f;
        }
        style.alpha = numberField(value, "value", 1.0f);
        ScopedValue offset(context_, JS_GetPropertyStr(context_, value, "offset"));
        style.shadowOffset = {
            numberField(value, "offsetX", JS_IsObject(offset.get()) ? numberField(offset.get(), "x") : 0.0f),
            numberField(value, "offsetY", JS_IsObject(offset.get()) ? numberField(offset.get(), "y") : 0.0f),
        };
        return style;
    }

    arrange::core::ModifierDescriptors QuickJsModifierReader::read(arrange::core::NodeId id, JSValueConst modifier, const arrange::core::ModifierValue* instanceInput) {
        arrange::core::ModifierDescriptors result;
        failed_ = false;
        if (JS_IsUndefined(modifier) || JS_IsNull(modifier)) {
            (void)throwTypeError("Arrange native setModifier requires a Modifier object, not null/undefined");
            return result;
        }
        ScopedValue elements(context_, JS_GetPropertyStr(context_, modifier, "elements"));
        JSValueConst array = JS_IsArray(elements.get()) ? elements.get() : modifier;
        if (!JS_IsArray(array)) {
            (void)throwTypeError("Arrange native setModifier requires Modifier.elements to be an array");
            return result;
        }

        const auto length = reader_.arrayLength(array);
        struct PendingCallback {
            std::size_t index;
            arrange::core::EventSlotKind kind;
            ScopedValue callback;
        };
        std::vector<PendingCallback> callbacks;

        for (std::uint32_t i = 0; i < length; ++i) {
            ScopedValue element(context_, JS_GetPropertyUint32(context_, array, i));
            if (!JS_IsObject(element.get()) || JS_IsArray(element.get())) {
                JS_ThrowTypeError(context_, "Arrange modifier element at index %u must be an object", i);
                return {};
            }
            const auto type = requiredStringField(element.get(), "type", "modifier element");
            if (failed_) return {};

            ScopedValue value(context_, JS_UNDEFINED);
            JSValueConst payload = payloadFor(element.get(), value, type);
            if (failed_ || JS_IsUndefined(payload)) return {};

            const auto key = reader_.stringField(element.get(), "key");
            if (type == "padding") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = arrange::core::LayoutModifierKind::Padding;
                item.padding = readPadding(payload);
                if (failed_) return {};
                result.push_back({item, key});
            }
            else if (type == "width" || type == "height" || type == "requiredWidth" || type == "requiredHeight") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "width") item.kind = arrange::core::LayoutModifierKind::Width;
                else if (type == "height") item.kind = arrange::core::LayoutModifierKind::Height;
                else if (type == "requiredWidth") item.kind = arrange::core::LayoutModifierKind::RequiredWidth;
                else item.kind = arrange::core::LayoutModifierKind::RequiredHeight;
                item.value = requiredNumberField(payload, type == "requiredWidth" ? "width" : type == "requiredHeight" ? "height" : "value", type);
                if (failed_) return {};
                result.push_back({item, key});
            }
            else if (type == "size" || type == "requiredSize") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = type == "size" ? arrange::core::LayoutModifierKind::Size : arrange::core::LayoutModifierKind::RequiredSize;
                item.width = requiredNumberField(payload, "width", type);
                item.height = requiredNumberField(payload, "height", type);
                if (failed_) return {};
                result.push_back({item, key});
            }
            else if (type == "fillMaxWidth" || type == "fillMaxHeight" || type == "fillMaxSize") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "fillMaxWidth") item.kind = arrange::core::LayoutModifierKind::FillMaxWidth;
                else if (type == "fillMaxHeight") item.kind = arrange::core::LayoutModifierKind::FillMaxHeight;
                else item.kind = arrange::core::LayoutModifierKind::FillMaxSize;
                item.fraction = numberField(payload, "fraction", 1.0f);
                result.push_back({item, key});
            }
            else if (type == "widthIn" || type == "heightIn" || type == "sizeIn") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "widthIn") item.kind = arrange::core::LayoutModifierKind::WidthIn;
                else if (type == "heightIn") item.kind = arrange::core::LayoutModifierKind::HeightIn;
                else item.kind = arrange::core::LayoutModifierKind::SizeIn;
                item.minWidth = numberField(payload, "min", numberField(payload, "minWidth", -1.0f));
                item.maxWidth = numberField(payload, "max", numberField(payload, "maxWidth", -1.0f));
                item.minHeight = numberField(payload, "min", numberField(payload, "minHeight", -1.0f));
                item.maxHeight = numberField(payload, "max", numberField(payload, "maxHeight", -1.0f));
                result.push_back({item, key});
            }
            else if (type == "defaultMinSize") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = arrange::core::LayoutModifierKind::DefaultMinSize;
                item.minWidth = numberField(payload, "minWidth");
                item.minHeight = numberField(payload, "minHeight");
                result.push_back({item, key});
            }
            else if (type == "verticalScroll" || type == "horizontalScroll") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = type == "verticalScroll" ? arrange::core::LayoutModifierKind::VerticalScroll : arrange::core::LayoutModifierKind::HorizontalScroll;
                ScopedValue state(context_, JS_GetPropertyStr(context_, payload, "state"));
                if (!JS_IsObject(state.get())) {
                    JS_ThrowTypeError(context_, "Arrange modifier '%.*s' requires object field 'state'", static_cast<int>(type.size()), type.data());
                    return {};
                }
                item.scrollValue = numberField(state.get(), "value");
                item.enabled = boolField(payload, "enabled", true);
                const auto kind = type == "verticalScroll" ? arrange::core::EventSlotKind::VerticalScroll : arrange::core::EventSlotKind::HorizontalScroll;
                callbacks.push_back({result.size(), kind, ScopedValue(context_, JS_GetPropertyStr(context_, state.get(), "__arrangeNativeScroll"))});
                result.push_back({item, key});
            }
            else if (type == "weight" || type == "align") {
                arrange::core::ParentDataModifierSemantics item;
                if (type == "weight") {
                    item.weight = requiredNumberField(payload, "weight", type);
                    item.weightFill = boolField(payload, "fill", true);
                }
                else {
                    item.kind = arrange::core::ParentDataKind::Align;
                    item.align = requiredStringField(payload, "alignment", type);
                }
                result.push_back({item, key});
            }
            else if (type == "offset" || type == "absoluteOffset") {
                result.push_back({arrange::core::OffsetModifier{numberField(payload, "x"), numberField(payload, "y")}, key});
            }
            else if (type == "graphicsLayer") {
                arrange::core::TransformModifierSemantics item;
                item.translationX = numberField(payload, "translationX");
                item.translationY = numberField(payload, "translationY");
                item.scaleX = numberField(payload, "scaleX", 1.0f);
                item.scaleY = numberField(payload, "scaleY", 1.0f);
                item.rotationZ = numberField(payload, "rotationZ");
                const auto origin = transformOriginFrom(payload);
                item.transformOriginX = origin.first;
                item.transformOriginY = origin.second;
                item.alpha = numberField(payload, "alpha", 1.0f);
                item.clip = boolField(payload, "clip", false);
                result.push_back({item, key});
            }
            else if (type == "zIndex") {
                result.push_back({arrange::core::ZIndexModifier{requiredNumberField(payload, "value", type)}, key});
            }
            else if (type == "background" || type == "border" || type == "alpha" || type == "dropShadow" || type == "innerShadow") {
                auto kind = arrange::core::PaintStyleKind::Background;
                if (type == "border") kind = arrange::core::PaintStyleKind::Border;
                else if (type == "alpha") kind = arrange::core::PaintStyleKind::Alpha;
                else if (type == "dropShadow") kind = arrange::core::PaintStyleKind::DropShadow;
                else if (type == "innerShadow") kind = arrange::core::PaintStyleKind::InnerShadow;
                result.push_back({paintStyle(payload, kind), key});
            }
            else if (type == "clip") {
                result.push_back({arrange::core::ClipModifier{paintStyle(payload, arrange::core::PaintStyleKind::Background)}, key});
            }
            else if (type == "clickable" || type == "hoverable" || type == "focusable") {
                arrange::core::InputModifierSemantics item;
                item.enabled = boolField(payload, "enabled", true);
                item.focusable = boolField(payload, "focusable", true);
                if (type == "clickable") callbacks.push_back({result.size(), arrange::core::EventSlotKind::Click, ScopedValue(context_, JS_GetPropertyStr(context_, payload, "onClick"))});
                else item.kind = type == "hoverable" ? arrange::core::InputModifierKind::Hoverable : arrange::core::InputModifierKind::Focusable;
                result.push_back({item, key});
            }
            else if (type == "wrapContentWidth" ||
                     type == "wrapContentHeight" ||
                     type == "wrapContentSize" ||
                     type == "aspectRatio" ||
                     type == "matchParentSize" ||
                     type == "drawBehind" ||
                     type == "drawWithContent" ||
                     type == "drawWithCache" ||
                     type == "focusRequester" ||
                     type == "onFocusChanged" ||
                     type == "focusProperties" ||
                     type == "focusGroup" ||
                     type == "scrollable" ||
                     type == "animateContentSize" ||
                     type == "pointerInput" ||
                     type == "semantics" ||
                     type == "testTag") {
                (void)throwUnknownModifier(type);
                return {};
            }
            else {
                (void)throwUnknownModifier(type);
                return {};
            }
        }

        if (failed_ || JS_HasException(context_)) { failed_ = true; return {}; }
        try { arrange::core::validateModifierDescriptors(result); }
        catch (const std::exception& error) { (void)throwTypeError(error.what()); return {}; }
        if (instanceInput && (result.size() != 1 || !arrange::core::sameModifierKind(*instanceInput, result.front().value))) {
            (void)throwTypeError("Arrange Modifier input must preserve its instance kind");
            return {};
        }
        // 整条描述通过校验之后才登记回调，失败的描述不会留下半条注册记录。
        std::vector<arrange::core::EventSlotId> retained;
        for (auto& pending : callbacks) {
            const auto slot = instanceInput
                ? events_.updateModifierCallback(id, pending.kind, pending.callback.get(), arrange::core::modifierEventSlot(*instanceInput), transaction_)
                : events_.retainModifierCallback(id, pending.kind, pending.callback.get(), retained, transaction_);
            auto& input = result[pending.index].value;
            if (auto* scroll = std::get_if<arrange::core::LayoutModifierSemantics>(&input)) scroll->eventSlot = slot;
            else std::get<arrange::core::InputModifierSemantics>(input).eventSlot = slot;
            if (slot.valid()) retained.push_back(slot);
        }
        if (!instanceInput) events_.releaseModifierCallbacksExcept(id, retained, transaction_);
        return result;
    }
}

#endif
