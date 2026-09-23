#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <filesystem>
#include <unordered_map>
#include <arrange/quickjs/LiveModule.h>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    class QuickJsModuleLoader {
       public:
        void setModuleRoot(const std::filesystem::path& entryPath);
        void install(const LiveModuleSnapshot& snapshot);

        [[nodiscard]] const std::filesystem::path& moduleRoot() const noexcept {
            return moduleRoot_;
        }

        void clear() noexcept {
            moduleRoot_.clear();
            sources_.clear();
            live_ = false;
        }

        static char* normalize(JSContext* context, const char* moduleBaseName, const char* moduleName, void* opaque);
        static JSModuleDef* load(JSContext* context, const char* moduleName, void* opaque);

       private:
        static bool startsWithDotSpecifier(std::string_view specifier);

        std::filesystem::path moduleRoot_;
        bool live_ = false;
        std::unordered_map<std::string, LiveModuleSource> sources_;
    };
}  // namespace arrange::quickjs

#endif
