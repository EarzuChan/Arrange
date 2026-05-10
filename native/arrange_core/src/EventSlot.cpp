#include <arrange/core/EventSlot.h>

#include <cstdlib>

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

    std::string EventSlotId::toString() const {
        if (!valid()) return {};
        return std::to_string(node) + ":" + eventSlotKindName(kind) + ":" + path;
    }

    EventSlotId parseEventSlotId(std::string_view text) {
        if (text.starts_with("s:")) text.remove_prefix(2);
        if (text.empty()) return {};

        const auto firstSeparator = text.find(':');
        if (firstSeparator == std::string_view::npos) return {};
        const auto secondSeparator = text.find(':', firstSeparator + 1);
        if (secondSeparator == std::string_view::npos) return {};

        const auto nodeText = text.substr(0, firstSeparator);
        const auto kindText = text.substr(firstSeparator + 1, secondSeparator - firstSeparator - 1);
        const auto pathText = text.substr(secondSeparator + 1);

        char* end = nullptr;
        const auto node = std::strtoul(std::string(nodeText).c_str(), &end, 10);
        if (end == nullptr || *end != '\0' || node == 0) return {};

        const auto kind = eventSlotKindFromName(kindText);
        if (kind == EventSlotKind::None) return {};

        return {static_cast<NodeId>(node), kind, std::string(pathText)};
    }

    std::string encodeEventSlotProp(const EventSlotId& slot) {
        const auto text = slot.toString();
        return text.empty() ? "n:" : "s:" + text;
    }
} // namespace arrange::core
