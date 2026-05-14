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
            std::max(0.0f, requiredNumberField(value, "start", "padding modifier")),
            std::max(0.0f, requiredNumberField(value, "top", "padding modifier")),
            std::max(0.0f, requiredNumberField(value, "end", "padding modifier")),
            std::max(0.0f, requiredNumberField(value, "bottom", "padding modifier")),
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
                std::clamp(reader_.numberField(origin.get(), "x", 0.5f), 0.0f, 1.0f),
                std::clamp(reader_.numberField(origin.get(), "y", 0.5f), 0.0f, 1.0f),
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
        style.brush = style.color;
        style.strokeWidth = std::max(1.0f, reader_.numberField(value, "width", 1.0f));
        ScopedValue shape(context_, JS_GetPropertyStr(context_, value, "shape"));
        if (JS_IsObject(shape.get())) {
            style.shapeType = reader_.stringField(shape.get(), "type");
            style.cornerRadius = style.shapeType == "rounded" ? std::max(0.0f, reader_.numberField(shape.get(), "radius")) : 0.0f;
        }
        style.alpha = std::clamp(reader_.numberField(value, "value", 1.0f), 0.0f, 1.0f);
        ScopedValue offset(context_, JS_GetPropertyStr(context_, value, "offset"));
        style.shadowOffset = {
            reader_.numberField(value, "offsetX", JS_IsObject(offset.get()) ? reader_.numberField(offset.get(), "x") : 0.0f),
            reader_.numberField(value, "offsetY", JS_IsObject(offset.get()) ? reader_.numberField(offset.get(), "y") : 0.0f),
        };
        return style;
    }

    arrange::core::CompiledModifier QuickJsModifierReader::read(arrange::core::NodeId id, JSValueConst modifier) {
        arrange::core::CompiledModifier result;
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
        bool hasClick = false;
        bool hasVerticalScroll = false;
        bool hasHorizontalScroll = false;

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

            if (type == "padding") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = arrange::core::LayoutModifierKind::Padding;
                item.padding = readPadding(payload);
                if (failed_) return {};
                result.layout.push_back(item);
                result.paintContentPadding.push_back(item.padding);
                result.paint.chain.push_back({arrange::core::PaintChainOpKind::ContentPadding, paintStyle(payload, arrange::core::PaintStyleKind::Background), item.padding});
            }
            else if (type == "width" || type == "height" || type == "requiredWidth" || type == "requiredHeight") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "width") item.kind = arrange::core::LayoutModifierKind::Width;
                else if (type == "height") item.kind = arrange::core::LayoutModifierKind::Height;
                else if (type == "requiredWidth") item.kind = arrange::core::LayoutModifierKind::RequiredWidth;
                else item.kind = arrange::core::LayoutModifierKind::RequiredHeight;
                item.value = requiredNumberField(payload, type == "requiredWidth" ? "width" : type == "requiredHeight" ? "height" : "value", type);
                if (failed_) return {};
                result.layout.push_back(item);
            }
            else if (type == "size" || type == "requiredSize") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = type == "size" ? arrange::core::LayoutModifierKind::Size : arrange::core::LayoutModifierKind::RequiredSize;
                item.width = requiredNumberField(payload, "width", type);
                item.height = requiredNumberField(payload, "height", type);
                if (failed_) return {};
                result.layout.push_back(item);
            }
            else if (type == "fillMaxWidth" || type == "fillMaxHeight" || type == "fillMaxSize") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "fillMaxWidth") item.kind = arrange::core::LayoutModifierKind::FillMaxWidth;
                else if (type == "fillMaxHeight") item.kind = arrange::core::LayoutModifierKind::FillMaxHeight;
                else item.kind = arrange::core::LayoutModifierKind::FillMaxSize;
                item.fraction = reader_.numberField(payload, "fraction", 1.0f);
                result.layout.push_back(item);
            }
            else if (type == "widthIn" || type == "heightIn" || type == "sizeIn") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "widthIn") item.kind = arrange::core::LayoutModifierKind::WidthIn;
                else if (type == "heightIn") item.kind = arrange::core::LayoutModifierKind::HeightIn;
                else item.kind = arrange::core::LayoutModifierKind::SizeIn;
                item.minWidth = reader_.numberField(payload, "min", reader_.numberField(payload, "minWidth", -1.0f));
                item.maxWidth = reader_.numberField(payload, "max", reader_.numberField(payload, "maxWidth", -1.0f));
                item.minHeight = reader_.numberField(payload, "min", reader_.numberField(payload, "minHeight", -1.0f));
                item.maxHeight = reader_.numberField(payload, "max", reader_.numberField(payload, "maxHeight", -1.0f));
                result.layout.push_back(item);
            }
            else if (type == "defaultMinSize") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = arrange::core::LayoutModifierKind::DefaultMinSize;
                item.minWidth = reader_.numberField(payload, "minWidth");
                item.minHeight = reader_.numberField(payload, "minHeight");
                result.layout.push_back(item);
            }
            else if (type == "verticalScroll" || type == "horizontalScroll") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = type == "verticalScroll" ? arrange::core::LayoutModifierKind::VerticalScroll : arrange::core::LayoutModifierKind::HorizontalScroll;
                ScopedValue state(context_, JS_GetPropertyStr(context_, payload, "state"));
                if (!JS_IsObject(state.get())) {
                    JS_ThrowTypeError(context_, "Arrange modifier '%.*s' requires object field 'state'", static_cast<int>(type.size()), type.data());
                    return {};
                }
                item.scrollValue = std::max(0.0f, reader_.numberField(state.get(), "value"));
                result.layout.push_back(item);
                const auto kind = type == "verticalScroll" ? arrange::core::EventSlotKind::VerticalScroll : arrange::core::EventSlotKind::HorizontalScroll;
                const auto slot = arrange::core::makeEventSlotId(id, kind);
                if (type == "verticalScroll") {
                    result.scroll.vertical = reader_.boolField(payload, "enabled", true);
                    result.scroll.verticalValue = item.scrollValue;
                    result.scroll.verticalEventSlot = slot;
                    hasVerticalScroll = true;
                }
                else {
                    result.scroll.horizontal = reader_.boolField(payload, "enabled", true);
                    result.scroll.horizontalValue = item.scrollValue;
                    result.scroll.horizontalEventSlot = slot;
                    hasHorizontalScroll = true;
                }
                ScopedValue callback(context_, JS_GetPropertyStr(context_, state.get(), "__arrangeNativeScroll"));
                events_.replace(slot, callback.get(), transaction_);
                result.paint.chain.push_back({arrange::core::PaintChainOpKind::Clip, paintStyle(payload, arrange::core::PaintStyleKind::Background), {}});
                result.paint.clips.push_back(paintStyle(payload, arrange::core::PaintStyleKind::Background));
            }
            else if (type == "weight") {
                result.parentData.weight = std::max(0.0f, requiredNumberField(payload, "weight", "weight modifier"));
                if (failed_) return {};
                result.parentData.weightFill = reader_.boolField(payload, "fill", true);
            }
            else if (type == "align") {
                result.parentData.align = requiredStringField(payload, "alignment", "align modifier");
                if (failed_) return {};
            }
            else if (type == "offset" || type == "absoluteOffset") {
                result.transform.layoutOffsetX += reader_.numberField(payload, "x");
                result.transform.layoutOffsetY += reader_.numberField(payload, "y");
            }
            else if (type == "graphicsLayer") {
                result.transform.translationX += reader_.numberField(payload, "translationX");
                result.transform.translationY += reader_.numberField(payload, "translationY");
                result.transform.layoutOffsetX += reader_.numberField(payload, "translationX");
                result.transform.layoutOffsetY += reader_.numberField(payload, "translationY");
                result.transform.scaleX = reader_.numberField(payload, "scaleX", 1.0f);
                result.transform.scaleY = reader_.numberField(payload, "scaleY", 1.0f);
                result.transform.rotationZ = reader_.numberField(payload, "rotationZ");
                const auto origin = transformOriginFrom(payload);
                result.transform.transformOriginX = origin.first;
                result.transform.transformOriginY = origin.second;
                result.transform.hasPaintTransform = std::fabs(result.transform.scaleX - 1.0f) > 0.0001f ||
                    std::fabs(result.transform.scaleY - 1.0f) > 0.0001f ||
                    std::fabs(result.transform.rotationZ) > 0.0001f;
            }
            else if (type == "zIndex") {
                result.zIndex = requiredNumberField(payload, "value", "zIndex modifier");
                if (failed_) return {};
            }
            else if (type == "background" || type == "border" || type == "alpha" || type == "dropShadow" || type == "innerShadow") {
                auto kind = arrange::core::PaintStyleKind::Background;
                if (type == "border") kind = arrange::core::PaintStyleKind::Border;
                else if (type == "alpha") kind = arrange::core::PaintStyleKind::Alpha;
                else if (type == "dropShadow") kind = arrange::core::PaintStyleKind::DropShadow;
                else if (type == "innerShadow") kind = arrange::core::PaintStyleKind::InnerShadow;
                const auto style = paintStyle(payload, kind);
                result.paint.chain.push_back({arrange::core::PaintChainOpKind::Style, style, {}});
                result.paint.styles.push_back(style);
            }
            else if (type == "clip") {
                const auto style = paintStyle(payload, arrange::core::PaintStyleKind::Background);
                result.paint.chain.push_back({arrange::core::PaintChainOpKind::Clip, style, {}});
                result.paint.clips.push_back(style);
            }
            else if (type == "clickable") {
                result.input.clickable = reader_.boolField(payload, "enabled", true);
                result.input.focusable = reader_.boolField(payload, "focusable", true);
                result.input.clickEventSlot = arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click);
                ScopedValue callback(context_, JS_GetPropertyStr(context_, payload, "onClick"));
                events_.replace(result.input.clickEventSlot, callback.get(), transaction_);
                hasClick = JS_IsFunction(context_, callback.get());
            }
            else if (type == "hoverable") {
                result.input.hoverable = reader_.boolField(payload, "enabled", true);
            }
            else if (type == "focusable") {
                result.input.focusable = reader_.boolField(payload, "enabled", true);
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

        if (!hasClick) events_.release(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::Click), transaction_);
        if (!hasVerticalScroll) events_.release(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::VerticalScroll), transaction_);
        if (!hasHorizontalScroll) events_.release(arrange::core::makeEventSlotId(id, arrange::core::EventSlotKind::HorizontalScroll), transaction_);
        return result;
    }
}

#endif
