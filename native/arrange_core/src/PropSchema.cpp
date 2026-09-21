#include <arrange/core/PropSchema.h>

#include <arrange/core/PropValue.h>
#include <arrange/core/Alignment.h>
#include <arrange/core/MeasurePolicy.h>
#include <arrange/core/HostInput.h>
#include <exception>

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
                } else {
                    result.push_back(ch);
                }
            }
            return result;
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

        bool validateByKey(std::string_view key, const PropValue& value, std::string& error) {
            if (validateAccessibility(key, value, error)) return true;
            if (!error.empty()) return false;

            return false;
        }
    }  // namespace

    bool validateSetPropMutation(NodeType nodeType, const std::string& rawKey, const PropValue& value, std::string& error) {
        error.clear();
        const auto key = canonicalKey(rawKey);
        if (nodeType == NodeType::Unknown || !hostInputFromName(key)) {
            error = "LayoutNode 未声明输入：" + rawKey;
            return false;
        }
        if (key == "measurePolicy") {
            try {
                (void)readMeasurePolicy(value);
                return true;
            } catch (const std::exception& failure) {
                error = failure.what();
                return false;
            }
        }
        if (value.isNull()) return true;

        return validateByKey(key, value, error);
    }
}  // namespace arrange::core
