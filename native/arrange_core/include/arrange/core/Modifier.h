#pragma once

#include "PropValue.h"
#include "RenderTree.h"

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace arrange::core {
    struct ModifierElement {
        std::string type;
        std::unordered_map<std::string, EncodedProp> props;

        bool has(std::string_view key) const;
        EncodedProp prop(std::string_view key) const;
        float number(std::string_view key, float fallback = 0.0f) const;
        bool boolean(std::string_view key, bool fallback = false) const;
        std::string string(std::string_view key, std::string_view fallback = {}) const;
        std::uint32_t handle(std::string_view key, std::uint32_t fallback = 0) const;
        std::uint32_t color(std::string_view key, std::uint32_t fallback = 0) const;
    };

    std::vector<ModifierElement> parseModifierElements(const ArrangeNode& node);
} // namespace arrange::core
