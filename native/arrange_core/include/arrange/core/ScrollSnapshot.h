#pragma once

namespace arrange::core {
    struct ScrollSnapshot {
        float value = 0.0f;
        float maxValue = 0.0f;
        float viewportSize = 0.0f;
        float contentSize = 0.0f;

        bool operator==(const ScrollSnapshot&) const = default;
    };
}
