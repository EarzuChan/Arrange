#pragma once

#include "QuickJsRuntimeContext.h"

namespace arrange::quickjs {
    void installHotTransport(JSContext* context);
    JSValue hotMessageValue(JSContext* context, const HotMessage& message);
}  // namespace arrange::quickjs
