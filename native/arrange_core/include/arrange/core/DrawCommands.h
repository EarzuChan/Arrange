#pragma once

#include "Geometry.h"
#include <cstdint>
#include <vector>

namespace arrange::core {
    // 正式的类型化绘制输入；QuickJS 直接读取各字段，发布帧不持有 JS 对象或函数。
    enum class DrawCommandKind { Rectangle, RoundedRectangle, Oval, Line, PushClip, PopClip, PushTransform, PopTransform, Content };
    enum class DrawCommandShape { Rectangle, Rounded, Oval };

    struct DrawCommand {
        DrawCommandKind kind = DrawCommandKind::Rectangle;
        DrawCommandShape shape = DrawCommandShape::Rectangle;
        Rect rect;
        Point lineEnd;
        std::uint32_t color = 0;
        float strokeWidth = 0;
        float radius = 0;
        float translationX = 0, translationY = 0, scaleX = 1, scaleY = 1, rotationZ = 0, originX = 0.5f, originY = 0.5f;
        bool operator==(const DrawCommand&) const = default;
    };

    using DrawCommands = std::vector<DrawCommand>;
}
