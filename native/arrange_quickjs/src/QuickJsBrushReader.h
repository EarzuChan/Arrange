#pragma once
#if ARRANGE_WITH_QUICKJS_NG
#include "QuickJsValueReader.h"
#include <arrange/core/Brush.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>

namespace arrange::quickjs {
    // 修饰器与绘制命令共用的 Brush 读取：数值或 solidColor 得到颜色，渐变得到共享渐变；失败抛异常
    struct BrushValue {
        std::uint32_t color = 0;
        arrange::core::GradientRef gradient;
    };

    class QuickJsBrushReader {
       public:
        explicit QuickJsBrushReader(JSContext* context) : context_(context) {}

        BrushValue read(JSValueConst brush) const {
            using namespace arrange::core;
            if (JS_IsNumber(brush)) return {color(brush)};
            if (!JS_IsObject(brush) || JS_IsArray(brush)) throw std::invalid_argument("brush 需要数值颜色或 Brush 对象");
            const auto type = string(brush, "type");
            if (type == "solidColor") {
                only(brush, {"type", "color"});
                ScopedValue value(context_, JS_GetPropertyStr(context_, brush, "color"));
                return {color(value.get())};
            }
            Gradient gradient;
            if (type == "linearGradient") {
                only(brush, {"type", "colors", "stops", "start", "end"});
                gradient.kind = GradientKind::Linear;
                gradient.start = point(brush, "start");
                gradient.end = point(brush, "end");
            } else if (type == "radialGradient") {
                only(brush, {"type", "colors", "stops", "center", "radius"});
                gradient.kind = GradientKind::Radial;
                gradient.center = point(brush, "center");
                gradient.radius = number(brush, "radius");
                if (gradient.radius < 0) throw std::invalid_argument("径向渐变半径不能为负数");
            } else if (type == "sweepGradient") {
                only(brush, {"type", "colors", "stops", "center", "startAngle"});
                gradient.kind = GradientKind::Sweep;
                gradient.center = point(brush, "center");
                gradient.startAngle = number(brush, "startAngle");
            } else
                throw std::invalid_argument("brush.type 需要 solidColor、linearGradient、radialGradient 或 sweepGradient");
            ScopedValue colors(context_, JS_GetPropertyStr(context_, brush, "colors"));
            ScopedValue stops(context_, JS_GetPropertyStr(context_, brush, "stops"));
            if (!JS_IsArray(colors.get()) || !JS_IsArray(stops.get())) throw std::invalid_argument("渐变需要 colors 与 stops 数组");
            const auto count = length(colors.get());
            if (count < 2 || count > 64 || length(stops.get()) != count) throw std::invalid_argument("渐变需要 2 到 64 个色标，colors 与 stops 等长");
            float previous = 0;
            for (std::uint32_t index = 0; index < count; ++index) {
                ScopedValue stopColor(context_, JS_GetPropertyUint32(context_, colors.get(), index));
                ScopedValue position(context_, JS_GetPropertyUint32(context_, stops.get(), index));
                const auto at = finite(position.get(), "渐变色标位置");
                if (at < previous || at > 1) throw std::invalid_argument("渐变色标位置需要在 0 到 1 之间且不递减");
                previous = at;
                gradient.stops.push_back({at, color(stopColor.get())});
            }
            return {0xffffffffu, GradientRef(std::move(gradient))};
        }

       private:
        JSContext* context_;

        // 只接受列出的字段，多余字段按名报错
        void only(JSValueConst object, std::initializer_list<std::string_view> fields) const {
            JSPropertyEnum* properties = nullptr;
            std::uint32_t count = 0;
            if (JS_GetOwnPropertyNames(context_, &properties, &count, object, JS_GPN_STRING_MASK | JS_GPN_SYMBOL_MASK) < 0) throw std::invalid_argument("brush 字段不可读");
            std::string unknown;
            for (std::uint32_t index = 0; index < count && unknown.empty(); ++index) {
                const char* name = JS_AtomToCString(context_, properties[index].atom);
                if (name && std::find(fields.begin(), fields.end(), std::string_view(name)) == fields.end()) unknown = name;
                if (name) JS_FreeCString(context_, name);
            }
            JS_FreePropertyEnum(context_, properties, count);
            if (!unknown.empty()) throw std::invalid_argument("Arrange brush 不接受字段 '" + unknown + "'");
        }

        std::uint32_t length(JSValueConst array) const {
            ScopedValue value(context_, JS_GetPropertyStr(context_, array, "length"));
            std::uint32_t result = 0;
            if (JS_ToUint32(context_, &result, value.get()) < 0) throw std::invalid_argument("数组长度不可读");
            return result;
        }

        float finite(JSValueConst value, const char* name) const {
            double result = 0;
            if (!JS_IsNumber(value) || JS_ToFloat64(context_, &result, value) < 0 || !std::isfinite(result)) throw std::invalid_argument(std::string(name) + "需要有限数值");
            return static_cast<float>(result);
        }

        float number(JSValueConst object, const char* key) const {
            ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
            return finite(value.get(), key);
        }

        arrange::core::Point point(JSValueConst object, const char* key) const {
            ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
            if (!JS_IsObject(value.get()) || JS_IsArray(value.get())) throw std::invalid_argument(std::string(key) + " 需要 { x, y }");
            return {number(value.get(), "x"), number(value.get(), "y")};
        }

        std::string string(JSValueConst object, const char* key) const {
            ScopedValue value(context_, JS_GetPropertyStr(context_, object, key));
            if (!JS_IsString(value.get())) throw std::invalid_argument(std::string("brush.") + key + " 需要字符串");
            const char* text = JS_ToCString(context_, value.get());
            if (!text) throw std::invalid_argument("brush 字符串不可读");
            std::string result(text);
            JS_FreeCString(context_, text);
            return result;
        }

        std::uint32_t color(JSValueConst value) const {
            double number = 0;
            if (!JS_IsNumber(value) || JS_ToFloat64(context_, &number, value) < 0 || !std::isfinite(number) || std::floor(number) != number || number < 0 || number > 4294967295.0) throw std::invalid_argument("颜色必须是 uint32 数值");
            return static_cast<std::uint32_t>(number);
        }
    };
}
#endif
