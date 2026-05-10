#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>

namespace arrange::core {
    struct ArrangeNode;

    enum class EncodedPropKind {
        Unknown,
        Undefined,
        Null,
        Number,
        Boolean,
        String,
        Object,
        Handle,
    };

    class EncodedProp {
    public:
        EncodedProp() = default;
        explicit EncodedProp(std::string raw);

        EncodedPropKind kind() const noexcept { return kind_; }
        const std::string& raw() const noexcept { return raw_; }
        std::string body() const;
        std::string stringValue(std::string_view fallback = {}) const;
        float floatValue(float fallback = 0.0f) const;
        int intValue(int fallback = 0) const;
        bool boolValue(bool fallback = false) const;
        std::uint32_t handleValue(std::uint32_t fallback = 0) const;
        std::uint32_t uint32Value(std::uint32_t fallback = 0) const;
        std::string jsonLiteral() const;

    private:
        std::string raw_;
        EncodedPropKind kind_ = EncodedPropKind::Unknown;
    };

    class PropObject {
    public:
        PropObject() = default;
        explicit PropObject(std::unordered_map<std::string, EncodedProp> fields);

        bool has(std::string_view key) const;
        EncodedProp prop(std::string_view key) const;
        float number(std::string_view key, float fallback = 0.0f) const;
        int integer(std::string_view key, int fallback = 0) const;
        bool boolean(std::string_view key, bool fallback = false) const;
        std::string string(std::string_view key, std::string_view fallback = {}) const;
        std::uint32_t handle(std::string_view key, std::uint32_t fallback = 0) const;
        std::uint32_t color(std::string_view key, std::uint32_t fallback = 0) const;

    private:
        std::unordered_map<std::string, EncodedProp> fields_;
    };

    std::string kebabCase(std::string_view key);
    std::string propValue(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase = {});
    bool hasProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase = {});
    EncodedProp encodedProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase = {});
    PropObject objectProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase = {});
    PropObject objectFromEncodedProp(const EncodedProp& prop);

    std::string decodeStringProp(std::string_view value, std::string_view fallback = {});
    float encodedNumberProp(const ArrangeNode& node, std::string_view key, float fallback = 0.0f);
    int encodedIntProp(const ArrangeNode& node, std::string_view key, int fallback = 0);
    bool encodedBoolProp(const ArrangeNode& node, std::string_view key, bool fallback = false);
    std::uint32_t encodedHandleProp(const ArrangeNode& node, std::string_view key, std::uint32_t fallback = 0);
    std::uint32_t encodedColorProp(const ArrangeNode& node, std::string_view key, std::uint32_t fallback = 0);

    std::string jsonEscape(std::string_view text);
} // namespace arrange::core
