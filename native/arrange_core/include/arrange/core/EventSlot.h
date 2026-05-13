#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <functional>

namespace arrange::core {
    using NodeId = std::uint32_t;

    enum class EventSlotKind : std::uint32_t {
        None = 0,
        Click = 1,
        VerticalScroll = 2,
        HorizontalScroll = 3,
        InputUpdate = 4,
        InputSubmit = 5,
        InputChange = 6,
        InputBlur = 7,
        Custom = 100,
    };

    struct EventSlotId {
        NodeId node = 0;
        EventSlotKind kind = EventSlotKind::None;
        std::string path;

        [[nodiscard]] bool valid() const noexcept { return node != 0 && kind != EventSlotKind::None; }
        [[nodiscard]] bool operator==(const EventSlotId& other) const noexcept {
            return node == other.node && kind == other.kind && path == other.path;
        }
    };

    struct EventSlotIdHash {
        [[nodiscard]] std::size_t operator()(const EventSlotId& slot) const noexcept {
            auto result = std::hash<NodeId>{}(slot.node);
            result ^= std::hash<std::uint32_t>{}(static_cast<std::uint32_t>(slot.kind)) + 0x9e3779b9u + (result << 6u) + (result >> 2u);
            result ^= std::hash<std::string>{}(slot.path) + 0x9e3779b9u + (result << 6u) + (result >> 2u);
            return result;
        }
    };

    [[nodiscard]] std::string eventSlotKindName(EventSlotKind kind);
    [[nodiscard]] EventSlotKind eventSlotKindFromName(std::string_view name) noexcept;
    [[nodiscard]] EventSlotId makeEventSlotId(NodeId node, EventSlotKind kind, std::string path = {});
} // namespace arrange::core

