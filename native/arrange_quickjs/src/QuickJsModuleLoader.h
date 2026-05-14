#pragma once

#if ARRANGE_WITH_QUICKJS_NG

#include <filesystem>

extern "C" {
#include <quickjs.h>
}

namespace arrange::quickjs {
    class QuickJsModuleLoader {
    public:
        void setModuleRoot(const std::filesystem::path& entryPath);
        [[nodiscard]] const std::filesystem::path& moduleRoot() const noexcept { return moduleRoot_; }
        void clear() noexcept { moduleRoot_.clear(); }

        static char* normalize(JSContext* context, const char* moduleBaseName, const char* moduleName, void* opaque);
        static JSModuleDef* load(JSContext* context, const char* moduleName, void* opaque);

    private:
        static bool startsWithDotSpecifier(std::string_view specifier);

        std::filesystem::path moduleRoot_;
    };
}

#endif
