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
            case EventSlotKind::DrawPrepare:
                return "drawPrepare";
            case EventSlotKind::FocusChanged:
                return "focusChanged";
            case EventSlotKind::DoubleClick:
                return "doubleClick";
            case EventSlotKind::ContextClick:
                return "contextClick";
            case EventSlotKind::HoverEnter:
                return "hoverEnter";
            case EventSlotKind::HoverExit:
                return "hoverExit";
            case EventSlotKind::Key:
                return "key";
            case EventSlotKind::Wheel:
                return "wheel";
            case EventSlotKind::DragStart:
                return "dragStart";
            case EventSlotKind::DragDelta:
                return "dragDelta";
            case EventSlotKind::DragStop:
                return "dragStop";
            case EventSlotKind::Interaction:
                return "interaction";
            case EventSlotKind::PointerInput:
                return "pointerInput";
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
        if (name == "drawPrepare") return EventSlotKind::DrawPrepare;
        if (name == "focusChanged") return EventSlotKind::FocusChanged;
        if (name == "doubleClick") return EventSlotKind::DoubleClick;
        if (name == "contextClick") return EventSlotKind::ContextClick;
        if (name == "hoverEnter") return EventSlotKind::HoverEnter;
        if (name == "hoverExit") return EventSlotKind::HoverExit;
        if (name == "key") return EventSlotKind::Key;
        if (name == "wheel") return EventSlotKind::Wheel;
        if (name == "dragStart") return EventSlotKind::DragStart;
        if (name == "dragDelta") return EventSlotKind::DragDelta;
        if (name == "dragStop") return EventSlotKind::DragStop;
        if (name == "interaction") return EventSlotKind::Interaction;
        if (name == "pointerInput") return EventSlotKind::PointerInput;
        if (name == "custom") return EventSlotKind::Custom;
        return EventSlotKind::None;
    }

    EventSlotId makeEventSlotId(NodeId node, EventSlotKind kind, std::string path) {
        if (path.empty()) path = eventSlotKindName(kind);
        return {node, kind, std::move(path)};
    }

}
