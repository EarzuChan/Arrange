#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <filesystem>
#include <memory>
#include <arrange/core/UiPackage.h>
#include <unordered_map>
#include <arrange/quickjs/LiveModule.h>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    class QuickJsModuleLoader {
       public:
        void install(const LiveModuleSnapshot& snapshot);

        void install(std::shared_ptr<const core::UiPackage> package) {
            package_ = std::move(package);
        }

        void clear() noexcept {
            package_.reset();
            sources_.clear();
            live_ = false;
        }

        static char* normalize(JSContext* context, const char* moduleBaseName, const char* moduleName, void* opaque);
        static JSModuleDef* load(JSContext* context, const char* moduleName, void* opaque);

       private:
        static bool startsWithDotSpecifier(std::string_view specifier);

        std::shared_ptr<const core::UiPackage> package_;
        bool live_ = false;
        std::unordered_map<std::string, LiveModuleSource> sources_;
    };
}

#endif
