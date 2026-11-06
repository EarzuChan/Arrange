#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsEventRegistry.h"
#include "QuickJsValueReader.h"

#include <arrange/core/Modifier.h>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    class QuickJsModifierReader {
       public:
        QuickJsModifierReader(JSContext* context, QuickJsEventRegistry& events, arrange::core::MutationTransaction* transaction) : context_(context), reader_(context), events_(events), transaction_(transaction) {}

        [[nodiscard]] arrange::core::ModifierDescriptors read(arrange::core::NodeId id, JSValueConst modifier, const arrange::core::ModifierValue* instanceInput = nullptr, std::span<const arrange::core::ModifierDescriptor* const> previous = {});

        [[nodiscard]] bool failed() const noexcept {
            return failed_;
        }

       private:
        [[nodiscard]] JSValue throwTypeError(const char* message);
        [[nodiscard]] JSValue throwUnknownModifier(std::string_view type);
        [[nodiscard]] JSValueConst payloadFor(JSValueConst element, ScopedValue& value, std::string_view type);
        [[nodiscard]] float numberField(JSValueConst object, const char* key, float fallback = 0.0f) const;
        [[nodiscard]] bool boolField(JSValueConst object, const char* key, bool fallback) const;
        [[nodiscard]] float requiredNumberField(JSValueConst object, const char* key, std::string_view owner);
        [[nodiscard]] std::string requiredStringField(JSValueConst object, const char* key, std::string_view owner);

        // 枚举字段在读取边界一次解析；缺省保留目标默认值
        template <class T, class Parse>
        [[nodiscard]] bool enumField(JSValueConst object, const char* key, Parse parse, T& target) {
            const auto name = reader_.stringField(object, key);
            if (name.empty()) return true;
            if (const auto value = parse(name)) {
                target = *value;
                return true;
            }
            failed_ = true;
            JS_ThrowTypeError(context_, "Arrange Modifier 字段 '%s' 的枚举值无效：%s", key, name.c_str());
            return false;
        }

        [[nodiscard]] arrange::core::ModifierPadding readPadding(JSValueConst value);
        // 读取字体族、字重、字形与伪造开关；失败时已抛出 JS 异常
        bool readFontStyle(JSValueConst style, arrange::core::TextStyle& result);
        [[nodiscard]] std::pair<float, float> transformOriginFrom(JSValueConst value) const;
        [[nodiscard]] arrange::core::PaintStyleSemantics paintStyle(JSValueConst value, arrange::core::PaintStyleKind kind) const;
        // 读取 color 或 brush，结果写入 style 的颜色与渐变
        void colorOrBrush(JSValueConst object, arrange::core::PaintStyleSemantics& style) const;

        JSContext* context_ = nullptr;
        QuickJsValueReader reader_;
        QuickJsEventRegistry& events_;
        arrange::core::MutationTransaction* transaction_ = nullptr;
        bool failed_ = false;
    };
}

#endif
