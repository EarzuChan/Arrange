#include <arrange/core/HostInput.h>
#include <arrange/core/Modifier.h>

#include <array>
#include <stdexcept>

namespace arrange::core {
    namespace {
        constexpr std::array<std::string_view, 2> kNames{"measurePolicy", "enabled"};
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

    std::uint32_t hostInputInvalidation(HostInput input) {
        if (input == HostInput::Enabled) return dirtyMask(DirtyFlag::Accessibility) | dirtyMask(DirtyFlag::Focus) | dirtyMask(DirtyFlag::HitTest);
        constexpr auto placement = dirtyMask(DirtyFlag::Placement) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        return dirtyMask(DirtyFlag::Layout) | placement;
    }
}
