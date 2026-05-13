#include <arrange/core/EventSlot.h>

namespace arrange::core {
    std::string eventSlotKindName(EventSlotKind kind) {
        switch (kind) {
        case EventSlotKind::Click:
            return "click";
        case EventSlotKind::VerticalScroll:
            return "verticalScroll";
        case EventSlotKind::HorizontalScroll:
            return "horizontalScroll";
        case EventSlotKind::InputUpdate:
            return "inputUpdate";
        case EventSlotKind::InputSubmit:
            return "inputSubmit";
        case EventSlotKind::InputChange:
            return "inputChange";
        case EventSlotKind::InputBlur:
            return "inputBlur";
        case EventSlotKind::Custom:
            return "custom";
        case EventSlotKind::None:
            return "none";
        }
        return "none";
    }

    EventSlotKind eventSlotKindFromName(std::string_view name) noexcept {
        if (name == "click" || name == "clickable") return EventSlotKind::Click;
        if (name == "verticalScroll") return EventSlotKind::VerticalScroll;
        if (name == "horizontalScroll") return EventSlotKind::HorizontalScroll;
        if (name == "inputUpdate") return EventSlotKind::InputUpdate;
        if (name == "inputSubmit") return EventSlotKind::InputSubmit;
        if (name == "inputChange") return EventSlotKind::InputChange;
        if (name == "inputBlur") return EventSlotKind::InputBlur;
        if (name == "custom") return EventSlotKind::Custom;
        return EventSlotKind::None;
    }

    EventSlotId makeEventSlotId(NodeId node, EventSlotKind kind, std::string path) {
        if (path.empty()) path = eventSlotKindName(kind);
        return {node, kind, std::move(path)};
    }

} // namespace arrange::core

