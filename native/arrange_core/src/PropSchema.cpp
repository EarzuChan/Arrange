#include <arrange/core/PropSchema.h>

#include <arrange/core/PropValue.h>

#include <algorithm>
#include <cctype>
#include <string_view>
#include <unordered_set>

namespace arrange::core {
    namespace {
        std::string canonicalKey(std::string_view key) {
            std::string result;
            result.reserve(key.size());
            bool uppercaseNext = false;
            for (char ch : key) {
                if (ch == '-') {
                    uppercaseNext = true;
                    continue;
                }
                if (uppercaseNext) {
                    result.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
                    uppercaseNext = false;
                }
                else {
                    result.push_back(ch);
                }
            }
            return result;
        }

        bool isOneOf(std::string_view key, std::initializer_list<std::string_view> allowed) {
            return std::find(allowed.begin(), allowed.end(), key) != allowed.end();
        }

        bool isStringEnum(const PropValue& value, std::initializer_list<std::string_view> allowed) {
            return value.isString() && isOneOf(value.string, allowed);
        }

        bool isNodeTypeWithChildren(NodeType type) noexcept {
            switch (type) {
            case NodeType::Box:
            case NodeType::Row:
            case NodeType::Column:
            case NodeType::Canvas:
            case NodeType::Unknown:
                return true;
            case NodeType::Spacer:
            case NodeType::Text:
            case NodeType::Input:
            case NodeType::Image:
            case NodeType::Icon:
                return false;
            }
            return false;
        }

        bool validateTextStyle(const PropValue& value, std::string& error) {
            const auto fieldKey = [](std::string_view key) {
                return canonicalKey(key);
            };
            if (!value.isObject()) {
                error = "textStyle must be an object";
                return false;
            }
            for (const auto& field : value.fields) {
                const auto key = fieldKey(field.key);
                if (key == "fontSize" || key == "lineHeight" || key == "color") {
                    if (!field.value.isNumber()) {
                        error = "textStyle." + key + " must be a number";
                        return false;
                    }
                    continue;
                }
                if (key == "fontWeight" || key == "fontFamily") {
                    if (!field.value.isString()) {
                        error = "textStyle." + key + " must be a string";
                        return false;
                    }
                    continue;
                }
                error = "textStyle contains unsupported field '" + field.key + "'";
                return false;
            }
            return true;
        }

        bool validateArrangement(const PropValue& value, std::string_view key, std::string& error) {
            const auto field = [&](std::string_view fieldKey) -> const PropValue* {
                if (!value.isObject()) return nullptr;
                if (const auto* exact = value.field(fieldKey)) return exact;
                const auto canonicalFieldKey = canonicalKey(fieldKey);
                for (const auto& item : value.fields) {
                    if (canonicalKey(item.key) == canonicalFieldKey) return &item.value;
                }
                return nullptr;
            };
            if (value.isString()) {
                if (isOneOf(value.string, {"Start", "Top", "Center", "End", "Bottom", "SpaceBetween", "SpaceAround", "SpaceEvenly"})) return true;
                error = std::string(key) + " string value is not a supported Arrangement";
                return false;
            }
            if (!value.isObject()) {
                error = std::string(key) + " must be an Arrangement string or Arrangement.spacedBy object";
                return false;
            }
            const auto kind = field("kind");
            if (kind == nullptr || !kind->isString() || kind->string != "spacedBy") {
                error = std::string(key) + " object must be Arrangement.spacedBy({ kind: 'spacedBy', space })";
                return false;
            }
            const auto space = field("space");
            if (space == nullptr || !space->isNumber()) {
                error = std::string(key) + ".space must be a number";
                return false;
            }
            if (const auto alignment = field("alignment"); alignment != nullptr && !alignment->isString() && !alignment->isNull()) {
                error = std::string(key) + ".alignment must be a string when present";
                return false;
            }
            for (const auto& field : value.fields) {
                const auto fieldKey = canonicalKey(field.key);
                if (fieldKey != "kind" && fieldKey != "space" && fieldKey != "alignment") {
                    error = std::string(key) + " contains unsupported field '" + field.key + "'";
                    return false;
                }
            }
            return true;
        }

        bool validateAccessibility(std::string_view key, const PropValue& value, std::string& error) {
            if (key == "contentDescription" || key == "label" || key == "description" || key == "role") {
                if (value.isString()) return true;
                error = std::string(key) + " must be a string";
                return false;
            }
            if (key == "enabled") {
                if (value.isBoolean()) return true;
                error = "enabled must be a boolean";
                return false;
            }
            return false;
        }

