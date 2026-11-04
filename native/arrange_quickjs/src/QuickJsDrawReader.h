#pragma once
#if ARRANGE_WITH_QUICKJS_NG
#include "QuickJsBrushReader.h"
#include "QuickJsPainterResources.h"
#include "QuickJsValueReader.h"
#include <arrange/core/DrawCommands.h>
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <vector>

namespace arrange::quickjs {
    // 绘制命令操作码，与 framework draw.ts 的 DrawOpcode 一一对应
    enum class DrawOpcode : int { Rect = 1, RoundRect = 2, Oval = 3, Line = 4, Clip = 5, PopClip = 6, Transform = 7, PopTransform = 8, Content = 9, Path = 10, Text = 11, Painter = 12, ClipPath = 13, Native = 14 };

    class QuickJsDrawReader {
       public:
        explicit QuickJsDrawReader(JSContext* context) : context_(context) {}

        // 读取 { ops: Float64Array, refs: [] }：一次取得整块数值流，顺序解码；非数值参数按下标取引用表
        arrange::core::DrawCommands read(JSValueConst value) {
            using namespace arrange::core;
            if (!JS_IsObject(value) || JS_IsArray(value)) throw std::invalid_argument("绘制准备需要返回编码后的绘制命令");
            ScopedValue ops(context_, JS_GetPropertyStr(context_, value, "ops"));
            if (JS_GetTypedArrayType(ops.get()) != JS_TYPED_ARRAY_FLOAT64) throw std::invalid_argument("绘制命令需要 Float64Array");
            std::size_t offset = 0, byteLength = 0, elementSize = 0;
            ScopedValue buffer(context_, JS_GetTypedArrayBuffer(context_, ops.get(), &offset, &byteLength, &elementSize));
            if (JS_IsException(buffer.get())) throw std::runtime_error(quickJsExceptionText(context_));
            std::size_t bufferSize = 0;
            const auto* bytes = JS_GetArrayBuffer(context_, &bufferSize, buffer.get());
            if (!bytes || offset + byteLength > bufferSize) throw std::invalid_argument("绘制命令缓冲不可读");
            const auto* data = reinterpret_cast<const double*>(bytes + offset);
            Cursor cursor{data, byteLength / sizeof(double)};
            if (cursor.size > 1000000) throw std::invalid_argument("单个绘制 Modifier 的命令超过 1000000 个数值");
            refs_ = ScopedValue(context_, JS_GetPropertyStr(context_, value, "refs"));
            if (!JS_IsArray(refs_.get())) throw std::invalid_argument("绘制命令需要 refs 数组");
            ScopedValue refCount(context_, JS_GetPropertyStr(context_, refs_.get(), "length"));
            if (JS_ToUint32(context_, &refCount_, refCount.get()) < 0) throw std::invalid_argument("绘制引用表长度不可读");

            DrawCommands result;
            std::vector<DrawCommandKind> stack;
            while (cursor.index < cursor.size) {
                DrawCommand command;
                const auto opcode = static_cast<DrawOpcode>(cursor.integer(1, 14, "操作码"));
                switch (opcode) {
                    case DrawOpcode::Rect:
                    case DrawOpcode::RoundRect:
                    case DrawOpcode::Oval: {
                        command.kind = opcode == DrawOpcode::Rect ? DrawCommandKind::Rectangle : opcode == DrawOpcode::RoundRect ? DrawCommandKind::RoundedRectangle : DrawCommandKind::Oval;
                        command.rect = cursor.rect();
                        paint(cursor, command);
                        command.strokeWidth = cursor.number(true);
                        if (opcode == DrawOpcode::RoundRect) command.radius = cursor.number(true);
                        break;
                    }
                    case DrawOpcode::Line:
                        command.kind = DrawCommandKind::Line;
                        command.rect = {cursor.number(), cursor.number(), 0, 0};
                        command.lineEnd = {cursor.number(), cursor.number()};
                        paint(cursor, command);
                        command.strokeWidth = cursor.number(true);
                        if (!command.strokeWidth) throw std::invalid_argument("绘制线宽必须大于零");
                        break;
                    case DrawOpcode::Clip:
                        command.kind = DrawCommandKind::PushClip;
                        command.shape = static_cast<DrawCommandShape>(cursor.integer(0, 2, "裁剪形状"));
                        command.rect = cursor.rect();
                        command.radius = cursor.number(true);
                        stack.push_back(command.kind);
                        break;
                    case DrawOpcode::Transform:
                        command.kind = DrawCommandKind::PushTransform;
                        command.rect = {0, 0, cursor.number(true), cursor.number(true)};
                        command.translationX = cursor.number();
                        command.translationY = cursor.number();
                        command.scaleX = cursor.number();
                        command.scaleY = cursor.number();
                        command.rotationZ = cursor.number();
                        command.originX = cursor.number();
                        command.originY = cursor.number();
                        stack.push_back(command.kind);
                        break;
                    case DrawOpcode::PopClip:
                    case DrawOpcode::PopTransform: {
                        const auto clip = opcode == DrawOpcode::PopClip;
                        const auto expected = clip ? DrawCommandKind::PushClip : DrawCommandKind::PushTransform;
                        if (stack.empty() || stack.back() != expected) throw std::invalid_argument("绘制状态退出不匹配");
                        stack.pop_back();
                        command.kind = clip ? DrawCommandKind::PopClip : DrawCommandKind::PopTransform;
                        break;
                    }
                    case DrawOpcode::Content:
                        command.kind = DrawCommandKind::Content;
                        break;
                    case DrawOpcode::Path:
                        command.kind = DrawCommandKind::Path;
                        paint(cursor, command);
                        command.strokeWidth = cursor.number(true);
                        command.cap = static_cast<StrokeCap>(cursor.integer(0, 2, "线帽"));
                        command.join = static_cast<StrokeJoin>(cursor.integer(0, 2, "线接"));
                        command.path = path(cursor);
                        break;
                    case DrawOpcode::ClipPath:
                        command.kind = DrawCommandKind::PushClip;
                        command.shape = DrawCommandShape::Path;
                        command.path = path(cursor);
                        stack.push_back(command.kind);
                        break;
                    case DrawOpcode::Text: {
                        command.kind = DrawCommandKind::Text;
                        ScopedValue text(context_, ref(cursor));
                        if (!JS_IsString(text.get())) throw std::invalid_argument("绘制文字需要字符串");
                        const char* chars = JS_ToCString(context_, text.get());
                        if (!chars) throw std::invalid_argument("绘制文字不可读");
                        command.text = chars;
                        JS_FreeCString(context_, chars);
                        command.rect = {cursor.number(), cursor.number(), cursor.number(true), 0};
                        command.color = cursor.color();
                        command.fontSize = cursor.number(true);
                        command.lineHeight = cursor.number(true);
                        command.maxLines = cursor.integer(0, 1000000, "最大行数");
                        command.textAlign = static_cast<TextAlign>(cursor.integer(0, 2, "文字对齐"));
                        command.overflow = static_cast<TextOverflow>(cursor.integer(0, 2, "文字溢出"));
                        break;
                    }
                    case DrawOpcode::Native: {
                        command.kind = DrawCommandKind::Native;
                        ScopedValue name(context_, ref(cursor));
                        if (!JS_IsString(name.get())) throw std::invalid_argument("原生 painter 名称需要字符串");
                        const auto key = text(name.get());
                        command.native = NativePainterRegistry::global().find(key);
                        if (!command.native) throw std::invalid_argument("原生 painter '" + key + "' 未注册");
                        command.rect = cursor.rect();
                        ScopedValue params(context_, ref(cursor));
                        command.nativeParams = SharedValue<NativePainterParams>(nativeParams(*command.native, params.get()));
                        command.nativeRevision = cursor.count("原生数据版本");
                        break;
                    }
                    case DrawOpcode::Painter: {
                        command.kind = DrawCommandKind::Painter;
                        ScopedValue painter(context_, ref(cursor));
                        const auto snapshot = QuickJsPainterResources::read(context_, painter.get());
                        if (!snapshot) throw std::invalid_argument("绘制 painter 无效");
                        command.painter = *snapshot;
                        command.rect = cursor.rect();
                        command.alpha = cursor.number(true);
                        if (command.alpha > 1) throw std::invalid_argument("绘制 painter 不透明度需要在 0 到 1 之间");
                        // 着色 -1 表示不着色
                        if (cursor.peek() == -1)
                            cursor.next();
                        else {
                            command.hasTint = true;
                            command.color = cursor.color();
                        }
                        command.contentScale = static_cast<ContentScale>(cursor.integer(0, 6, "内容缩放"));
                        const auto alignment = cursor.integer(0, 10, "图片对齐");
                        if ((alignment & 3) == 3) throw std::invalid_argument("绘制图片对齐无效");
                        command.alignment = static_cast<ImageAlignment>(alignment);
                        // 铺放 0 拉伸、1 平铺、2 九宫格，其后四个切分值
                        command.repeat = static_cast<ImageRepeat>(cursor.integer(0, 2, "图片铺放"));
                        command.slices = {cursor.number(true), cursor.number(true), cursor.number(true), cursor.number(true)};
                        validatePainterView(command.painter, command.repeat, command.slices);
                        break;
                    }
                }
                result.push_back(command);
            }
            if (!stack.empty()) throw std::invalid_argument("绘制状态没有退出");
            return result;
        }

