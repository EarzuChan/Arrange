#pragma once

#include "HostInput.h"
#include "Modifier.h"

#include <cstdint>
#include <variant>
#include <vector>

namespace arrange::core {
    struct NodeHandle {
        NodeId id = 0;
        std::uint64_t generation = 0;
        bool operator==(const NodeHandle&) const = default;
    };

    struct BindingHandle {
        std::uint64_t identity = 0;
        std::uint64_t generation = 0;
        bool valid() const noexcept { return identity != 0 && generation != 0; }
        bool operator==(const BindingHandle&) const = default;
    };

    struct HostInputTarget { NodeHandle node; HostInput input = HostInput::MeasurePolicy; };
    struct ModifierInputTarget { NodeHandle node; ModifierHandle modifier; };
    struct ModifierChainTarget { NodeHandle node; };
    using BindingTarget = std::variant<HostInputTarget, ModifierInputTarget, ModifierChainTarget>;
    using SlotValue = std::variant<PropValue, ModifierValue, ModifierDescriptors>;

    struct RegisterBinding { BindingHandle handle; BindingTarget target; };
    struct RetireBinding { BindingHandle handle; };
    struct SlotUpdate { BindingHandle binding; SlotValue value; };

    struct SlotRuntimeCounters {
        std::uint64_t registrations = 0;
        std::uint64_t retirements = 0;
        std::uint64_t updates = 0;
        std::uint64_t unchanged = 0;
        std::uint64_t rejected = 0;
    };

    // 跨 scene/context 不复用身份，防止 reload 后同 node id 命中旧生产者。
    std::uint64_t allocateRuntimeIdentity();
} // namespace arrange::core
