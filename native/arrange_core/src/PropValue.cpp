#include <arrange/core/PropValue.h>
#include <arrange/core/Node.h>

#include <algorithm>
#include <charconv>
#include <cstdlib>
#include <cctype>

namespace arrange::core {
    namespace {
        std::string toString(std::string_view value) { return {value.data(), value.size()}; }

        EncodedPropKind kindForRaw(std::string_view raw) noexcept {
            if (raw.starts_with("u:")) return EncodedPropKind::Undefined;
            if (raw.starts_with("n:")) return EncodedPropKind::Null;
            if (raw.starts_with("f:")) return EncodedPropKind::Number;
            if (raw.starts_with("b:")) return EncodedPropKind::Boolean;
            if (raw.starts_with("s:")) return EncodedPropKind::String;
            if (raw.starts_with("o:")) return EncodedPropKind::Object;
            if (raw.starts_with("h:")) return EncodedPropKind::Handle;
            return EncodedPropKind::Unknown;
        }

        std::string stripNumericPrefix(std::string value) {
            if (value.starts_with("f:") || value.starts_with("s:") || value.starts_with("h:")) return value.substr(2);
            return value;
        }

        void skipWhitespace(std::string_view text, std::size_t& pos) { while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos; }

        std::string parseJsonString(std::string_view text, std::size_t& pos) {
            std::string result;
            if (pos >= text.size() || text[pos] != '"') return result;
            ++pos;
            bool escaping = false;
            for (; pos < text.size(); ++pos) {
                const auto ch = text[pos];
                if (escaping) {
                    result.push_back(ch);
                    escaping = false;
                    continue;
                }
                if (ch == '\\') {
                    escaping = true;
                    continue;
                }
                if (ch == '"') {
                    ++pos;
                    break;
                }
                result.push_back(ch);
            }
            return result;
        }

        std::string encodedJsonPrimitive(std::string_view text, std::size_t& pos) {
            skipWhitespace(text, pos);
            if (pos >= text.size()) return {};
            if (text[pos] == '"') return "s:" + parseJsonString(text, pos);
            const auto start = pos;
            while (pos < text.size() && text[pos] != ',' && text[pos] != '}') ++pos;
            auto value = text.substr(start, pos - start);
            while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.remove_suffix(1);
            if (value == "true") return "b:1";
            if (value == "false") return "b:0";
            if (value == "null") return "n:";
            return "f:" + toString(value);
        }

        void parseJsonObjectFields(std::string_view text, std::size_t& pos, std::string prefix, std::unordered_map<std::string, EncodedProp>& fields) {
            skipWhitespace(text, pos);
            if (pos >= text.size() || text[pos] != '{') return;
            ++pos;
            while (pos < text.size()) {
                skipWhitespace(text, pos);
                if (pos < text.size() && text[pos] == '}') {
                    ++pos;
                    return;
                }
                const auto key = parseJsonString(text, pos);
                skipWhitespace(text, pos);
                if (pos >= text.size() || text[pos] != ':') return;
                ++pos;
                skipWhitespace(text, pos);
                const auto path = prefix.empty() ? key : prefix + "." + key;
                if (pos < text.size() && text[pos] == '{') { parseJsonObjectFields(text, pos, path, fields); }
                else { fields.emplace(path, EncodedProp(encodedJsonPrimitive(text, pos))); }
                skipWhitespace(text, pos);
                if (pos < text.size() && text[pos] == ',') {
                    ++pos;
                    continue;
                }
            }
        }
    } // namespace

    EncodedProp::EncodedProp(std::string raw) : raw_(std::move(raw)), kind_(kindForRaw(raw_)) {}

    std::string EncodedProp::body() const { return raw_.size() >= 2 && raw_[1] == ':' ? raw_.substr(2) : raw_; }

    std::string EncodedProp::stringValue(std::string_view fallback) const {
        if (kind_ == EncodedPropKind::String || kind_ == EncodedPropKind::Number || kind_ == EncodedPropKind::Handle) return body();
        if (kind_ == EncodedPropKind::Object && body().starts_with("\"") && body().ends_with("\"")) {
            const auto value = body();
            return value.size() > 1 ? value.substr(1, value.size() - 2) : "";
        }
        if (kind_ == EncodedPropKind::Unknown) return raw_.empty() ? toString(fallback) : raw_;
        return toString(fallback);
    }

    float EncodedProp::floatValue(float fallback) const {
        auto value = stripNumericPrefix(raw_);
        if (kind_ == EncodedPropKind::Boolean) value = body() == "1" || body() == "true" ? "1" : "0";
        char* end = nullptr;
        const auto parsed = std::strtof(value.c_str(), &end);
        return end == value.c_str() ? fallback : parsed;
    }

    int EncodedProp::intValue(int fallback) const { return static_cast<int>(floatValue(static_cast<float>(fallback))); }

    bool EncodedProp::boolValue(bool fallback) const {
        auto value = body();
        if (kind_ == EncodedPropKind::Boolean) return value != "0" && value != "false";
        if (kind_ == EncodedPropKind::Number || kind_ == EncodedPropKind::String || kind_ == EncodedPropKind::Unknown) {
            if (value == "true" || value == "1") return true;
            if (value == "false" || value == "0") return false;
        }
        return fallback;
    }

