#include "QuickJsModuleLoader.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsValueReader.h"

#include <fstream>
#include <iterator>
#include <string>
#include <string_view>

namespace arrange::quickjs {
    void QuickJsModuleLoader::install(const LiveModuleSnapshot& snapshot) {
        live_ = true;
        for (const auto& module : snapshot.modules) sources_.insert_or_assign(module.url, module);
    }

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
        if (loader->live_) {
            std::string name(moduleName);
            if (startsWithDotSpecifier(name)) {
                const std::string base(moduleBaseName ? moduleBaseName : "/");
                name = (std::filesystem::path(base.substr(0, base.find('?'))).parent_path() / name).lexically_normal().generic_string();
            }
            if (!name.starts_with('/')) {
                JS_ThrowReferenceError(context, "unresolved live ESM specifier '%s'", moduleName);
                return nullptr;
            }
            return js_strdup(context, name.c_str());
        }
        std::filesystem::path resolved;
        if (std::filesystem::path(moduleName).is_absolute()) {
            resolved = moduleName;
        } else if (startsWithDotSpecifier(specifier)) {
            const std::filesystem::path base = moduleBaseName != nullptr && *moduleBaseName != '\0' ? std::filesystem::path(moduleBaseName).parent_path() : loader->moduleRoot_;
            resolved = base / moduleName;
        } else {
            JS_ThrowReferenceError(context, "unsupported bare module specifier '%s' in Arrange UI package", moduleName);
            return nullptr;
        }
        const auto normalized = std::filesystem::absolute(resolved).lexically_normal().generic_string();
        return js_strdup(context, normalized.c_str());
    }

    JSModuleDef* QuickJsModuleLoader::load(JSContext* context, const char* moduleName, void* opaque) {
        const auto& loader = *static_cast<QuickJsModuleLoader*>(opaque);
        if (loader.live_) {
            const auto source = loader.sources_.find(moduleName);
            if (source == loader.sources_.end()) {
                JS_ThrowReferenceError(context, "live ESM snapshot has no module '%s'", moduleName);
                return nullptr;
            }
            ScopedValue compiled(context, JS_Eval(context, source->second.source.data(), source->second.source.size(), moduleName, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY));
            if (JS_IsException(compiled.get())) return nullptr;
            auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled.get()));
            ScopedValue meta(context, JS_GetImportMeta(context, module));
            JS_SetPropertyStr(context, meta.get(), "url", JS_NewString(context, moduleName));
            return module;
        }
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
}  // namespace arrange::quickjs

#endif
