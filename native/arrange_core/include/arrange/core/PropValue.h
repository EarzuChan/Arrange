#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace arrange::core {
    struct ArrangeNode;

    enum class PropValueKind {
        Null,
        Number,
        Boolean,
        String,
        Object,
    };

    struct PropObjectField;

    struct PropValue {
        PropValueKind kind = PropValueKind::Null;
        double number = 0.0;
        bool boolean = false;
        std::string string;
        std::vector<PropObjectField> fields;

        [[nodiscard]] static PropValue nullValue();
        [[nodiscard]] static PropValue numberValue(double value);
        [[nodiscard]] static PropValue booleanValue(bool value);
        [[nodiscard]] static PropValue stringValue(std::string value);
        [[nodiscard]] static PropValue objectValue(std::vector<PropObjectField> fields);

        [[nodiscard]] bool isNull() const noexcept { return kind == PropValueKind::Null; }
        [[nodiscard]] bool isNumber() const noexcept { return kind == PropValueKind::Number; }
        [[nodiscard]] bool isBoolean() const noexcept { return kind == PropValueKind::Boolean; }
        [[nodiscard]] bool isString() const noexcept { return kind == PropValueKind::String; }
        [[nodiscard]] bool isObject() const noexcept { return kind == PropValueKind::Object; }
        [[nodiscard]] const PropValue* field(std::string_view key) const noexcept;
        [[nodiscard]] bool hasField(std::string_view key) const noexcept { return field(key) != nullptr; }

        [[nodiscard]] std::string stringOr(std::string_view fallback = {}) const;
        [[nodiscard]] float numberOr(float fallback = 0.0f) const noexcept;
        [[nodiscard]] int intOr(int fallback = 0) const noexcept;
        [[nodiscard]] bool boolOr(bool fallback = false) const noexcept;
        [[nodiscard]] std::uint32_t uint32Or(std::uint32_t fallback = 0) const noexcept;
    };

    struct PropObjectField {
        std::string key;
        PropValue value;
    };

    class PropObject {
    public:
        PropObject() = default;
        explicit PropObject(const PropValue* value) : value_(value) {}

        [[nodiscard]] bool has(std::string_view key) const noexcept;
        [[nodiscard]] const PropValue* prop(std::string_view key) const noexcept;
        [[nodiscard]] float number(std::string_view key, float fallback = 0.0f) const noexcept;
        [[nodiscard]] int integer(std::string_view key, int fallback = 0) const noexcept;
        [[nodiscard]] bool boolean(std::string_view key, bool fallback = false) const noexcept;
        [[nodiscard]] std::string string(std::string_view key, std::string_view fallback = {}) const;
        [[nodiscard]] std::uint32_t color(std::string_view key, std::uint32_t fallback = 0) const noexcept;

    private:
        const PropValue* value_ = nullptr;
    };

    std::string kebabCase(std::string_view key);
    const PropValue* propValue(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase = {});
    bool hasProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase = {});
    PropObject objectProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase = {});

    std::string stringProp(const ArrangeNode& node, std::string_view key, std::string_view fallback = {});
    std::string stringProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebabCase, std::string_view fallback);
    float numberProp(const ArrangeNode& node, std::string_view key, float fallback = 0.0f);
    int intProp(const ArrangeNode& node, std::string_view key, int fallback = 0);
    bool boolProp(const ArrangeNode& node, std::string_view key, bool fallback = false);
    std::uint32_t colorProp(const ArrangeNode& node, std::string_view key, std::uint32_t fallback = 0);
} // namespace arrange::core
