#pragma once

#include <string>
#include <variant>

namespace arrange::core {
    struct KeyModifierState {
        bool shift = false;
        bool alt = false;
        bool ctrl = false;
        bool meta = false;
        // macOS 为 meta，其它平台为 ctrl
        bool command = false;
        bool operator==(const KeyModifierState&) const = default;
    };

    // 坐标均为受体本地 PX
    struct PointerEventPayload {
        float x = 0.0f;
        float y = 0.0f;
        KeyModifierState modifiers;
    };

    struct KeyEventPayload {
        bool up = false;
        std::string key;
        std::string text;
        bool repeat = false;
        KeyModifierState modifiers;
    };

    struct WheelEventPayload {
        float deltaX = 0.0f;
        float deltaY = 0.0f;
        KeyModifierState modifiers;
    };

    struct DragStartPayload {
        float x = 0.0f;
        float y = 0.0f;
        float width = 0.0f;
        float height = 0.0f;
        KeyModifierState modifiers;
    };

    struct DragDeltaPayload {
        float deltaX = 0.0f;
        float deltaY = 0.0f;
        KeyModifierState modifiers;
    };

    struct DragStopPayload {
        float velocity = 0.0f;
        bool cancelled = false;
    };

    struct InteractionPayload {
        bool hovered = false;
        bool pressed = false;
        bool focused = false;
        bool dragged = false;
        bool operator==(const InteractionPayload&) const = default;
    };

    enum class PointerInputType { Down, Move, Up, Cancel, Enter, Exit };

    // 低级指针流；坐标为受体本地 PX，按下期间相对按下点外推，不受悬停冻结影响
    struct PointerInputPayload {
        PointerInputType type = PointerInputType::Move;
        float x = 0.0f;
        float y = 0.0f;
        KeyModifierState modifiers;
    };

    using InputEventPayload = std::variant<std::monostate, PointerEventPayload, KeyEventPayload, WheelEventPayload, DragStartPayload, DragDeltaPayload, DragStopPayload, InteractionPayload, PointerInputPayload>;
}