       private:
        JSContext* context_;
        ScopedValue refs_{context_, JS_UNDEFINED};
        std::uint32_t refCount_ = 0;

        struct Cursor {
            const double* data;
            std::size_t size;
            std::size_t index = 0;

            double peek() const {
                if (index >= size) throw std::invalid_argument("绘制命令被截断");
                return data[index];
            }

            double next() {
                const auto value = peek();
                ++index;
                return value;
            }

            float number(bool nonnegative = false) {
                const auto value = next();
                if (!std::isfinite(value) || nonnegative && value < 0) throw std::invalid_argument("绘制数值无效");
                return static_cast<float>(value);
            }

            int integer(int minimum, int maximum, const char* name) {
                const auto value = next();
                if (!std::isfinite(value) || std::floor(value) != value || value < minimum || value > maximum) throw std::invalid_argument(std::string("绘制") + name + "无效");
                return static_cast<int>(value);
            }

            std::uint64_t count(const char* name) {
                const auto value = next();
                if (!std::isfinite(value) || std::floor(value) != value || value < 0 || value > 9007199254740991.0) throw std::invalid_argument(std::string("绘制") + name + "无效");
                return static_cast<std::uint64_t>(value);
            }

            std::uint32_t color() {
                const auto value = next();
                if (!std::isfinite(value) || std::floor(value) != value || value < 0 || value > 4294967295.0) throw std::invalid_argument("颜色必须是 uint32 数值");
                return static_cast<std::uint32_t>(value);
            }

