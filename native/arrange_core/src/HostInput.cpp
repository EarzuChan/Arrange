#include <arrange/core/HostInput.h>
#include <arrange/core/Modifier.h>

#include <array>
#include <stdexcept>

namespace arrange::core {
    namespace {
        constexpr std::array<std::string_view, 27> kNames{
            "text", "textStyle", "singleLine", "minLines", "maxLines", "textAlign", "overflow",
            "modelValue", "value", "placeholder", "selectAllOnFocus",
            "horizontalArrangement", "verticalArrangement", "contentAlignment", "horizontalAlignment", "verticalAlignment",
            "source", "size", "contentScale", "alignment", "alpha", "tint",
            "contentDescription", "label", "description", "role", "enabled",
        };
        bool sameField(const PropValue* before, const PropValue& after, std::string_view key) {
            const auto* a = before ? before->field(key) : nullptr;
            const auto* b = after.field(key);
            if (!a || !b) return a == b;
            return samePropValue(*a, *b);
        }
    }

    std::optional<HostInput> hostInputFromName(std::string_view name) {
        if (name == "src") name = "source";
        for (std::size_t i = 0; i < kNames.size(); ++i) if (kNames[i] == name || kebabCase(kNames[i]) == name) return static_cast<HostInput>(i);
        return std::nullopt;
    }

    std::string_view hostInputName(HostInput input) {
        const auto index = static_cast<std::size_t>(input);
        if (index >= kNames.size()) throw std::invalid_argument("Arrange unknown host input");
        return kNames[index];
    }

    bool samePropValue(const PropValue& left, const PropValue& right) {
        if (left.kind != right.kind) return false;
        switch (left.kind) {
        case PropValueKind::Null: return true;
        case PropValueKind::Number: return left.number == right.number;
        case PropValueKind::Boolean: return left.boolean == right.boolean;
        case PropValueKind::String: return left.string == right.string;
        case PropValueKind::Object:
            if (left.fields.size() != right.fields.size()) return false;
            for (const auto& field : left.fields) {
                const auto* other = right.field(field.key);
                if (!other || !samePropValue(field.value, *other)) return false;
            }
            return true;
        }
        return false;
    }

    std::uint32_t hostInputInvalidation(HostInput input, const PropValue* before, const PropValue& after) {
        if (before && samePropValue(*before, after)) return 0;
        constexpr auto paint = dirtyMask(DirtyFlag::Paint);
        constexpr auto placement = dirtyMask(DirtyFlag::Placement) | paint | dirtyMask(DirtyFlag::HitTest);
        constexpr auto measure = dirtyMask(DirtyFlag::Layout) | placement;
        switch (input) {
        case HostInput::TextStyle:
            if (sameField(before, after, "fontSize") && sameField(before, after, "lineHeight") && sameField(before, after, "fontFamily") && sameField(before, after, "fontWeight")) return paint;
            return measure;
        case HostInput::TextAlign:
        case HostInput::Overflow:
        case HostInput::ContentScale:
        case HostInput::Alignment:
        case HostInput::Alpha:
        case HostInput::Tint: return paint;
        case HostInput::ContentAlignment:
        case HostInput::HorizontalAlignment:
        case HostInput::VerticalAlignment: return placement;
        case HostInput::SelectAllOnFocus: return dirtyMask(DirtyFlag::Focus);
        case HostInput::Source: return dirtyMask(DirtyFlag::Resource) | paint;
        case HostInput::ContentDescription:
        case HostInput::Label:
        case HostInput::Description:
        case HostInput::Role: return dirtyMask(DirtyFlag::Accessibility);
        case HostInput::Enabled: return dirtyMask(DirtyFlag::Accessibility) | dirtyMask(DirtyFlag::Focus) | dirtyMask(DirtyFlag::HitTest);
        default: return measure;
        }
    }
} // namespace arrange::core
