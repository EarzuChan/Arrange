#pragma once

#include "Modifier.h"
#include "LayoutNode.h"
#include "PropValue.h"

#include <string>
#include <variant>
#include <vector>

namespace arrange::core {
    [[nodiscard]] NodeType nodeTypeFromName(std::string_view name) noexcept;

    struct CreateNodeMutation { NodeId id = 0; NodeType type = NodeType::Unknown; std::uint64_t generation = 0; };
    struct DeleteNodeMutation { NodeId id = 0; };
    struct InsertChildMutation { NodeId parent = 0; NodeId child = 0; std::uint32_t index = 0; };
    struct RemoveChildMutation { NodeId parent = 0; NodeId child = 0; };
    struct SetPropMutation { NodeId id = 0; std::string key; PropValue value; };
    struct SetModifierMutation { NodeId id = 0; ModifierDescriptors modifier; };
    struct NativeInvalidationMutation { NodeId id = 0; DirtyFlag flag = DirtyFlag::EventSlot; std::string field; std::string reason; };

    using TreeMutation = std::variant<
        CreateNodeMutation,
        DeleteNodeMutation,
        InsertChildMutation,
        RemoveChildMutation,
        SetPropMutation,
        SetModifierMutation,
        NativeInvalidationMutation>;
} // namespace arrange::core