        bool validateResourceRef(const PropValue& value, std::string_view key, std::string& error) {
            if (value.isString()) {
                if (value.string.empty()) {
                    error = std::string(key) + " must not be empty";
                    return false;
                }
                return true;
            }
            if (value.isObject()) {
                const auto path = value.field("path");
                const auto url = value.field("url");
                const auto hasPath = path != nullptr;
                const auto hasUrl = url != nullptr;
                if (hasPath == hasUrl) {
                    error = std::string(key) + " ResourceRef must contain exactly one of path or url";
                    return false;
                }
                const auto* resource = hasPath ? path : url;
                if (!resource->isString()) {
                    error = std::string(key) + " ResourceRef path/url must be a string";
                    return false;
                }
                if (resource->string.empty()) {
                    error = std::string(key) + " ResourceRef path/url must not be empty";
                    return false;
                }
                for (const auto& field : value.fields) {
                    if (field.key != "path" && field.key != "url") {
                        error = std::string(key) + " ResourceRef contains unsupported field '" + field.key + "'";
                        return false;
                    }
                }
                return true;
            }
            error = std::string(key) + " must be a resource path string or ResourceRef object with path/url";
            return false;
        }

        bool validateImageIconCommon(std::string_view key, const PropValue& value, bool icon, std::string& error) {
            if (key == "source" || key == "src") return validateResourceRef(value, key, error);
            if (key == "size") {
                if (value.isNumber()) return true;
                error = "size must be a number";
                return false;
            }
            if (key == "contentScale" || key == "alignment") {
                if (value.isString()) return true;
                error = std::string(key) + " must be a string";
                return false;
            }
            if (key == "alpha") {
                if (value.isNumber()) return true;
                error = "alpha must be a number";
                return false;
            }
            if (key == "tint") {
                if (icon && (value.isNumber() || (value.isString() && value.string == "Color.Unspecified"))) return true;
                error = icon ? "Icon tint must be a number color" : "Image does not support tint";
                return false;
            }
            return false;
        }

        bool validateByKey(std::string_view key, const PropValue& value, std::string& error) {
            if (validateAccessibility(key, value, error)) return true;
            if (!error.empty()) return false;

            if (key == "textStyle") return validateTextStyle(value, error);
            if (key == "horizontalArrangement" || key == "verticalArrangement") return validateArrangement(value, key, error);
            if (key == "contentAlignment" || key == "horizontalAlignment" || key == "verticalAlignment" || key == "textAlign") {
                if (value.isString()) return true;
                error = std::string(key) + " must be a string";
                return false;
            }
            if (key == "overflow") {
                if (isStringEnum(value, {"clip", "ellipsis", "visible"})) return true;
                error = "overflow must be 'clip', 'ellipsis' or 'visible'";
                return false;
            }
            if (key == "singleLine" || key == "selectAllOnFocus") {
                if (value.isBoolean()) return true;
                error = std::string(key) + " must be a boolean";
                return false;
            }
            if (key == "minLines" || key == "maxLines") {
                if (value.isNumber()) return true;
                error = std::string(key) + " must be a number";
                return false;
            }
            if (key == "text" || key == "modelValue" || key == "value" || key == "placeholder") {
                if (value.isString()) return true;
                error = std::string(key) + " must be a string";
                return false;
            }
            return false;
        }
    } // namespace

    bool validateSetPropMutation(NodeType nodeType, const std::string& rawKey, const PropValue& value, std::string& error) {
        error.clear();
        const auto key = canonicalKey(rawKey);
        if (key == "testTag" || key == "semantics") {
            error = rawKey + " is not supported in M1; 将来会以完整 semantics 通道添加回来";
            return false;
        }
        if (value.isNull()) {
            error = "Arrange prop '" + rawKey + "' must not be null";
            return false;
        }
        if (validateAccessibility(key, value, error)) return true;
        if (!error.empty()) return false;

        switch (nodeType) {
        case NodeType::Text:
            if (isOneOf(key, {"text", "textStyle", "singleLine", "minLines", "maxLines", "textAlign", "overflow"})) {
                return validateByKey(key, value, error);
            }
            break;
        case NodeType::Input:
            if (isOneOf(key, {"modelValue", "value", "placeholder", "selectAllOnFocus", "textStyle", "singleLine", "minLines", "maxLines"})) {
                return validateByKey(key, value, error);
            }
            break;
        case NodeType::Image:
            if (validateImageIconCommon(key, value, false, error)) return true;
            if (!error.empty()) return false;
            break;
        case NodeType::Icon:
            if (validateImageIconCommon(key, value, true, error)) return true;
            if (!error.empty()) return false;
            break;
        case NodeType::Row:
            if (isOneOf(key, {"horizontalArrangement", "verticalAlignment"})) return validateByKey(key, value, error);
            break;
        case NodeType::Column:
            if (isOneOf(key, {"verticalArrangement", "horizontalAlignment"})) return validateByKey(key, value, error);
            break;
        case NodeType::Box:
            if (key == "contentAlignment") return validateByKey(key, value, error);
            break;
        case NodeType::Spacer:
        case NodeType::Canvas:
        case NodeType::Unknown:
            break;
        }

        if (isNodeTypeWithChildren(nodeType) && validateByKey(key, value, error)) return true;
        if (!error.empty()) return false;

        error = "Arrange prop '" + rawKey + "' is not supported for this node type";
        return false;
    }
} // namespace arrange::core
