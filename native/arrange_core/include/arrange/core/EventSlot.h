#pragma once

#include <cstdint>
#include <string>
#include <string_view>

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
        [[nodiscard]] std::string toString() const;
    };

    [[nodiscard]] std::string eventSlotKindName(EventSlotKind kind);
    [[nodiscard]] EventSlotKind eventSlotKindFromName(std::string_view name) noexcept;
    [[nodiscard]] EventSlotId makeEventSlotId(NodeId node, EventSlotKind kind, std::string path = {});
    [[nodiscard]] EventSlotId parseEventSlotId(std::string_view text);
    [[nodiscard]] std::string encodeEventSlotProp(const EventSlotId& slot);
} // namespace arrange::core
