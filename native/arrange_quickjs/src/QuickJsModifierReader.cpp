#include "QuickJsModifierReader.h"
#include "QuickJsPainterResources.h"

#if ARRANGE_WITH_QUICKJS_NG

#include <algorithm>
#include <cmath>
#include <initializer_list>

namespace arrange::quickjs {
    namespace {
        bool fieldsMatch(JSContext* context, JSValueConst object, std::initializer_list<std::string_view> fields, std::string_view owner) {
            JSPropertyEnum* properties = nullptr;
            std::uint32_t count = 0;
            if (JS_GetOwnPropertyNames(context, &properties, &count, object, JS_GPN_STRING_MASK | JS_GPN_SYMBOL_MASK) < 0) return false;

            bool valid = true;
            for (std::uint32_t i = 0; i < count; ++i) {
                const char* name = JS_AtomToCString(context, properties[i].atom);
                if (name == nullptr) {
                    valid = false;
                    break;
                }
                if (std::find(fields.begin(), fields.end(), name) == fields.end()) {
                    JS_ThrowTypeError(context, "Arrange %.*s 不接受字段 '%s'", static_cast<int>(owner.size()), owner.data(), name);
                    valid = false;
                }
                JS_FreeCString(context, name);
                if (!valid) break;
            }
            JS_FreePropertyEnum(context, properties, count);
            return valid;
        }

        bool modifierFieldsMatch(JSContext* context, JSValueConst value, std::string_view type) {
            const auto check = [&](std::initializer_list<std::string_view> fields) {
                return fieldsMatch(context, value, fields, type);
            };
            if (type == "text") return check({"text", "textStyle", "singleLine", "minLines", "maxLines", "textAlign", "overflow"});
            if (type == "textField") return check({"value", "textStyle", "singleLine", "minLines", "maxLines", "placeholder", "enabled", "selectAllOnFocus", "onValueChange", "onSubmit", "onChange", "onBlur"});
            if (type == "paint") return check({"painter", "contentScale", "alignment", "alpha", "colorFilter", "sizeToIntrinsics"});
            if (type == "padding") return check({"start", "top", "end", "bottom"});
            if (type == "width" || type == "height" || type == "alpha" || type == "zIndex") return check({"value"});
            if (type == "requiredWidth") return check({"width"});
            if (type == "requiredHeight") return check({"height"});
            if (type == "size" || type == "requiredSize") return check({"width", "height"});
            if (type == "fillMaxWidth" || type == "fillMaxHeight" || type == "fillMaxSize") return check({"fraction"});
            if (type == "widthIn" || type == "heightIn") return check({"min", "max"});
            if (type == "sizeIn") return check({"minWidth", "maxWidth", "minHeight", "maxHeight"});
            if (type == "defaultMinSize") return check({"minWidth", "minHeight"});
            if (type == "verticalScroll" || type == "horizontalScroll") return check({"state", "enabled"});
            if (type == "animateContentSize") return check({"animationSpec", "clip"});
            if (type == "weight") return check({"weight", "fill"});
            if (type == "align") return check({"alignment"});
            if (type == "offset" || type == "absoluteOffset") return check({"x", "y"});
            if (type == "graphicsLayer") return check({"translationX", "translationY", "scaleX", "scaleY", "rotationZ", "transformOrigin", "alpha", "clip"});
            if (type == "background") return check({"color", "brush", "shape"});
            if (type == "border") return check({"width", "color", "brush", "shape"});
            if (type == "clip") return check({"shape"});
            if (type == "clickable") return check({"enabled", "focusable", "onClick"});
            if (type == "hoverable" || type == "focusable") return check({"enabled"});

            JS_ThrowTypeError(context, "Arrange Modifier 类型 '%.*s' 未定义", static_cast<int>(type.size()), type.data());
            return false;
        }
    }  // namespace

