#pragma once
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>
#include "Geometry.h"
#include "Modifier.h"
#include "PropValue.h"

namespace arrange::core {
    enum class NodeType { Box, Row, Column, Spacer, Text, Input, Image, Icon, Canvas, Unknown };

    struct ArrangeNode {
        NodeId id = 0;
        NodeType type = NodeType::Unknown;
        std::string text;
        std::unordered_map<std::string, PropValue> props;
        std::unordered_map<EventSlotKind, EventSlotId> eventSlots;
        CompiledModifier modifier;
        Rect bounds;
        float baseline = -1.0f;
        std::vector<NodeId> children;
        std::uint32_t dirty = 0;
    };

    inline void markDirty(ArrangeNode& node, DirtyFlag flag) noexcept { node.dirty |= dirtyMask(flag); }
}
