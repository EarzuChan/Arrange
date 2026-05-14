#include "QuickJsValueReader.h"

#if ARRANGE_WITH_QUICKJS_NG

#include <utility>
#include <vector>

namespace arrange::quickjs {
    ScopedValue::~ScopedValue() {
        if (ctx_ != nullptr) JS_FreeValue(ctx_, value_);
    }

    ScopedValue::ScopedValue(ScopedValue&& other) noexcept
        : ctx_(other.ctx_), value_(other.value_) {
        other.ctx_ = nullptr;
        other.value_ = JS_UNDEFINED;
    }

    ScopedValue& ScopedValue::operator=(ScopedValue&& other) noexcept {
        if (this == &other) return *this;
        if (ctx_ != nullptr) JS_FreeValue(ctx_, value_);
        ctx_ = other.ctx_;
        value_ = other.value_;
        other.ctx_ = nullptr;
        other.value_ = JS_UNDEFINED;
        return *this;
    }

    JSValue ScopedValue::release() noexcept {
        auto value = value_;
        value_ = JS_UNDEFINED;
        return value;
    }

    std::string QuickJsValueReader::toString(JSValueConst value) const {
        const char* text = JS_ToCString(context_, value);
        if (text == nullptr) return {};
        std::string result(text);
        JS_FreeCString(context_, text);
        return result;
    }

    std::uint32_t QuickJsValueReader::toU32(JSValueConst value) const {
        std::uint32_t result = 0;
        JS_ToUint32(context_, &result, value);
        return result;
    }

    double QuickJsValueReader::toDouble(JSValueConst value, double fallback) const {
        double result = fallback;
        JS_ToFloat64(context_, &result, value);
        return result;
    }

    bool QuickJsValueReader::toBool(JSValueConst value, bool fallback) const {
        return JS_IsUndefined(value) || JS_IsNull(value) ? fallback : JS_ToBool(context_, value) != 0;
    }

    std::uint32_t QuickJsValueReader::arrayLength(JSValueConst value) const {
        ScopedValue length(context_, JS_GetPropertyStr(context_, value, "length"));
        return toU32(length.get());
    }

    arrange::core::PropValue QuickJsValueReader::propValue(JSValueConst value, int depth) const {
        if (depth > 8 || JS_IsUndefined(value) || JS_IsNull(value) || JS_IsFunction(context_, value)) return arrange::core::PropValue::nullValue();
        if (JS_IsBool(value)) return arrange::core::PropValue::booleanValue(JS_ToBool(context_, value) != 0);
        if (JS_IsNumber(value)) return arrange::core::PropValue::numberValue(toDouble(value));
        if (JS_IsString(value)) return arrange::core::PropValue::stringValue(toString(value));
        if (!JS_IsObject(value) || JS_IsArray(value)) return arrange::core::PropValue::nullValue();

        JSPropertyEnum* props = nullptr;
        std::uint32_t count = 0;
        std::vector<arrange::core::PropObjectField> fields;
        if (JS_GetOwnPropertyNames(context_, &props, &count, value, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) return arrange::core::PropValue::nullValue();
        fields.reserve(count);
        for (std::uint32_t i = 0; i < count; ++i) {
            const char* name = JS_AtomToCString(context_, props[i].atom);
            if (name == nullptr) continue;
            ScopedValue child(context_, JS_GetProperty(context_, value, props[i].atom));
            fields.push_back({name, propValue(child.get(), depth + 1)});
            JS_FreeCString(context_, name);
        }
        for (std::uint32_t i = 0; i < count; ++i) JS_FreeAtom(context_, props[i].atom);
        js_free(context_, props);
        return arrange::core::PropValue::objectValue(std::move(fields));
    }

    bool QuickJsValueReader::hasOwnField(JSValueConst object, const char* key) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        return !JS_IsUndefined(value.get()) && !JS_IsNull(value.get());
    }

    ScopedValue QuickJsValueReader::field(JSValueConst object, const char* key) const {
        return ScopedValue(context_, JS_GetPropertyStr(context_, object, key));
    }

    float QuickJsValueReader::numberField(JSValueConst object, const char* key, float fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        return JS_IsUndefined(value.get()) || JS_IsNull(value.get()) ? fallback : static_cast<float>(toDouble(value.get(), fallback));
    }

    float QuickJsValueReader::requiredNumberField(JSValueConst object, const char* key, std::string_view owner) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get()) || JS_IsNull(value.get())) {
            JS_ThrowTypeError(context_, "Arrange %.*s requires numeric field '%s'", static_cast<int>(owner.size()), owner.data(), key);
            return 0.0f;
        }
        if (!JS_IsNumber(value.get())) {
            JS_ThrowTypeError(context_, "Arrange %.*s field '%s' must be a number", static_cast<int>(owner.size()), owner.data(), key);
            return 0.0f;
        }
        return static_cast<float>(toDouble(value.get()));
    }

    bool QuickJsValueReader::boolField(JSValueConst object, const char* key, bool fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        return toBool(value.get(), fallback);
    }

    std::string QuickJsValueReader::stringField(JSValueConst object, const char* key, std::string_view fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        return JS_IsUndefined(value.get()) || JS_IsNull(value.get()) ? std::string(fallback) : toString(value.get());
    }

    std::string QuickJsValueReader::requiredStringField(JSValueConst object, const char* key, std::string_view owner) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        if (JS_IsUndefined(value.get()) || JS_IsNull(value.get())) {
            JS_ThrowTypeError(context_, "Arrange %.*s requires string field '%s'", static_cast<int>(owner.size()), owner.data(), key);
            return {};
        }
        if (!JS_IsString(value.get())) {
            JS_ThrowTypeError(context_, "Arrange %.*s field '%s' must be a string", static_cast<int>(owner.size()), owner.data(), key);
            return {};
        }
        return toString(value.get());
    }

    std::uint32_t QuickJsValueReader::colorField(JSValueConst object, const char* key, std::uint32_t fallback) const {
        ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
        return JS_IsUndefined(value.get()) || JS_IsNull(value.get()) ? fallback : toU32(value.get());
    }

    std::string quickJsExceptionText(JSContext* context) {
        QuickJsValueReader reader(context);
        ScopedValue exception(context, JS_GetException(context));
        std::string result = reader.toString(exception.get());
        ScopedValue stack(context, JS_GetPropertyStr(context, exception.get(), "stack"));
        if (!JS_IsUndefined(stack.get())) {
            const auto stackText = reader.toString(stack.get());
            if (!stackText.empty()) result += "\n" + stackText;
        }
        return result.empty() ? "QuickJS exception" : result;
    }
}

#endif
