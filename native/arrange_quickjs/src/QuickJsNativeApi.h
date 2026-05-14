#pragma once

#if ARRANGE_WITH_QUICKJS_NG

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    struct QuickJsRuntimeContext;

    class QuickJsNativeApi {
    public:
        static void install(JSContext* context, QuickJsRuntimeContext& runtime);
    };
}

#endif
