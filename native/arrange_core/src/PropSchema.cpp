#include <arrange/core/PropSchema.h>

#include <arrange/core/PropValue.h>
#include <arrange/core/Alignment.h>

#include <algorithm>
#include <cctype>
#include <string_view>

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

        bool enumResult(bool valid, std::string_view key, const PropValue& value, std::string& error) {
            if (!valid) error = std::string(key) + " 不支持枚举值：" + (value.isString() ? "'" + value.string + "'" : "值必须是字符串");
            return valid;
        }

        bool supportsProp(NodeType type, std::string_view key) {
            if (isOneOf(key, {"contentDescription", "label", "description", "role", "enabled"})) return true;
            switch (type) {
            case NodeType::Text: return isOneOf(key, {"text", "textStyle", "singleLine", "minLines", "maxLines", "textAlign", "overflow"});
            case NodeType::Input: return isOneOf(key, {"modelValue", "value", "placeholder", "selectAllOnFocus", "textStyle", "singleLine", "minLines", "maxLines"});
            case NodeType::Image: return isOneOf(key, {"source", "contentScale", "alignment", "alpha"});
            case NodeType::Icon: return isOneOf(key, {"source", "size", "tint"});
            case NodeType::Box: return key == "contentAlignment";
            case NodeType::Row: return isOneOf(key, {"horizontalArrangement", "verticalAlignment"});
            case NodeType::Column: return isOneOf(key, {"verticalArrangement", "horizontalAlignment"});
            default: return false;
            }
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
                error = "textStyle 不支持字段：'" + field.key + "'";
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
                const bool horizontal = key == "horizontalArrangement";
                const bool valid = isOneOf(value.string, {"Center", "SpaceBetween", "SpaceAround", "SpaceEvenly"}) || (horizontal ? isOneOf(value.string, {"Start", "End"}) : isOneOf(value.string, {"Top", "Bottom"}));
                return enumResult(valid, key, value, error);
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
            if (const auto alignment = field("alignment"); alignment != nullptr && !alignment->isNull()) {
                const bool valid = alignment->isString() && (key == "horizontalArrangement" ? isHorizontalAlignment(alignment->string) : isVerticalAlignment(alignment->string));
                if (!enumResult(valid, std::string(key) + ".alignment", *alignment, error)) return false;
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
                    if (field.key == "origin") {
                        if (!field.value.isNull() && !field.value.isString()) {
                            error = std::string(key) + " 资源来源必须是字符串";
                            return false;
                        }
                        continue;
                    }
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
            if (key == "source") return validateResourceRef(value, key, error);
            if (key == "size") {
                if (value.isNumber()) return true;
                error = "size must be a number";
                return false;
            }
            if (key == "contentScale") return enumResult(isStringEnum(value, {"Fit", "Crop", "FillBounds", "Inside", "None", "FillWidth", "FillHeight"}), key, value, error);
            if (key == "alignment") return enumResult(value.isString() && isImageAlignment(value.string), key, value, error);
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
            if (key == "contentAlignment") return enumResult(value.isString() && isBoxAlignment(value.string), key, value, error);
            if (key == "horizontalAlignment") return enumResult(value.isString() && isHorizontalAlignment(value.string), key, value, error);
            if (key == "verticalAlignment") return enumResult(value.isString() && (isVerticalAlignment(value.string) || value.string == "Baseline"), key, value, error);
            if (key == "textAlign") return enumResult(isStringEnum(value, {"left", "start", "Start", "center", "Center", "right", "end", "End"}), key, value, error);
            if (key == "overflow") {
                return enumResult(isStringEnum(value, {"clip", "ellipsis", "visible"}), key, value, error);
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
        if (!supportsProp(nodeType, key)) {
            error = "Arrange 节点不支持输入：'" + rawKey + "'";
            return false;
        }
        if (value.isNull()) return true;

        if (nodeType == NodeType::Image || nodeType == NodeType::Icon) {
            if (validateImageIconCommon(key, value, nodeType == NodeType::Icon, error)) return true;
            if (!error.empty()) return false;
        }
        return validateByKey(key, value, error);
    }
} // namespace arrange::core
