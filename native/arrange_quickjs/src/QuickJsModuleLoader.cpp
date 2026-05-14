#include "QuickJsModuleLoader.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsValueReader.h"

#include <fstream>
#include <iterator>
#include <string>
#include <string_view>

namespace arrange::quickjs {
    void QuickJsModuleLoader::setModuleRoot(const std::filesystem::path& entryPath) {
        moduleRoot_ = std::filesystem::absolute(entryPath).lexically_normal().parent_path();
    }

    bool QuickJsModuleLoader::startsWithDotSpecifier(std::string_view specifier) {
        return specifier == "." || specifier == ".." || specifier.starts_with("./") || specifier.starts_with("../");
    }

    char* QuickJsModuleLoader::normalize(JSContext* context, const char* moduleBaseName, const char* moduleName, void* opaque) {
        auto* loader = static_cast<QuickJsModuleLoader*>(opaque);
        if (loader == nullptr || moduleName == nullptr) return nullptr;
        const std::string_view specifier(moduleName);
        std::filesystem::path resolved;
        if (std::filesystem::path(moduleName).is_absolute()) {
            resolved = moduleName;
        }
        else if (startsWithDotSpecifier(specifier)) {
            const std::filesystem::path base = moduleBaseName != nullptr && *moduleBaseName != '\0'
                                                   ? std::filesystem::path(moduleBaseName).parent_path()
                                                   : loader->moduleRoot_;
            resolved = base / moduleName;
        }
        else {
            JS_ThrowReferenceError(context, "unsupported bare module specifier '%s' in Arrange UI package", moduleName);
            return nullptr;
        }
        const auto normalized = std::filesystem::absolute(resolved).lexically_normal().generic_string();
        return js_strdup(context, normalized.c_str());
    }

    JSModuleDef* QuickJsModuleLoader::load(JSContext* context, const char* moduleName, void*) {
        const std::filesystem::path modulePath = std::filesystem::path(moduleName).lexically_normal();
        std::ifstream stream(modulePath, std::ios::binary);
        if (!stream) {
            JS_ThrowReferenceError(context, "could not load Arrange UI module '%s'", moduleName);
            return nullptr;
        }
        const std::string source((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
        ScopedValue compiled(context, JS_Eval(context, source.data(), source.size(), modulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY));
        if (JS_IsException(compiled.get())) return nullptr;
        return static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled.get()));
    }
}

#endif
