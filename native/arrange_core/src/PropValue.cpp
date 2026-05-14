#include <arrange/core/PropValue.h>
#include <arrange/core/Node.h>

#include <utility>

namespace arrange::core {
    namespace {
        std::string toString(std::string_view value) { return {value.data(), value.size()}; }
    }

    PropValue PropValue::nullValue() { return {}; }

    PropValue PropValue::numberValue(double value) {
        PropValue result;
        result.kind = PropValueKind::Number;
        result.number = value;
        return result;
    }

    PropValue PropValue::booleanValue(bool value) {
        PropValue result;
        result.kind = PropValueKind::Boolean;
        result.boolean = value;
        return result;
    }

    PropValue PropValue::stringValue(std::string value) {
        PropValue result;
        result.kind = PropValueKind::String;
        result.string = std::move(value);
        return result;
    }

    PropValue PropValue::objectValue(std::vector<PropObjectField> fields) {
        PropValue result;
        result.kind = PropValueKind::Object;
        result.fields = std::move(fields);
        return result;
    }

    const PropValue* PropValue::field(std::string_view key) const noexcept {
        if (kind != PropValueKind::Object) return nullptr;
        for (const auto& item : fields) {
            if (item.key == key) return &item.value;
        }
        return nullptr;
    }

    std::string PropValue::stringOr(std::string_view fallback) const {
        return kind == PropValueKind::String ? string : toString(fallback);
    }

    float PropValue::numberOr(float fallback) const noexcept {
        if (kind == PropValueKind::Number) return static_cast<float>(number);
        return fallback;
    }

    int PropValue::intOr(int fallback) const noexcept { return static_cast<int>(numberOr(static_cast<float>(fallback))); }

    bool PropValue::boolOr(bool fallback) const noexcept {
        if (kind == PropValueKind::Boolean) return boolean;
        return fallback;
    }

    std::uint32_t PropValue::uint32Or(std::uint32_t fallback) const noexcept {
        if (kind == PropValueKind::Number) return static_cast<std::uint32_t>(number);
        return fallback;
    }

    bool PropObject::has(std::string_view key) const noexcept { return prop(key) != nullptr; }
    const PropValue* PropObject::prop(std::string_view key) const noexcept { return value_ == nullptr ? nullptr : value_->field(key); }
    float PropObject::number(std::string_view key, float fallback) const noexcept { const auto* value = prop(key); return value == nullptr ? fallback : value->numberOr(fallback); }
    int PropObject::integer(std::string_view key, int fallback) const noexcept { const auto* value = prop(key); return value == nullptr ? fallback : value->intOr(fallback); }
    bool PropObject::boolean(std::string_view key, bool fallback) const noexcept { const auto* value = prop(key); return value == nullptr ? fallback : value->boolOr(fallback); }
    std::string PropObject::string(std::string_view key, std::string_view fallback) const { const auto* value = prop(key); return value == nullptr ? toString(fallback) : value->stringOr(fallback); }
    std::uint32_t PropObject::color(std::string_view key, std::uint32_t fallback) const noexcept { const auto* value = prop(key); return value == nullptr ? fallback : value->uint32Or(fallback); }

    std::string kebabCase(std::string_view key) {
        std::string result;
        for (char ch : key) {
            if (ch >= 'A' && ch <= 'Z') {
                result.push_back('-');
                result.push_back(static_cast<char>(ch - 'A' + 'a'));
            }
            else { result.push_back(ch); }
        }
        return result;
    }

    const PropValue* propValue(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab) {
        if (const auto it = node.props.find(toString(camelCase)); it != node.props.end()) return &it->second;
        if (!kebab.empty()) {
            if (const auto it = node.props.find(toString(kebab)); it != node.props.end()) return &it->second;
        }
        if (!camelCase.empty()) {
            const auto generatedKebab = kebabCase(camelCase);
            if (generatedKebab != camelCase) {
                if (const auto it = node.props.find(generatedKebab); it != node.props.end()) return &it->second;
            }
        }
        return nullptr;
    }

    bool hasProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab) { return propValue(node, camelCase, kebab) != nullptr; }
    PropObject objectProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab) { return PropObject(propValue(node, camelCase, kebab)); }

    std::string stringProp(const ArrangeNode& node, std::string_view key, std::string_view fallback) {
        const auto* value = propValue(node, key);
        return value == nullptr ? toString(fallback) : value->stringOr(fallback);
    }

    std::string stringProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab, std::string_view fallback) {
        const auto* value = propValue(node, camelCase, kebab);
        return value == nullptr ? toString(fallback) : value->stringOr(fallback);
    }

    float numberProp(const ArrangeNode& node, std::string_view key, float fallback) {
        const auto* value = propValue(node, key);
        return value == nullptr ? fallback : value->numberOr(fallback);
    }

    int intProp(const ArrangeNode& node, std::string_view key, int fallback) {
        const auto* value = propValue(node, key);
        return value == nullptr ? fallback : value->intOr(fallback);
    }

    bool boolProp(const ArrangeNode& node, std::string_view key, bool fallback) {
        const auto* value = propValue(node, key);
        return value == nullptr ? fallback : value->boolOr(fallback);
    }

    std::uint32_t colorProp(const ArrangeNode& node, std::string_view key, std::uint32_t fallback) {
        const auto* value = propValue(node, key);
        return value == nullptr ? fallback : value->uint32Or(fallback);
    }
} // namespace arrange::core
