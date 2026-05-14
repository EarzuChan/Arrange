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
        QuickJsModifierReader(JSContext* context, QuickJsEventRegistry& events, arrange::core::MutationTransaction* transaction)
            : context_(context), reader_(context), events_(events), transaction_(transaction) {}

        [[nodiscard]] arrange::core::CompiledModifier read(arrange::core::NodeId id, JSValueConst modifier);
        [[nodiscard]] bool failed() const noexcept { return failed_; }

    private:
        [[nodiscard]] JSValue throwTypeError(const char* message);
        [[nodiscard]] JSValue throwUnknownModifier(std::string_view type);
        [[nodiscard]] JSValueConst payloadFor(JSValueConst element, ScopedValue& value, std::string_view type);
        [[nodiscard]] float requiredNumberField(JSValueConst object, const char* key, std::string_view owner);
        [[nodiscard]] std::string requiredStringField(JSValueConst object, const char* key, std::string_view owner);
        [[nodiscard]] arrange::core::ModifierPadding readPadding(JSValueConst value);
        [[nodiscard]] std::pair<float, float> transformOriginFrom(JSValueConst value) const;
        [[nodiscard]] arrange::core::PaintStyleSemantics paintStyle(JSValueConst value, arrange::core::PaintStyleKind kind) const;
        [[nodiscard]] std::uint32_t colorOrBrush(JSValueConst object, const char* colorKey, const char* brushKey) const;

        JSContext* context_ = nullptr;
        QuickJsValueReader reader_;
        QuickJsEventRegistry& events_;
        arrange::core::MutationTransaction* transaction_ = nullptr;
        bool failed_ = false;
    };
}

#endif
