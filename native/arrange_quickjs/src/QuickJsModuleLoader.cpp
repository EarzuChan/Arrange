#include "QuickJsModuleLoader.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsValueReader.h"

#include <string>
#include <string_view>

namespace arrange::quickjs {
    void QuickJsModuleLoader::install(const LiveModuleSnapshot& snapshot) {
        live_ = true;
        for (const auto& module : snapshot.modules) sources_.insert_or_assign(module.url, module);
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
        if (loader->package_) {
            if (startsWithDotSpecifier(specifier) && specifier.find_first_of("\\:?#") == std::string_view::npos && moduleBaseName && *moduleBaseName) {
                const auto from = std::filesystem::path(std::u8string_view(reinterpret_cast<const char8_t*>(moduleBaseName)));
                const auto relative = std::filesystem::path(std::u8string(specifier.begin(), specifier.end()));
                const auto name = (from.parent_path() / relative).lexically_normal().generic_u8string();
                if (!name.empty() && !name.starts_with(u8"../") && name != u8"..") return js_strdup(context, reinterpret_cast<const char*>(name.c_str()));
            }
            JS_ThrowReferenceError(context, "invalid UI package ESM specifier '%s'", moduleName);
            return nullptr;
        }
        JS_ThrowReferenceError(context, "no module source installed for '%s'", moduleName);
        return nullptr;
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
        if (loader.package_) {
            try {
                const auto source = loader.package_->read(moduleName, core::UiEntryKind::Module, core::UiEntryLimit);
                ScopedValue compiled(context, JS_Eval(context, source.data(), source.size(), moduleName, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY));
                if (JS_IsException(compiled.get())) return nullptr;
                auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(compiled.get()));
                ScopedValue meta(context, JS_GetImportMeta(context, module));
                JS_SetPropertyStr(context, meta.get(), "url", JS_NewString(context, moduleName));
                return module;
            } catch (const std::exception& error) {
                JS_ThrowReferenceError(context, "%s", error.what());
                return nullptr;
            }
        }
        JS_ThrowReferenceError(context, "no module source installed for '%s'", moduleName);
        return nullptr;
    }
}

#endif
