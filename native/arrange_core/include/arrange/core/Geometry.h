#pragma once
namespace arrange::core {
    struct Size {
        float width = 0.0f;
        float height = 0.0f;
    };

    struct Point {
        float x = 0.0f;
        float y = 0.0f;
    };

    struct Rect {
        float x = 0.0f;
        float y = 0.0f;
        float width = 0.0f;
        float height = 0.0f;
    };

    struct Constraints {
        float minWidth = 0.0f;
        float maxWidth = 0.0f;
        float minHeight = 0.0f;
        float maxHeight = 0.0f;
    };
}
