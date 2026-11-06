#pragma once

#include "Brush.h"
#include "DrawEnums.h"
#include "Geometry.h"
#include "NativePainter.h"
#include "Painter.h"
#include "TextLayoutService.h"
#include <cstdint>
#include <string>
#include <vector>

namespace arrange::core {
    // 正式的类型化绘制输入；QuickJS 从数值流解码，发布帧不持有 JS 对象或函数。
    enum class DrawCommandKind { Rectangle, RoundedRectangle, Oval, Line, PushClip, PopClip, PushTransform, PopTransform, Content, Path, Text, Painter, Native };
    enum class DrawCommandShape { Rectangle, Rounded, Oval, Path };

    struct DrawCommand {
        DrawCommandKind kind = DrawCommandKind::Rectangle;
        DrawCommandShape shape = DrawCommandShape::Rectangle;
        Rect rect;
        Point lineEnd;
        // 渐变存在时 color 不参与着色
        std::uint32_t color = 0;
        GradientRef gradient;
        float strokeWidth = 0;
        StrokeCap cap = StrokeCap::Butt;
        StrokeJoin join = StrokeJoin::Miter;
        float radius = 0;
        PathRef path;
        float translationX = 0, translationY = 0, scaleX = 1, scaleY = 1, rotationZ = 0, originX = 0.5f, originY = 0.5f;
        // 文字：rect 宽为 0 表示不限宽
        std::string text;
        float fontSize = defaultFontSize, lineHeight = 0;
        int maxLines = 0;
        TextAlign textAlign = TextAlign::Start;
        TextOverflow overflow = TextOverflow::Visible;
        // painter
        PainterSnapshot painter;
        ContentScale contentScale = ContentScale::Fit;
        ImageAlignment alignment = ImageAlignment::Center;
        ImageRepeat repeat = ImageRepeat::None;
        ImageSlices slices;
        bool hasTint = false;
        float alpha = 1;
        // 原生 painter：注册项按身份比较，参数按内容比较
        std::shared_ptr<const NativePainterEntry> native;
        SharedValue<NativePainterParams> nativeParams;
        // 参数中数据源的版本和：原生数据推进时命令随之不同，从而重绘
        std::uint64_t nativeRevision = 0;
        bool operator==(const DrawCommand&) const = default;
    };

    using DrawCommands = std::vector<DrawCommand>;
}