    JSValue QuickJsModifierReader::throwTypeError(const char* message) {
        failed_ = true;
        JS_ThrowTypeError(context_, "%s", message);
        return JS_EXCEPTION;
    }

    JSValue QuickJsModifierReader::throwUnknownModifier(std::string_view type) {
        failed_ = true;
        JS_ThrowTypeError(context_, "Arrange Modifier 类型 '%.*s' 未定义", static_cast<int>(type.size()), type.data());
        return JS_EXCEPTION;
    }

    JSValueConst QuickJsModifierReader::payloadFor(JSValueConst element, ScopedValue& value, std::string_view type) {
        if (!JS_IsObject(element) || JS_IsArray(element)) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange '%.*s' 的 Modifier 元素需要对象", static_cast<int>(type.size()), type.data());
            return JS_UNDEFINED;
        }
        value = ScopedValue(context_, JS_GetPropertyStr(context_, element, "value"));
        if (!JS_IsObject(value.get()) || JS_IsArray(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange Modifier '%.*s' 的 value 需要对象", static_cast<int>(type.size()), type.data());
            return JS_UNDEFINED;
        }
        return value.get();
    }

    float QuickJsModifierReader::numberField(JSValueConst object, const char* key, float fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get())) return fallback;
        if (!JS_IsNumber(value.get())) {
            JS_ThrowTypeError(context_, "Arrange Modifier 字段 '%s' 需要数值", key);
            return fallback;
        }
        return static_cast<float>(reader_.toDouble(value.get()));
    }

    bool QuickJsModifierReader::boolField(JSValueConst object, const char* key, bool fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get())) return fallback;
        if (!JS_IsBool(value.get())) {
            JS_ThrowTypeError(context_, "Arrange Modifier 字段 '%s' 需要布尔值", key);
            return fallback;
        }
        return reader_.toBool(value.get());
    }

    float QuickJsModifierReader::requiredNumberField(JSValueConst object, const char* key, std::string_view owner) {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get()) || JS_IsNull(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s 缺少数值字段 '%s'", static_cast<int>(owner.size()), owner.data(), key);
            return 0.0f;
        }
        if (!JS_IsNumber(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s 字段 '%s' 需要数值", static_cast<int>(owner.size()), owner.data(), key);
            return 0.0f;
        }
        return static_cast<float>(reader_.toDouble(value.get()));
    }

    std::string QuickJsModifierReader::requiredStringField(JSValueConst object, const char* key, std::string_view owner) {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get()) || JS_IsNull(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s 缺少字符串字段 '%s'", static_cast<int>(owner.size()), owner.data(), key);
            return {};
        }
        if (!JS_IsString(value.get())) {
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange %.*s 字段 '%s' 需要字符串", static_cast<int>(owner.size()), owner.data(), key);
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
        if (name == "Center") return {0.5f, 0.5f};
        if (name == "CenterEnd") return {1.0f, 0.5f};
        if (name == "BottomStart") return {0.0f, 1.0f};
        if (name == "BottomCenter") return {0.5f, 1.0f};
        if (name == "BottomEnd") return {1.0f, 1.0f};
        ScopedValue origin(context_, JS_GetPropertyStr(context_, value, "transformOrigin"));
        if (JS_IsObject(origin.get()) && !JS_IsArray(origin.get())) {
            if (!fieldsMatch(context_, origin.get(), {"x", "y"}, "transformOrigin")) return {};
            return {
                numberField(origin.get(), "x", 0.5f),
                numberField(origin.get(), "y", 0.5f),
            };
        }
        if (!JS_IsUndefined(origin.get())) JS_ThrowTypeError(context_, "transformOrigin 需要有效的对齐名称或 { x, y }");
        return {0.5f, 0.5f};
    }

    std::uint32_t QuickJsModifierReader::colorOrBrush(JSValueConst object, const char* colorKey, const char* brushKey) const {
        ScopedValue color(context_, JS_GetPropertyStr(context_, object, colorKey));
        ScopedValue brush(context_, JS_GetPropertyStr(context_, object, brushKey));
        if (!JS_IsUndefined(color.get())) {
            if (!JS_IsUndefined(brush.get())) JS_ThrowTypeError(context_, "颜色输入不能同时提供 color 和 brush");
            if (!JS_IsNumber(color.get())) JS_ThrowTypeError(context_, "color 需要数值颜色");
            return reader_.toU32(color.get());
        }
        if (JS_IsNumber(brush.get())) return reader_.toU32(brush.get());
        if (JS_IsObject(brush.get()) && !JS_IsArray(brush.get())) {
            if (!fieldsMatch(context_, brush.get(), {"type", "color"}, "brush")) return 0;
            if (reader_.stringField(brush.get(), "type") != "solidColor") JS_ThrowTypeError(context_, "brush.type 需要 solidColor");
            ScopedValue brushColor(context_, JS_GetPropertyStr(context_, brush.get(), "color"));
            if (!JS_IsNumber(brushColor.get())) JS_ThrowTypeError(context_, "brush.color 需要数值颜色");
            return reader_.toU32(brushColor.get());
        }
        if (!JS_IsUndefined(brush.get())) JS_ThrowTypeError(context_, "brush 需要数值颜色或 solidColor 对象");
        return 0;
    }

    arrange::core::PaintStyleSemantics QuickJsModifierReader::paintStyle(JSValueConst value, arrange::core::PaintStyleKind kind) const {
        arrange::core::PaintStyleSemantics style;
        style.kind = kind;
        style.color = colorOrBrush(value, "color", "brush");
        style.strokeWidth = numberField(value, "width", 1.0f);
        ScopedValue shape(context_, JS_GetPropertyStr(context_, value, "shape"));
        if (JS_IsObject(shape.get()) && !JS_IsArray(shape.get())) {
            style.shapeType = reader_.stringField(shape.get(), "type");
            if (!fieldsMatch(context_, shape.get(), style.shapeType == "rounded" ? std::initializer_list<std::string_view>{"type", "radius"} : std::initializer_list<std::string_view>{"type"}, "shape")) return style;
            if (style.shapeType.empty()) JS_ThrowTypeError(context_, "shape.type 不能为空");
            style.cornerRadius = style.shapeType == "rounded" ? numberField(shape.get(), "radius") : 0.0f;
        } else if (!JS_IsUndefined(shape.get()))
            JS_ThrowTypeError(context_, "shape 需要形状对象");
        style.alpha = numberField(value, "value", 1.0f);
        return style;
    }

    arrange::core::ModifierDescriptors QuickJsModifierReader::read(arrange::core::NodeId id, JSValueConst modifier, const arrange::core::ModifierValue* instanceInput, std::span<const arrange::core::ModifierDescriptor* const> previous) {
        arrange::core::ModifierDescriptors result;
        failed_ = false;
        if (JS_IsUndefined(modifier) || JS_IsNull(modifier)) {
            (void)throwTypeError("Arrange setModifier 需要 Modifier 对象");
            return result;
        }
        ScopedValue elements(context_, JS_GetPropertyStr(context_, modifier, "elements"));
        JSValueConst array = JS_IsArray(elements.get()) ? elements.get() : modifier;
        if (!JS_IsArray(array)) {
            (void)throwTypeError("Arrange Modifier.elements 需要数组");
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
                JS_ThrowTypeError(context_, "Arrange Modifier 第 %u 项需要对象", i);
                return {};
            }
            const auto type = requiredStringField(element.get(), "type", "modifier element");
            if (failed_) return {};
            if (!fieldsMatch(context_, element.get(), {"type", "key", "value"}, "Modifier 元素")) {
                failed_ = true;
                return {};
            }

            ScopedValue value(context_, JS_UNDEFINED);
            JSValueConst payload = payloadFor(element.get(), value, type);
            if (failed_ || JS_IsUndefined(payload)) return {};
            if (!modifierFieldsMatch(context_, payload, type)) {
                failed_ = true;
                return {};
            }

            const auto key = reader_.stringField(element.get(), "key");
            if (type == "padding") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = arrange::core::LayoutModifierKind::Padding;
                item.padding = readPadding(payload);
                if (failed_) return {};
                result.push_back({item, key});
            } else if (type == "width" || type == "height" || type == "requiredWidth" || type == "requiredHeight") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "width")
                    item.kind = arrange::core::LayoutModifierKind::Width;
                else if (type == "height")
                    item.kind = arrange::core::LayoutModifierKind::Height;
                else if (type == "requiredWidth")
                    item.kind = arrange::core::LayoutModifierKind::RequiredWidth;
                else
                    item.kind = arrange::core::LayoutModifierKind::RequiredHeight;
                item.value = requiredNumberField(payload, type == "requiredWidth" ? "width" : type == "requiredHeight" ? "height" : "value", type);
                if (failed_) return {};
                result.push_back({item, key});
            } else if (type == "size" || type == "requiredSize") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = type == "size" ? arrange::core::LayoutModifierKind::Size : arrange::core::LayoutModifierKind::RequiredSize;
                item.width = requiredNumberField(payload, "width", type);
                item.height = requiredNumberField(payload, "height", type);
                if (failed_) return {};
                result.push_back({item, key});
            } else if (type == "fillMaxWidth" || type == "fillMaxHeight" || type == "fillMaxSize") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "fillMaxWidth")
                    item.kind = arrange::core::LayoutModifierKind::FillMaxWidth;
                else if (type == "fillMaxHeight")
                    item.kind = arrange::core::LayoutModifierKind::FillMaxHeight;
                else
                    item.kind = arrange::core::LayoutModifierKind::FillMaxSize;
                item.fraction = numberField(payload, "fraction", 1.0f);
                result.push_back({item, key});
            } else if (type == "widthIn" || type == "heightIn" || type == "sizeIn") {
                arrange::core::LayoutModifierSemantics item;
                if (type == "widthIn")
                    item.kind = arrange::core::LayoutModifierKind::WidthIn;
                else if (type == "heightIn")
                    item.kind = arrange::core::LayoutModifierKind::HeightIn;
                else
                    item.kind = arrange::core::LayoutModifierKind::SizeIn;
                item.minWidth = numberField(payload, "min", numberField(payload, "minWidth", -1.0f));
                item.maxWidth = numberField(payload, "max", numberField(payload, "maxWidth", -1.0f));
                item.minHeight = numberField(payload, "min", numberField(payload, "minHeight", -1.0f));
                item.maxHeight = numberField(payload, "max", numberField(payload, "maxHeight", -1.0f));
                result.push_back({item, key});
            } else if (type == "defaultMinSize") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = arrange::core::LayoutModifierKind::DefaultMinSize;
                item.minWidth = numberField(payload, "minWidth");
                item.minHeight = numberField(payload, "minHeight");
                result.push_back({item, key});
            } else if (type == "verticalScroll" || type == "horizontalScroll") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = type == "verticalScroll" ? arrange::core::LayoutModifierKind::VerticalScroll : arrange::core::LayoutModifierKind::HorizontalScroll;
                ScopedValue state(context_, JS_GetPropertyStr(context_, payload, "state"));
                if (!JS_IsObject(state.get())) {
                    JS_ThrowTypeError(context_, "Arrange Modifier '%.*s' 的 state 需要对象", static_cast<int>(type.size()), type.data());
                    return {};
                }
                item.scrollValue = numberField(state.get(), "value");
                item.enabled = boolField(payload, "enabled", true);
                const auto kind = type == "verticalScroll" ? arrange::core::EventSlotKind::VerticalScroll : arrange::core::EventSlotKind::HorizontalScroll;
                callbacks.push_back({result.size(), kind, ScopedValue(context_, JS_GetPropertyStr(context_, state.get(), "__arrangeNativeScroll"))});
                result.push_back({item, key});
            } else if (type == "animateContentSize") {
                arrange::core::AnimateContentSizeModifier item;
                ScopedValue spec(context_, JS_GetPropertyStr(context_, payload, "animationSpec"));
                if (!JS_IsObject(spec.get()) || JS_IsArray(spec.get())) {
                    (void)throwTypeError("animateContentSize 需要 animationSpec 对象");
                    return {};
                }
                const auto kind = requiredStringField(spec.get(), "kind", "animationSpec");
                const auto fields = kind == "tween" ? std::initializer_list<std::string_view>{"kind", "durationMillis", "delayMillis", "x1", "y1", "x2", "y2"} : kind == "spring" ? std::initializer_list<std::string_view>{"kind", "stiffness", "dampingRatio", "visibilityThreshold"} : std::initializer_list<std::string_view>{"kind", "delayMillis"};
                if (!fieldsMatch(context_, spec.get(), fields, "animationSpec")) {
                    failed_ = true;
                    return {};
                }
                if (kind == "tween")
                    item.animationSpec.kind = arrange::core::AnimationKind::Tween;
                else if (kind == "spring")
                    item.animationSpec.kind = arrange::core::AnimationKind::Spring;
                else if (kind == "snap")
                    item.animationSpec.kind = arrange::core::AnimationKind::Snap;
                else {
                    (void)throwTypeError("动画规格类型未定义");
                    return {};
                }
                auto& input = item.animationSpec;
                input.durationMillis = numberField(spec.get(), "durationMillis", 300);
                input.delayMillis = numberField(spec.get(), "delayMillis", 0);
                input.stiffness = numberField(spec.get(), "stiffness", 400);
                input.dampingRatio = numberField(spec.get(), "dampingRatio", 1);
                input.threshold = numberField(spec.get(), "visibilityThreshold", 0.01f);
                input.bezier = {numberField(spec.get(), "x1", 0.4f), numberField(spec.get(), "y1", 0), numberField(spec.get(), "x2", 0.2f), numberField(spec.get(), "y2", 1)};
                item.clip = boolField(payload, "clip", true);
                result.push_back({item, key});
            } else if (type == "text" || type == "textField") {
                arrange::core::TextModifier text;
                const auto editable = type == "textField";
                text.text = requiredStringField(payload, editable ? "value" : "text", type);
                const auto minLines = numberField(payload, "minLines", 1);
                const auto maxLines = numberField(payload, "maxLines", 0);
                if (!std::isfinite(minLines) || !std::isfinite(maxLines) || std::floor(minLines) != minLines || std::floor(maxLines) != maxLines || minLines < 1 || maxLines < 0 || minLines > 1000000 || maxLines > 1000000) {
                    (void)throwTypeError("文本行数必须是有效整数");
                    return {};
                }
                text.minLines = static_cast<int>(minLines);
                text.maxLines = static_cast<int>(maxLines);
                text.singleLine = boolField(payload, "singleLine", editable && text.minLines == 1 && text.maxLines <= 1);
                const auto align = reader_.stringField(payload, "textAlign");
                if (!align.empty()) text.textAlign = align == "left" || align == "start" ? "Start" : align == "right" || align == "end" ? "End" : align == "center" ? "Center" : align;
                const auto overflow = reader_.stringField(payload, "overflow");
                if (!overflow.empty()) text.overflow = overflow;

                ScopedValue style(context_, JS_GetPropertyStr(context_, payload, "textStyle"));
                if (!JS_IsUndefined(style.get())) {
                    if (!JS_IsObject(style.get()) || JS_IsArray(style.get()) || !fieldsMatch(context_, style.get(), {"fontSize", "lineHeight", "color"}, "textStyle")) {
                        (void)throwTypeError("textStyle 需要正式文本样式对象");
                        return {};
                    }
                    text.style.fontSize = numberField(style.get(), "fontSize", 14);
                    text.style.lineHeight = numberField(style.get(), "lineHeight", 0);
                    ScopedValue color(context_, JS_GetPropertyStr(context_, style.get(), "color"));
                    if (!JS_IsUndefined(color.get())) {
                        const auto number = reader_.toDouble(color.get());
                        if (!JS_IsNumber(color.get()) || !std::isfinite(number) || number < 0 || number > 4294967295.0 || std::floor(number) != number) {
                            (void)throwTypeError("文字颜色必须是 uint32 颜色值");
                            return {};
                        }
                        text.color = static_cast<std::uint32_t>(number);
                    }
                }
                if (editable) {
                    arrange::core::TextFieldModifier field;
                    field.value = text.text;
                    field.placeholder = reader_.stringField(payload, "placeholder");
                    field.presentation = std::move(text);
                    field.enabled = boolField(payload, "enabled", true);
                    field.selectAllOnFocus = boolField(payload, "selectAllOnFocus", false);
                    using Kind = arrange::core::EventSlotKind;
                    for (const auto& [name, kind] : {std::pair{"onValueChange", Kind::InputUpdate}, {"onSubmit", Kind::InputSubmit}, {"onChange", Kind::InputChange}, {"onBlur", Kind::InputBlur}}) {
                        callbacks.push_back({result.size(), kind, ScopedValue(context_, JS_GetPropertyStr(context_, payload, name))});
                    }
                    result.push_back({std::move(field), key});
                } else
                    result.push_back({std::move(text), key});
            } else if (type == "paint") {
                arrange::core::PaintModifier item;
                ScopedValue painter(context_, JS_GetPropertyStr(context_, payload, "painter"));
                const auto snapshot = QuickJsPainterResources::read(context_, painter.get());
                if (!snapshot) {
                    failed_ = true;
                    return {};
                }
                item.painter = *snapshot;
                item.alpha = numberField(payload, "alpha", 1.0f);
                item.sizeToIntrinsics = boolField(payload, "sizeToIntrinsics", true);
                const auto scale = reader_.stringField(payload, "contentScale");
                const auto alignment = reader_.stringField(payload, "alignment");
                if (!scale.empty()) item.contentScale = scale;
                if (!alignment.empty()) item.alignment = alignment;
                ScopedValue filter(context_, JS_GetPropertyStr(context_, payload, "colorFilter"));
                if (!JS_IsUndefined(filter.get())) {
                    if (!JS_IsObject(filter.get()) || !fieldsMatch(context_, filter.get(), {"tint"}, "colorFilter")) {
                        failed_ = true;
                        return {};
                    }
                    ScopedValue tint(context_, JS_GetPropertyStr(context_, filter.get(), "tint"));
                    const auto number = reader_.toDouble(tint.get());
                    if (!JS_IsNumber(tint.get()) || !std::isfinite(number) || number < 0 || number > 4294967295.0 || std::floor(number) != number) {
                        failed_ = true;
                        JS_ThrowTypeError(context_, "colorFilter.tint 必须是 uint32 颜色值");
                        return {};
                    }
                    item.tint = static_cast<std::uint32_t>(number);
                }
                result.push_back({item, key});
            } else if (type == "weight" || type == "align") {
                arrange::core::ParentDataModifierSemantics item;
                if (type == "weight") {
                    item.weight = requiredNumberField(payload, "weight", type);
                    item.weightFill = boolField(payload, "fill", true);
                } else {
                    item.kind = arrange::core::ParentDataKind::Align;
                    item.align = requiredStringField(payload, "alignment", type);
                }
                result.push_back({item, key});
            } else if (type == "offset" || type == "absoluteOffset") {
                result.push_back({arrange::core::OffsetModifier{numberField(payload, "x"), numberField(payload, "y")}, key});
            } else if (type == "graphicsLayer") {
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
            } else if (type == "zIndex") {
                result.push_back({arrange::core::ZIndexModifier{requiredNumberField(payload, "value", type)}, key});
            } else if (type == "background" || type == "border" || type == "alpha") {
                auto kind = arrange::core::PaintStyleKind::Background;
                if (type == "border")
                    kind = arrange::core::PaintStyleKind::Border;
                else if (type == "alpha")
                    kind = arrange::core::PaintStyleKind::Alpha;
                result.push_back({paintStyle(payload, kind), key});
            } else if (type == "clip") {
                result.push_back({arrange::core::ClipModifier{paintStyle(payload, arrange::core::PaintStyleKind::Background)}, key});
            } else if (type == "clickable" || type == "hoverable" || type == "focusable") {
                arrange::core::InputModifierSemantics item;
                item.enabled = boolField(payload, "enabled", true);
                item.focusable = boolField(payload, "focusable", true);
                if (type == "clickable") {
                    ScopedValue callback(context_, JS_GetPropertyStr(context_, payload, "onClick"));
                    if (!JS_IsFunction(context_, callback.get())) {
                        (void)throwTypeError("clickable.onClick 需要函数");
                        return {};
                    }
                    callbacks.push_back({result.size(), arrange::core::EventSlotKind::Click, std::move(callback)});
                } else
                    item.kind = type == "hoverable" ? arrange::core::InputModifierKind::Hoverable : arrange::core::InputModifierKind::Focusable;
                result.push_back({item, key});
            } else {
                (void)throwUnknownModifier(type);
                return {};
            }
        }

        if (failed_ || JS_HasException(context_)) {
            failed_ = true;
            return {};
        }
        try {
            arrange::core::validateModifierDescriptors(result);
        } catch (const std::exception& error) {
            (void)throwTypeError(error.what());
            return {};
        }
        if (instanceInput && (result.size() != 1 || !arrange::core::sameModifierKind(*instanceInput, result.front().value))) {
            (void)throwTypeError("Arrange Modifier 单实例更新不能改变实例类型");
            return {};
        }
        // 整条描述通过校验之后才登记回调，失败的描述不会留下半条注册记录
        const auto matches = arrange::core::matchModifierDescriptors(previous, result);
        std::vector<arrange::core::EventSlotId> retained;
        for (auto& pending : callbacks) {
            const auto match = matches[pending.index];
            const auto* prior = instanceInput ? instanceInput : match < previous.size() ? &previous[match]->value : nullptr;
            const auto oldSlot = prior ? arrange::core::modifierEventSlot(*prior, pending.kind) : arrange::core::EventSlotId{};
            const auto slot = events_.updateModifierCallback(id, pending.kind, pending.callback.get(), oldSlot, transaction_);
            auto& input = result[pending.index].value;
            if (auto* scroll = std::get_if<arrange::core::LayoutModifierSemantics>(&input))
                scroll->eventSlot = slot;
            else if (auto* field = std::get_if<arrange::core::TextFieldModifier>(&input)) {
                using Kind = arrange::core::EventSlotKind;
                if (pending.kind == Kind::InputUpdate)
                    field->onValueChange = slot;
                else if (pending.kind == Kind::InputSubmit)
                    field->onSubmit = slot;
                else if (pending.kind == Kind::InputChange)
                    field->onChange = slot;
                else if (pending.kind == Kind::InputBlur)
                    field->onBlur = slot;
            } else
                std::get<arrange::core::InputModifierSemantics>(input).eventSlot = slot;
            if (slot.valid()) retained.push_back(slot);
        }
        if (!instanceInput) events_.releaseModifierCallbacksExcept(id, retained, transaction_);
        return result;
    }
}  // namespace arrange::quickjs

#endif
