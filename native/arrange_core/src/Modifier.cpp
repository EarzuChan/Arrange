#include <arrange/core/Modifier.h>

#include <algorithm>

namespace arrange::core {
    namespace {
        std::string typedModifierPropPrefix(std::size_t index) { return "__arrangeModifier." + std::to_string(index) + "."; }

        std::string keyString(std::string_view key) { return {key.data(), key.size()}; }
    } // namespace

    bool ModifierElement::has(std::string_view key) const { return props.find(keyString(key)) != props.end(); }

    EncodedProp ModifierElement::prop(std::string_view key) const {
        if (const auto it = props.find(keyString(key)); it != props.end()) return it->second;
        return {};
    }

    float ModifierElement::number(std::string_view key, float fallback) const { return prop(key).floatValue(fallback); }

    bool ModifierElement::boolean(std::string_view key, bool fallback) const { return prop(key).boolValue(fallback); }

    std::string ModifierElement::string(std::string_view key, std::string_view fallback) const { return prop(key).stringValue(fallback); }

    std::uint32_t ModifierElement::handle(std::string_view key, std::uint32_t fallback) const { return prop(key).handleValue(fallback); }

    std::uint32_t ModifierElement::color(std::string_view key, std::uint32_t fallback) const { return prop(key).uint32Value(fallback); }

    std::vector<ModifierElement> parseModifierElements(const ArrangeNode& node) {
        if (!hasProp(node, "__arrangeModifierCount")) return {};

        const auto count = std::max(0, encodedIntProp(node, "__arrangeModifierCount", 0));
        std::vector<ModifierElement> elements;
        elements.reserve(static_cast<std::size_t>(count));

        for (int index = 0; index < count; ++index) {
            const auto prefix = typedModifierPropPrefix(static_cast<std::size_t>(index));
            const auto typeKey = prefix + "type";
            const auto typeIt = node.props.find(typeKey);
            if (typeIt == node.props.end()) continue;

            ModifierElement element;
            element.type = EncodedProp(typeIt->second).stringValue();
            if (element.type.empty()) continue;

            for (const auto& [key, value] : node.props) {
                if (key.rfind(prefix, 0) != 0) continue;
                const auto suffix = key.substr(prefix.size());
                if (suffix == "type" || suffix.empty()) continue;
                element.props.emplace(suffix, EncodedProp(value));
            }
            elements.push_back(std::move(element));
        }

        return elements;
    }
} // namespace arrange::core
