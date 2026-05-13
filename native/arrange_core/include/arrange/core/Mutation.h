#pragma once

#include "Modifier.h"
#include "Node.h"
#include "PropValue.h"

#include <string>
#include <variant>
#include <vector>

namespace arrange::core {
    [[nodiscard]] NodeType nodeTypeFromName(std::string_view name) noexcept;

    struct CreateNodeMutation { NodeId id = 0; NodeType type = NodeType::Unknown; };
    struct DeleteNodeMutation { NodeId id = 0; };
    struct InsertChildMutation { NodeId parent = 0; NodeId child = 0; std::uint32_t index = 0; };
    struct RemoveChildMutation { NodeId parent = 0; NodeId child = 0; };
    struct SetTextMutation { NodeId id = 0; std::string text; };
    struct SetPropMutation { NodeId id = 0; std::string key; PropValue value; };
    struct SetEventSlotMutation { NodeId id = 0; EventSlotKind kind = EventSlotKind::None; EventSlotId slot; };
    struct ClearEventSlotMutation { NodeId id = 0; EventSlotKind kind = EventSlotKind::None; };
    struct SetModifierMutation { NodeId id = 0; CompiledModifier modifier; };
    struct NativeInvalidationMutation { NodeId id = 0; DirtyFlag flag = DirtyFlag::EventSlot; std::string field; std::string reason; };

    using TreeMutation = std::variant<
        CreateNodeMutation,
        DeleteNodeMutation,
        InsertChildMutation,
        RemoveChildMutation,
        SetTextMutation,
        SetPropMutation,
        SetEventSlotMutation,
        ClearEventSlotMutation,
        SetModifierMutation,
        NativeInvalidationMutation>;
} // namespace arrange::core
