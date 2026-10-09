#pragma once
#if ARRANGE_WITH_QUICKJS_NG
#include "QuickJsValueReader.h"
#include <arrange/core/DrawCommands.h>
#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <stdexcept>

namespace arrange::quickjs {
    class QuickJsDrawReader {
       public:
        explicit QuickJsDrawReader(JSContext* context) : context_(context), reader_(context) {}

        arrange::core::DrawCommands read(JSValueConst value) {
            using namespace arrange::core;
            if (!JS_IsArray(value)) throw std::invalid_argument("绘制准备需要返回类型化绘制数组");
            const auto length = reader_.arrayLength(value);
            if (length > 100000) throw std::invalid_argument("单个绘制 Modifier 超过 100000 项");
            DrawCommands result;
            result.reserve(length);
            std::vector<DrawCommandKind> stack;
            for (std::uint32_t index = 0; index < length; ++index) {
                ScopedValue object(context_, JS_GetPropertyUint32(context_, value, index));
                if (!JS_IsObject(object.get()) || JS_IsArray(object.get())) throw std::invalid_argument("绘制项需要对象");
                const auto kind = reader_.requiredStringField(object.get(), "kind", "绘制项");
                DrawCommand command;
                if (kind == "rect" || kind == "roundRect" || kind == "oval") {
                    fields(object.get(), kind == "roundRect" ? std::initializer_list<const char*>{"kind", "x", "y", "width", "height", "color", "strokeWidth", "radius"} : std::initializer_list<const char*>{"kind", "x", "y", "width", "height", "color", "strokeWidth"});
                    command.kind = kind == "rect" ? DrawCommandKind::Rectangle : kind == "roundRect" ? DrawCommandKind::RoundedRectangle : DrawCommandKind::Oval;
                    command.rect = bounds(object.get());
                    command.color = color(object.get());
                    command.strokeWidth = number(object.get(), "strokeWidth", true);
                    if (kind == "roundRect") command.radius = number(object.get(), "radius", true);
                } else if (kind == "line") {
                    fields(object.get(), {"kind", "x", "y", "endX", "endY", "color", "strokeWidth"});
                    command.kind = DrawCommandKind::Line;
                    command.rect = {number(object.get(), "x"), number(object.get(), "y"), 0, 0};
                    command.lineEnd = {number(object.get(), "endX"), number(object.get(), "endY")};
                    command.color = color(object.get());
                    command.strokeWidth = number(object.get(), "strokeWidth", true);
                    if (!command.strokeWidth) throw std::invalid_argument("绘制线宽必须大于零");
                } else if (kind == "clip") {
                    fields(object.get(), {"kind", "x", "y", "width", "height", "shape", "radius"});
                    command.kind = DrawCommandKind::PushClip;
                    command.rect = bounds(object.get());
                    const auto shape = reader_.requiredStringField(object.get(), "shape", "绘制裁剪");
                    if (shape != "rectangle" && shape != "rounded" && shape != "circle") throw std::invalid_argument("绘制裁剪形状无效");
                    command.shape = shape == "rectangle" ? DrawCommandShape::Rectangle : shape == "rounded" ? DrawCommandShape::Rounded : DrawCommandShape::Oval;
                    command.radius = number(object.get(), "radius", true);
                    stack.push_back(command.kind);
                } else if (kind == "transform") {
                    fields(object.get(), {"kind", "width", "height", "translationX", "translationY", "scaleX", "scaleY", "rotationZ", "originX", "originY"});
                    command.kind = DrawCommandKind::PushTransform;
                    command.rect = {0, 0, number(object.get(), "width", true), number(object.get(), "height", true)};
                    command.translationX = number(object.get(), "translationX");
                    command.translationY = number(object.get(), "translationY");
                    command.scaleX = number(object.get(), "scaleX");
                    command.scaleY = number(object.get(), "scaleY");
                    command.rotationZ = number(object.get(), "rotationZ");
                    command.originX = number(object.get(), "originX");
                    command.originY = number(object.get(), "originY");
                    stack.push_back(command.kind);
                } else if (kind == "popClip" || kind == "popTransform") {
                    fields(object.get(), {"kind"});
                    const auto expected = kind == "popClip" ? DrawCommandKind::PushClip : DrawCommandKind::PushTransform;
                    if (stack.empty() || stack.back() != expected) throw std::invalid_argument("绘制状态退出不匹配");
                    stack.pop_back();
                    command.kind = kind == "popClip" ? DrawCommandKind::PopClip : DrawCommandKind::PopTransform;
                } else if (kind == "content") {
                    fields(object.get(), {"kind"});
                    command.kind = DrawCommandKind::Content;
                } else
                    throw std::invalid_argument("未知绘制项：" + kind);
                if (JS_HasException(context_)) throw std::runtime_error(quickJsExceptionText(context_));
                result.push_back(command);
            }
            if (!stack.empty()) throw std::invalid_argument("绘制状态没有退出");
            return result;
        }

       private:
        JSContext* context_;
        QuickJsValueReader reader_;

        std::uint32_t color(JSValueConst object) {
            ScopedValue value(context_, JS_GetPropertyStr(context_, object, "color"));
            return reader_.colorValue(value.get());
        }

        float number(JSValueConst object, const char* name, bool nonnegative = false) {
            const auto result = reader_.requiredNumberField(object, name, "绘制项");
            if (!std::isfinite(result) || nonnegative && result < 0) throw std::invalid_argument(std::string("绘制数值无效：") + name);
            return result;
        }

        arrange::core::Rect bounds(JSValueConst object) {
            return {number(object, "x"), number(object, "y"), number(object, "width", true), number(object, "height", true)};
        }

        void fields(JSValueConst object, std::initializer_list<const char*> allowed) {
            JSPropertyEnum* keys = nullptr;
            std::uint32_t count = 0;
            if (JS_GetOwnPropertyNames(context_, &keys, &count, object, JS_GPN_STRING_MASK | JS_GPN_SYMBOL_MASK) < 0) throw std::runtime_error(quickJsExceptionText(context_));
            bool valid = true;
            for (std::uint32_t index = 0; index < count; ++index) {
                ScopedValue key(context_, JS_AtomToValue(context_, keys[index].atom));
                const auto name = reader_.toString(key.get());
                if (std::none_of(allowed.begin(), allowed.end(), [&](const auto* known) { return name == known; })) valid = false;
            }
            JS_FreePropertyEnum(context_, keys, count);
            if (!valid) throw std::invalid_argument("绘制项包含未知字段");
        }
    };
}
#endif
