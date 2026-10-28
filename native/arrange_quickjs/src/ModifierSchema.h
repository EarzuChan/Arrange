#pragma once

#include <arrange/core/EventSlot.h>

#include <span>
#include <string_view>

namespace arrange::quickjs {
    struct ModifierCallbackField {
        std::string_view field;
        arrange::core::EventSlotKind kind;
    };

    struct ModifierSchemaEntry {
        std::string_view type;
        std::span<const std::string_view> fields;
        std::span<const ModifierCallbackField> callbacks;
    };

    namespace schema {
#include "ModifierSchema.inc"
    }

    inline const ModifierSchemaEntry* findModifierSchema(std::string_view type) noexcept {
        for (const auto& entry : schema::modifierSchemaEntries)
            if (entry.type == type) return &entry;
        return nullptr;
    }

    inline arrange::core::EventSlotKind modifierCallbackKind(const ModifierSchemaEntry& entry, std::string_view field) noexcept {
        for (const auto& callback : entry.callbacks)
            if (callback.field == field) return callback.kind;
        return arrange::core::EventSlotKind::None;
    }
}
