#pragma once
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>
#include "Geometry.h"

namespace arrange::core {
    using NodeId = std::uint32_t;

    enum class NodeType { Box, Row, Column, Spacer, Text, Input, Image, Icon, Canvas, Unknown };

    enum class DirtyFlag : std::uint32_t { Structure = 1, Layout = 2, Paint = 4, Transform = 8, HitTest = 16, Focus = 32, Accessibility = 64, Resource = 128 };

    struct ArrangeNode {
        NodeId id = 0;
        NodeType type = NodeType::Unknown;
        std::string text;
        std::unordered_map<std::string, std::string> props;
        std::string modifierDebugJson;
        Rect bounds;
        float baseline = -1.0f;
        std::vector<NodeId> children;
        std::uint32_t dirty = 0;
    };

    inline constexpr std::uint32_t dirtyMask(DirtyFlag flag) noexcept { return static_cast<std::uint32_t>(flag); }
    inline void markDirty(ArrangeNode& node, DirtyFlag flag) noexcept { node.dirty |= dirtyMask(flag); }
}
