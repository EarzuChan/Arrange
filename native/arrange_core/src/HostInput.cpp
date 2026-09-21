#include <arrange/core/HostInput.h>
#include <arrange/core/Modifier.h>

#include <array>
#include <stdexcept>

namespace arrange::core {
    namespace {
        constexpr std::array<std::string_view, 6> kNames{
            "measurePolicy", "contentDescription", "label", "description", "role", "enabled",
        };
    }

    std::optional<HostInput> hostInputFromName(std::string_view name) {
        for (std::size_t i = 0; i < kNames.size(); ++i)
            if (kNames[i] == name || kebabCase(kNames[i]) == name) return static_cast<HostInput>(i);
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
            case PropValueKind::Null:
                return true;
            case PropValueKind::Number:
                return left.number == right.number;
            case PropValueKind::Boolean:
                return left.boolean == right.boolean;
            case PropValueKind::String:
                return left.string == right.string;
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
            case HostInput::ContentDescription:
            case HostInput::Label:
            case HostInput::Description:
            case HostInput::Role:
                return dirtyMask(DirtyFlag::Accessibility);
            case HostInput::Enabled:
                return dirtyMask(DirtyFlag::Accessibility) | dirtyMask(DirtyFlag::Focus) | dirtyMask(DirtyFlag::HitTest);
            default:
                return measure;
        }
    }
}  // namespace arrange::core