    std::uint32_t EncodedProp::handleValue(std::uint32_t fallback) const {
        auto value = body();
        char* end = nullptr;
        const auto parsed = std::strtoul(value.c_str(), &end, 10);
        return end == value.c_str() ? fallback : static_cast<std::uint32_t>(parsed);
    }

    std::uint32_t EncodedProp::uint32Value(std::uint32_t fallback) const {
        auto value = stripNumericPrefix(raw_);
        char* end = nullptr;
        const auto parsed = std::strtoul(value.c_str(), &end, 10);
        return end == value.c_str() ? fallback : static_cast<std::uint32_t>(parsed);
    }

    std::string EncodedProp::jsonLiteral() const {
        switch (kind_) {
        case EncodedPropKind::Undefined:
        case EncodedPropKind::Null:
            return "null";
        case EncodedPropKind::Number:
        case EncodedPropKind::Handle:
            return body();
        case EncodedPropKind::Boolean:
            return boolValue(false) ? "true" : "false";
        case EncodedPropKind::String:
            return "\"" + jsonEscape(body()) + "\"";
        case EncodedPropKind::Object:
            return body().empty() ? "null" : body();
        case EncodedPropKind::Unknown:
            return "\"" + jsonEscape(raw_) + "\"";
        }
        return "null";
    }

    PropObject::PropObject(std::unordered_map<std::string, EncodedProp> fields) : fields_(std::move(fields)) {}

    bool PropObject::has(std::string_view key) const { return fields_.find(toString(key)) != fields_.end(); }

    EncodedProp PropObject::prop(std::string_view key) const {
        if (const auto it = fields_.find(toString(key)); it != fields_.end()) return it->second;
        return {};
    }

    float PropObject::number(std::string_view key, float fallback) const { return prop(key).floatValue(fallback); }

    int PropObject::integer(std::string_view key, int fallback) const { return prop(key).intValue(fallback); }

    bool PropObject::boolean(std::string_view key, bool fallback) const { return prop(key).boolValue(fallback); }

    std::string PropObject::string(std::string_view key, std::string_view fallback) const { return prop(key).stringValue(fallback); }

    std::uint32_t PropObject::handle(std::string_view key, std::uint32_t fallback) const { return prop(key).handleValue(fallback); }

    std::uint32_t PropObject::color(std::string_view key, std::uint32_t fallback) const { return prop(key).uint32Value(fallback); }

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

    std::string propValue(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab) {
        if (const auto it = node.props.find(toString(camelCase)); it != node.props.end()) return it->second;
        if (!kebab.empty()) { if (const auto it = node.props.find(toString(kebab)); it != node.props.end()) return it->second; }
        if (!camelCase.empty()) {
            const auto generatedKebab = kebabCase(camelCase);
            if (generatedKebab != camelCase) { if (const auto it = node.props.find(generatedKebab); it != node.props.end()) return it->second; }
        }
        return {};
    }

    bool hasProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab) { return !propValue(node, camelCase, kebab).empty(); }

    EncodedProp encodedProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab) { return EncodedProp(propValue(node, camelCase, kebab)); }

    PropObject objectFromEncodedProp(const EncodedProp& prop) {
        std::unordered_map<std::string, EncodedProp> fields;
        auto body = prop.body();
        std::size_t pos = 0;
        parseJsonObjectFields(body, pos, {}, fields);
        return PropObject(std::move(fields));
    }

    PropObject objectProp(const ArrangeNode& node, std::string_view camelCase, std::string_view kebab) { return objectFromEncodedProp(encodedProp(node, camelCase, kebab)); }

    std::string decodeStringProp(std::string_view value, std::string_view fallback) {
        if (value.empty()) return toString(fallback);
        return EncodedProp(toString(value)).stringValue(fallback);
    }

    float encodedNumberProp(const ArrangeNode& node, std::string_view key, float fallback) { return encodedProp(node, key).floatValue(fallback); }

    int encodedIntProp(const ArrangeNode& node, std::string_view key, int fallback) { return encodedProp(node, key).intValue(fallback); }

    bool encodedBoolProp(const ArrangeNode& node, std::string_view key, bool fallback) { return encodedProp(node, key).boolValue(fallback); }

    std::uint32_t encodedHandleProp(const ArrangeNode& node, std::string_view key, std::uint32_t fallback) { return encodedProp(node, key).handleValue(fallback); }

    std::uint32_t encodedColorProp(const ArrangeNode& node, std::string_view key, std::uint32_t fallback) { return encodedProp(node, key).uint32Value(fallback); }

    std::string jsonEscape(std::string_view text) {
        std::string escaped;
        for (char ch : text) {
            switch (ch) {
            case '\\':
                escaped += "\\\\";
                break;
            case '"':
                escaped += "\\\"";
                break;
            case '\n':
                escaped += "\\n";
                break;
            case '\r':
                escaped += "\\r";
                break;
            case '\t':
                escaped += "\\t";
                break;
            default:
                escaped.push_back(ch);
                break;
            }
        }
        return escaped;
    }
} // namespace arrange::core
