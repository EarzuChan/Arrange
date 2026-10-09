#pragma once

#include <cstdint>

namespace arrange::core {
    enum class FocusDirection : std::uint32_t { Next, Previous, Up, Down, Left, Right };
    enum class FocusCommandKind { Request, Clear, Move, Cancel };

    struct FocusCommand {
        FocusCommandKind kind = FocusCommandKind::Request;
        std::uint32_t requester = 0;
        FocusDirection direction = FocusDirection::Next;
    };
}