            arrange::core::Rect rect() {
                const auto x = number(), y = number(), width = number(true), height = number(true);
                return {x, y, width, height};
            }
        };

        JSValue ref(Cursor& cursor) {
            if (!refCount_) throw std::invalid_argument("绘制引用下标无效");
            const auto index = cursor.integer(0, static_cast<int>(std::min<std::uint32_t>(refCount_, 1000000)) - 1, "引用下标");
            return JS_GetPropertyUint32(context_, refs_.get(), static_cast<std::uint32_t>(index));
        }

        std::string text(JSValueConst value) {
            const char* chars = JS_ToCString(context_, value);
            if (!chars) throw std::invalid_argument("绘制字符串不可读");
            std::string result = chars;
            JS_FreeCString(context_, chars);
            return result;
        }

        // 原生 painter 参数按注册的参数表逐项校验：字段必须一致，类型必须相符
        arrange::core::NativePainterParams nativeParams(const arrange::core::NativePainterEntry& entry, JSValueConst object) {
            using arrange::core::NativeParamKind;
            const auto fail = [&](const std::string& detail) {
                return std::invalid_argument("原生 painter '" + entry.name + "' " + detail);
            };
            if (!JS_IsObject(object) || JS_IsArray(object)) throw fail("参数需要对象");
            JSPropertyEnum* properties = nullptr;
            std::uint32_t count = 0;
            if (JS_GetOwnPropertyNames(context_, &properties, &count, object, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) < 0) throw fail("参数不可读");
            std::vector<std::string> names;
            for (std::uint32_t index = 0; index < count; ++index) {
                const char* name = JS_AtomToCString(context_, properties[index].atom);
                names.emplace_back(name ? name : "");
                if (name) JS_FreeCString(context_, name);
            }
            JS_FreePropertyEnum(context_, properties, count);
            for (const auto& name : names)
                if (std::none_of(entry.params.begin(), entry.params.end(), [&](const auto& spec) { return spec.name == name; })) throw fail("不接受参数 '" + name + "'");
            std::vector<std::pair<std::string, arrange::core::NativeParamValue>> values;
            for (const auto& spec : entry.params) {
                ScopedValue value(context_, JS_GetPropertyStr(context_, object, spec.name.c_str()));
                if (JS_IsUndefined(value.get())) throw fail("缺少参数 '" + spec.name + "'");
                double number = 0;
                switch (spec.kind) {
                    case NativeParamKind::Number:
                        if (!JS_IsNumber(value.get()) || JS_ToFloat64(context_, &number, value.get()) < 0 || !std::isfinite(number)) throw fail("参数 '" + spec.name + "' 需要有限数值");
                        values.emplace_back(spec.name, number);
                        break;
                    case NativeParamKind::Color:
                        if (!JS_IsNumber(value.get()) || JS_ToFloat64(context_, &number, value.get()) < 0 || std::floor(number) != number || number < 0 || number > 4294967295.0) throw fail("参数 '" + spec.name + "' 需要 uint32 颜色");
                        values.emplace_back(spec.name, static_cast<std::uint32_t>(number));
                        break;
                    case NativeParamKind::Boolean:
                        if (!JS_IsBool(value.get())) throw fail("参数 '" + spec.name + "' 需要布尔值");
                        values.emplace_back(spec.name, JS_ToBool(context_, value.get()) != 0);
                        break;
                    case NativeParamKind::Source:
                        if (!JS_IsString(value.get())) throw fail("参数 '" + spec.name + "' 需要数据源名");
                        values.emplace_back(spec.name, text(value.get()));
                        break;
                }
            }
            return arrange::core::NativePainterParams(std::move(values));
        }

