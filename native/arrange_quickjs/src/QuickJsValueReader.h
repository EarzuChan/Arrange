#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <arrange/core/PropValue.h>

#include <cstdint>
#include <string>
#include <string_view>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    class ScopedValue {
    public:
        ScopedValue(JSContext* ctx, JSValue value) : ctx_(ctx), value_(value) {}
        ~ScopedValue();

        ScopedValue(const ScopedValue&) = delete;
        ScopedValue& operator=(const ScopedValue&) = delete;

        ScopedValue(ScopedValue&& other) noexcept;
        ScopedValue& operator=(ScopedValue&& other) noexcept;

        [[nodiscard]] JSValueConst get() const noexcept { return value_; }
        [[nodiscard]] JSValue release() noexcept;

    private:
        JSContext* ctx_ = nullptr;
        JSValue value_ = JS_UNDEFINED;
    };

    class QuickJsValueReader {
    public:
        explicit QuickJsValueReader(JSContext* context) : context_(context) {}

        [[nodiscard]] JSContext* context() const noexcept { return context_; }
        [[nodiscard]] std::string toString(JSValueConst value) const;
        [[nodiscard]] std::uint32_t toU32(JSValueConst value) const;
        [[nodiscard]] double toDouble(JSValueConst value, double fallback = 0.0) const;
        [[nodiscard]] bool toBool(JSValueConst value, bool fallback = false) const;
        [[nodiscard]] std::uint32_t arrayLength(JSValueConst value) const;
        [[nodiscard]] arrange::core::PropValue propValue(JSValueConst value, int depth = 0) const;

        [[nodiscard]] bool hasOwnField(JSValueConst object, const char* key) const;
        [[nodiscard]] ScopedValue field(JSValueConst object, const char* key) const;
        [[nodiscard]] float numberField(JSValueConst object, const char* key, float fallback = 0.0f) const;
        [[nodiscard]] float requiredNumberField(JSValueConst object, const char* key, std::string_view owner) const;
        [[nodiscard]] bool boolField(JSValueConst object, const char* key, bool fallback = false) const;
        [[nodiscard]] std::string stringField(JSValueConst object, const char* key, std::string_view fallback = {}) const;
        [[nodiscard]] std::string requiredStringField(JSValueConst object, const char* key, std::string_view owner) const;
        [[nodiscard]] std::uint32_t colorField(JSValueConst object, const char* key, std::uint32_t fallback = 0) const;

    private:
        JSContext* context_ = nullptr;
    };

    [[nodiscard]] std::string quickJsExceptionText(JSContext* context);
}

#endif
