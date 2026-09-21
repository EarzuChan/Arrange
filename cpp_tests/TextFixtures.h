#pragma once

#include <arrange/core/LayoutNode.h>
#include <stdexcept>
#include <utility>

namespace test_support {
    inline arrange::core::TextModifier text(std::string value, std::uint32_t color = 0xff000000u, float fontSize = 16, float lineHeight = 0) {
        arrange::core::TextModifier result;
        result.text = std::move(value);
        result.color = color;
        result.style.fontSize = fontSize;
        result.style.lineHeight = lineHeight;
        return result;
    }

    inline arrange::core::TextFieldModifier textField(std::string value, std::string placeholder = {}, std::uint32_t color = 0xff000000u, float fontSize = 16) {
        arrange::core::TextFieldModifier result;
        result.value = std::move(value);
        result.placeholder = std::move(placeholder);
        result.presentation = text({}, color, fontSize);
        return result;
    }

    inline std::string textOf(const arrange::core::LayoutNode& node) {
        for (const auto& instance : node.modifier.elements()) {
            if (const auto* value = std::get_if<arrange::core::TextModifier>(&instance.descriptor.value)) return value->text;
            if (const auto* value = std::get_if<arrange::core::TextFieldModifier>(&instance.descriptor.value)) return value->value;
        }
        return {};
    }

    inline const std::shared_ptr<const arrange::core::TextLayout>& textLayoutOf(const arrange::core::LayoutNode& node) {
        for (const auto& instance : node.modifier.elements())
            if (arrange::core::textPresentation(instance.descriptor.value)) return instance.textLayout;
        throw std::logic_error("夹具节点没有文本 Modifier");
    }

    inline const arrange::core::ModifierInstance* editable(const arrange::core::LayoutNode& node) {
        for (const auto& instance : node.modifier.elements())
            if (std::holds_alternative<arrange::core::TextFieldModifier>(instance.descriptor.value)) return &instance;
        return nullptr;
    }

    inline arrange::core::EventSlotId event(const arrange::core::LayoutNode& node, arrange::core::EventSlotKind kind) {
        for (const auto& instance : node.modifier.elements()) {
            const auto slot = arrange::core::modifierEventSlot(instance.descriptor.value, kind);
            if (slot.valid()) return slot;
        }
        return {};
    }
}  // namespace test_support
