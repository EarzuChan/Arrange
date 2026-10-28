#include "QuickJsModifierReader.h"
#include "ModifierSchema.h"
#include "QuickJsPainterResources.h"

#if ARRANGE_WITH_QUICKJS_NG

#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <span>

namespace arrange::quickjs {
    namespace {
        bool fieldsMatch(JSContext* context, JSValueConst object, std::span<const std::string_view> fields, std::string_view owner) {
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

        bool fieldsMatch(JSContext* context, JSValueConst object, std::initializer_list<std::string_view> fields, std::string_view owner) {
            return fieldsMatch(context, object, std::span<const std::string_view>(fields.begin(), fields.size()), owner);
        }

        // 字段白名单由修饰 schema 生成
        bool modifierFieldsMatch(JSContext* context, JSValueConst value, std::string_view type) {
            if (const auto* entry = findModifierSchema(type)) return fieldsMatch(context, value, entry->fields, type);
            JS_ThrowTypeError(context, "Arrange Modifier 类型 '%.*s' 未定义", static_cast<int>(type.size()), type.data());
            return false;
        }
    }

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
            return reader_.colorValue(color.get());
        }
        if (JS_IsNumber(brush.get())) return reader_.colorValue(brush.get());
        if (JS_IsObject(brush.get()) && !JS_IsArray(brush.get())) {
            if (!fieldsMatch(context_, brush.get(), {"type", "color"}, "brush")) return 0;
            if (reader_.stringField(brush.get(), "type") != "solidColor") JS_ThrowTypeError(context_, "brush.type 需要 solidColor");
            ScopedValue brushColor(context_, JS_GetPropertyStr(context_, brush.get(), "color"));
            return reader_.colorValue(brushColor.get());
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
            constexpr std::string_view elementFields[]{"type", "key", "value"};
            if (!fieldsMatch(context_, element.get(), elementFields, "Modifier 元素")) {
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
            // 回调字段的事件种类由修饰 schema 决定
            const auto eventKind = [schema = findModifierSchema(type)](std::string_view field) {
                return modifierCallbackKind(*schema, field);
            };

            const auto key = reader_.stringField(element.get(), "key");
            if (type == "padding") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = arrange::core::LayoutModifierKind::Padding;
                item.padding = readPadding(payload);
                if (failed_) return {};
                result.push_back({item, key});
            } else if (type == "intrinsicWidth" || type == "intrinsicHeight") {
                arrange::core::LayoutModifierSemantics item;
                item.kind = type == "intrinsicWidth" ? arrange::core::LayoutModifierKind::IntrinsicWidth : arrange::core::LayoutModifierKind::IntrinsicHeight;
                item.intrinsicMaximum = boolField(payload, "maximum", false);
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
                ScopedValue callback(context_, JS_GetPropertyStr(context_, payload, "onScroll"));
                if (!JS_IsFunction(context_, callback.get())) {
                    JS_ThrowTypeError(context_, "Arrange Modifier '%.*s' 的 onScroll 需要函数", static_cast<int>(type.size()), type.data());
                    return {};
                }
                item.scrollValue = numberField(payload, "value");
                item.enabled = boolField(payload, "enabled", true);
                callbacks.push_back({result.size(), eventKind("onScroll"), std::move(callback)});
                result.push_back({item, key});
            } else if (type == "animateContentSize") {
                arrange::core::AnimateContentSizeModifier item;
                ScopedValue spec(context_, JS_GetPropertyStr(context_, payload, "animationSpec"));
                if (!JS_IsObject(spec.get()) || JS_IsArray(spec.get())) {
                    (void)throwTypeError("animateContentSize 需要 animationSpec 对象");
                    return {};
                }
                const auto kind = requiredStringField(spec.get(), "kind", "animationSpec");
                const auto fields = kind == "tween" ? std::initializer_list<std::string_view>{"kind", "durationMillis", "delayMillis", "x1", "y1", "x2", "y2", "iterations", "repeatMode"} : kind == "spring" ? std::initializer_list<std::string_view>{"kind", "stiffness", "dampingRatio", "visibilityThreshold"} : std::initializer_list<std::string_view>{"kind", "delayMillis", "iterations", "repeatMode"};
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
                double iterations = 1;
                ScopedValue iterationValue(context_, JS_GetPropertyStr(context_, spec.get(), "iterations"));
                if (!JS_IsUndefined(iterationValue.get()) && (!JS_IsNumber(iterationValue.get()) || JS_ToFloat64(context_, &iterations, iterationValue.get()) < 0)) {
                    (void)throwTypeError("动画重复次数必须是数字");
                    return {};
                }
                if (!std::isfinite(iterations) || iterations < 1 || iterations > 2147483647.0 || std::floor(iterations) != iterations) {
                    (void)throwTypeError("动画重复次数必须是正整数");
                    return {};
                }
                input.iterations = static_cast<int>(iterations);
                const auto repeatMode = reader_.stringField(spec.get(), "repeatMode", "restart");
                if (repeatMode != "restart" && repeatMode != "reverse") {
                    (void)throwTypeError("动画重复模式未定义");
                    return {};
                }
                input.reverse = repeatMode == "reverse";
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
                if (!enumField(payload, "textAlign", arrange::core::parseTextAlign, text.textAlign) || !enumField(payload, "overflow", arrange::core::parseTextOverflow, text.overflow)) return {};

                const auto styleName = editable ? "textStyle" : "style";
                ScopedValue style(context_, JS_GetPropertyStr(context_, payload, styleName));
                if (!JS_IsUndefined(style.get())) {
                    if (!JS_IsObject(style.get()) || JS_IsArray(style.get()) || !fieldsMatch(context_, style.get(), {"fontSize", "lineHeight", "color"}, styleName)) {
                        (void)throwTypeError((std::string(styleName) + " 需要正式文本样式对象").c_str());
                        return {};
                    }
                    text.style.fontSize = numberField(style.get(), "fontSize", 14);
                    text.style.lineHeight = numberField(style.get(), "lineHeight", 0);
                    ScopedValue color(context_, JS_GetPropertyStr(context_, style.get(), "color"));
                    if (!JS_IsUndefined(color.get())) {
                        text.color = reader_.colorValue(color.get());
                        if (JS_HasException(context_)) {
                            failed_ = true;
                            return {};
                        }
                    }
                }
                if (editable) {
                    arrange::core::TextFieldModifier field;
                    field.value = text.text;
                    field.placeholder = reader_.stringField(payload, "placeholder");
                    field.presentation = std::move(text);
                    field.enabled = boolField(payload, "enabled", true);
                    field.selectAllOnFocus = boolField(payload, "selectAllOnFocus", false);
                    for (const auto* name : {"onValueChange", "onSubmit", "onChange", "onBlur"}) callbacks.push_back({result.size(), eventKind(name), ScopedValue(context_, JS_GetPropertyStr(context_, payload, name))});
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
                if (!enumField(payload, "contentScale", arrange::core::parseContentScale, item.contentScale) || !enumField(payload, "alignment", arrange::core::parseImageAlignment, item.alignment)) return {};
                ScopedValue filter(context_, JS_GetPropertyStr(context_, payload, "colorFilter"));
                if (!JS_IsUndefined(filter.get())) {
                    if (!JS_IsObject(filter.get()) || !fieldsMatch(context_, filter.get(), {"tint"}, "colorFilter")) {
                        failed_ = true;
                        return {};
                    }
                    ScopedValue tint(context_, JS_GetPropertyStr(context_, filter.get(), "tint"));
                    item.tint = reader_.colorValue(tint.get());
                    if (JS_HasException(context_)) {
                        failed_ = true;
                        return {};
                    }
                }
                result.push_back({item, key});
            } else if (type == "weight" || type == "align" || type == "matchParentSize") {
                arrange::core::ParentDataModifierSemantics item;
                if (type == "weight") {
                    item.weight = requiredNumberField(payload, "weight", type);
                    item.weightFill = boolField(payload, "fill", true);
                } else if (type == "align") {
                    item.kind = arrange::core::ParentDataKind::Align;
                    const auto name = requiredStringField(payload, "alignment", type);
                    item.align = arrange::core::parseLayoutAlignment(name);
                    if (!failed_ && !item.align) {
                        JS_ThrowTypeError(context_, "Arrange Modifier.align 不支持对齐值：'%s'", name.c_str());
                        failed_ = true;
                        return {};
                    }
                } else
                    item.kind = arrange::core::ParentDataKind::MatchParentSize;
                result.push_back({item, key});
            } else if (type == "offset" || type == "absoluteOffset") {
                result.push_back({arrange::core::OffsetModifier{numberField(payload, "x"), numberField(payload, "y")}, key});
            } else if (type == "drawBehind" || type == "drawWithContent" || type == "drawWithCache") {
                arrange::core::DrawModifier item;
                item.kind = type == "drawBehind" ? arrange::core::DrawModifierKind::Behind : type == "drawWithContent" ? arrange::core::DrawModifierKind::WithContent : arrange::core::DrawModifierKind::WithCache;
                ScopedValue revisionValue(context_, JS_GetPropertyStr(context_, payload, "revision"));
                if (!JS_IsUndefined(revisionValue.get()) && !JS_IsNumber(revisionValue.get())) {
                    (void)throwTypeError("绘制 revision 需要数值");
                    return {};
                }
                const auto revision = JS_IsUndefined(revisionValue.get()) ? 0.0 : reader_.toDouble(revisionValue.get());
                if (!std::isfinite(revision) || revision < 0 || std::floor(revision) != revision || revision > 9007199254740991.0) {
                    (void)throwTypeError("绘制 revision 需要非负安全整数");
                    return {};
                }
                item.revision = static_cast<std::uint64_t>(revision);
                item.transactional = boolField(payload, "transactional", false);
                ScopedValue callback(context_, JS_GetPropertyStr(context_, payload, "prepare"));
                if (!JS_IsFunction(context_, callback.get())) {
                    (void)throwTypeError("绘制 prepare 需要函数");
                    return {};
                }
                callbacks.push_back({result.size(), eventKind("prepare"), std::move(callback)});
                result.push_back({item, key});
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
            } else if (type == "semantics") {
                arrange::core::SemanticsModifier item;
                const auto role = reader_.stringField(payload, "role");
                constexpr std::string_view roles[]{"", "button", "slider", "switch", "checkbox", "textField", "image", "group"};
                const auto found = std::find(std::begin(roles), std::end(roles), role);
                if (found == std::end(roles)) {
                    (void)throwTypeError("semantics.role 角色名称无效");
                    return {};
                }
                item.role = static_cast<arrange::core::SemanticsRole>(found - std::begin(roles));
                item.label = reader_.stringField(payload, "label");
                item.description = reader_.stringField(payload, "description");
                item.valueText = reader_.stringField(payload, "valueText");
                item.enabled = boolField(payload, "enabled", true);
                for (const auto* name : {"increment", "decrement"}) {
                    ScopedValue action(context_, JS_GetPropertyStr(context_, payload, name));
                    if (JS_IsUndefined(action.get()) || JS_IsNull(action.get())) continue;
                    if (!JS_IsFunction(context_, action.get())) {
                        JS_ThrowTypeError(context_, "semantics.%s 需要函数", name);
                        return {};
                    }
                    callbacks.push_back({result.size(), eventKind(name), std::move(action)});
                }
                if (JS_HasException(context_)) return {};
                result.push_back({item, key});
            } else if (type == "focusRequester" || type == "focusProperties" || type == "focusGroup" || type == "onFocusChanged") {
                arrange::core::FocusModifier item;
                item.kind = type == "focusRequester" ? arrange::core::FocusModifierKind::Requester : type == "focusGroup" ? arrange::core::FocusModifierKind::Group : type == "onFocusChanged" ? arrange::core::FocusModifierKind::Observer : arrange::core::FocusModifierKind::Properties;
                const auto identity = [&](const char* name, bool required = false) -> std::uint32_t {
                    ScopedValue input(context_, JS_GetPropertyStr(context_, payload, name));
                    if (!required && JS_IsUndefined(input.get())) return 0;
                    double value = 0;
                    if (!JS_IsNumber(input.get()) || JS_ToFloat64(context_, &value, input.get()) < 0 || !std::isfinite(value) || std::floor(value) != value || value < (required ? 1 : 0) || value > static_cast<double>(UINT32_MAX)) {
                        (void)throwTypeError("焦点请求器身份必须是有效整数");
                        return 0;
                    }
                    return static_cast<std::uint32_t>(value);
                };
                if (item.kind == arrange::core::FocusModifierKind::Requester) item.requester = identity("requester", true);
                if (item.kind == arrange::core::FocusModifierKind::Properties) {
                    item.canFocus = boolField(payload, "canFocus", true);
                    constexpr const char* directions[]{"next", "previous", "up", "down", "left", "right"};
                    for (std::size_t i = 0; i < 6; ++i) item.directions[i] = identity(directions[i]);
                }
                if (JS_HasException(context_)) return {};
                if (item.kind == arrange::core::FocusModifierKind::Observer) {
                    ScopedValue callback(context_, JS_GetPropertyStr(context_, payload, "callback"));
                    if (!JS_IsFunction(context_, callback.get())) {
                        (void)throwTypeError("onFocusChanged 需要函数");
                        return {};
                    }
                    callbacks.push_back({result.size(), eventKind("callback"), std::move(callback)});
                }
                result.push_back({item, key});
            } else if (type == "clickable" || type == "hoverable" || type == "focusable" || type == "onContextClick" || type == "pointerIcon" || type == "onKeyEvent" || type == "onWheel" || type == "draggable" || type == "pointerInput") {
                using InputKind = arrange::core::InputModifierKind;
                arrange::core::InputModifierSemantics item;
                item.enabled = boolField(payload, "enabled", true);
                item.focusable = boolField(payload, "focusable", true);
                // 必填回调缺失时报错；可选回调为 undefined 时不登记槽位
                const auto callback = [&](const char* name, bool required) {
                    ScopedValue value(context_, JS_GetPropertyStr(context_, payload, name));
                    const auto present = !JS_IsUndefined(value.get()) && !JS_IsNull(value.get());
                    if ((required || present) && !JS_IsFunction(context_, value.get())) {
                        JS_ThrowTypeError(context_, "%.*s.%s 需要函数", static_cast<int>(type.size()), type.data(), name);
                        return false;
                    }
                    if (present) callbacks.push_back({result.size(), eventKind(name), std::move(value)});
                    return true;
                };
                const auto readAxis = [&] {
                    const auto axis = reader_.stringField(payload, "axis");
                    if (axis == "horizontal")
                        item.axis = arrange::core::DragAxis::Horizontal;
                    else if (axis == "vertical")
                        item.axis = arrange::core::DragAxis::Vertical;
                    else if (axis.empty() || axis == "both")
                        item.axis = arrange::core::DragAxis::Both;
                    else {
                        JS_ThrowTypeError(context_, "%.*s.axis 需要 horizontal、vertical 或 both", static_cast<int>(type.size()), type.data());
                        return false;
                    }
                    return true;
                };
                auto ok = true;
                if (type == "clickable")
                    ok = callback("onClick", true) && callback("onDoubleClick", false) && callback("interaction", false);
                else if (type == "hoverable") {
                    item.kind = InputKind::Hoverable;
                    ok = callback("onEnter", false) && callback("onExit", false) && callback("interaction", false);
                } else if (type == "focusable") {
                    item.kind = InputKind::Focusable;
                    ok = callback("interaction", false);
                } else if (type == "onContextClick") {
                    item.kind = InputKind::ContextClick;
                    ok = callback("callback", true);
                } else if (type == "onKeyEvent") {
                    item.kind = InputKind::KeyEvent;
                    ok = callback("callback", true);
                } else if (type == "pointerInput") {
                    item.kind = InputKind::PointerInput;
                    ok = callback("callback", true);
                } else if (type == "onWheel") {
                    item.kind = InputKind::Wheel;
                    ok = readAxis() && callback("callback", true);
                } else if (type == "pointerIcon") {
                    item.kind = InputKind::PointerIcon;
                    const auto icon = reader_.stringField(payload, "icon");
                    constexpr std::string_view icons[]{"default", "hand", "text", "crosshair", "resizeHorizontal", "resizeVertical", "grab", "grabbing", "none"};
                    const auto found = std::find(std::begin(icons), std::end(icons), icon);
                    if (found == std::end(icons)) {
                        (void)throwTypeError("pointerIcon 光标名称无效");
                        return {};
                    }
                    item.icon = static_cast<arrange::core::PointerIcon>(found - std::begin(icons));
                } else {
                    item.kind = InputKind::Draggable;
                    if (!readAxis()) {
                        failed_ = true;
                        return {};
                    }
                    item.startImmediately = boolField(payload, "startImmediately", false);
                    item.pointerLock = boolField(payload, "pointerLock", false);
                    ok = callback("onDelta", true) && callback("onStart", false) && callback("onStop", false) && callback("interaction", false);
                }
                if (!ok) {
                    failed_ = true;
                    return {};
                }
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
            if (auto* draw = std::get_if<arrange::core::DrawModifier>(&input))
                draw->prepare = slot;
            else if (auto* scroll = std::get_if<arrange::core::LayoutModifierSemantics>(&input))
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
            } else if (auto* focus = std::get_if<arrange::core::FocusModifier>(&input))
                focus->eventSlot = slot;
            else if (auto* semantics = std::get_if<arrange::core::SemanticsModifier>(&input))
                (pending.kind == arrange::core::EventSlotKind::SemanticsDecrement ? semantics->decrement : semantics->increment) = slot;
            else
                arrange::core::inputEventSlot(std::get<arrange::core::InputModifierSemantics>(input), pending.kind) = slot;
            if (slot.valid()) retained.push_back(slot);
        }
        if (!instanceInput) events_.releaseModifierCallbacksExcept(id, retained, transaction_);
        return result;
    }
}

#endif