        // 画笔槽：非负为颜色，负数 -(i+1) 指向引用表中的 Brush
        void paint(Cursor& cursor, arrange::core::DrawCommand& command) {
            const auto value = cursor.peek();
            if (!(value < 0)) {
                command.color = cursor.color();
                return;
            }
            cursor.next();
            if (std::floor(value) != value || -value > refCount_) throw std::invalid_argument("绘制画笔引用无效");
            ScopedValue brush(context_, JS_GetPropertyUint32(context_, refs_.get(), static_cast<std::uint32_t>(-value - 1)));
            auto result = QuickJsBrushReader(context_).read(brush.get());
            command.color = result.color;
            command.gradient = std::move(result.gradient);
        }

        // 路径：填充规则、动词数，随后每个动词带各自参数；同时求端点、控制点与弧矩形的外包盒
        arrange::core::PathRef path(Cursor& cursor) {
            using namespace arrange::core;
            PathData data;
            data.evenOdd = cursor.integer(0, 1, "填充规则") == 1;
            const auto count = cursor.integer(0, 1000000, "路径动词数");
            float left = 0, top = 0, right = 0, bottom = 0;
            bool any = false, current = false;
            const auto include = [&](float x, float y) {
                left = any ? std::min(left, x) : x;
                top = any ? std::min(top, y) : y;
                right = any ? std::max(right, x) : x;
                bottom = any ? std::max(bottom, y) : y;
                any = true;
            };
            for (int index = 0; index < count; ++index) {
                const auto verb = static_cast<PathVerb>(cursor.integer(0, 5, "路径动词"));
                data.verbs.push_back(verb);
                // 没有起点就画线时从原点出发，与 JUCE 一致
                if (!current && verb != PathVerb::MoveTo && verb != PathVerb::ArcTo && verb != PathVerb::Close) include(0, 0);
                const auto start = data.values.size();
                for (int value = 0; value < pathVerbArity(verb); ++value) data.values.push_back(cursor.number());
                const auto* v = data.values.data() + start;
                if (verb == PathVerb::ArcTo) {
                    if (v[2] < 0 || v[3] < 0 || (v[6] != 0 && v[6] != 1)) throw std::invalid_argument("路径弧参数无效");
                    include(v[0], v[1]);
                    include(v[0] + v[2], v[1] + v[3]);
                } else
                    for (int point = 0; point + 1 < pathVerbArity(verb); point += 2) include(v[point], v[point + 1]);
                current = current || verb != PathVerb::Close;
            }
            if (any) data.bounds = {left, top, right - left, bottom - top};
            return PathRef(std::move(data));
        }
    };
}
#endif
