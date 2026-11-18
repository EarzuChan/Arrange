#include "QuickJsModuleLoader.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsValueReader.h"
#include "PackageModuleName.h"
#include "QuickJsBuildIdentity.h"
#include <arrange/quickjs/QuickJsBuild.h>

#include <string>
#include <string_view>

namespace arrange::quickjs {
    std::string_view buildIdentity() noexcept { return ARRANGE_QUICKJS_BUILD_IDENTITY; }

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
            const auto name = resolvePackageModule(moduleBaseName ? moduleBaseName : "", specifier);
            if (!name.empty()) return js_strdup(context, name.c_str());
            JS_ThrowReferenceError(context, "invalid UI package ESM specifier '%s'", moduleName);
            return nullptr;
        }
        JS_ThrowReferenceError(context, "no module source installed for '%s'", moduleName);
        return nullptr;
    }

    JSModuleDef* QuickJsModuleLoader::load(JSContext* context, const char* moduleName, void* opaque) {
        const auto& loader = *static_cast<QuickJsModuleLoader*>(opaque);
        try {
            JSValue value;
            if (loader.live_) {
                const auto source = loader.sources_.find(moduleName);
                if (source == loader.sources_.end()) throw std::runtime_error("live ESM snapshot has no module");
                const auto& text = source->second.source;
                value = JS_Eval(context, text.data(), text.size(), moduleName, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
            } else if (loader.package_) {
                const auto bytes = loader.package_->read(moduleName, core::UiEntryKind::Module, core::UiEntryLimit);
                if (loader.package_->scriptFormat() == core::UiScriptFormat::Bytecode)
                    value = JS_ReadObject(context, reinterpret_cast<const uint8_t*>(bytes.data()), bytes.size(), JS_READ_OBJ_BYTECODE);
                else
                    value = JS_Eval(context, bytes.data(), bytes.size(), moduleName, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
            } else {
                throw std::runtime_error("no module source installed");
            }
            ScopedValue compiled(context, value);
            if (JS_IsException(value)) {
                if (loader.package_ && loader.package_->scriptFormat() == core::UiScriptFormat::Bytecode) {
                    ScopedValue exception(context, JS_GetException(context));
                    const char* detail = JS_ToCString(context, exception.get());
                    JS_ThrowReferenceError(context, "UI bytecode '%s': %s", moduleName, detail ? detail : "read failed");
                    if (detail) JS_FreeCString(context, detail);
                }
                return nullptr;
            }
            if (JS_VALUE_GET_TAG(value) != JS_TAG_MODULE) throw std::runtime_error("payload is not an ESM module");
            auto* module = static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(value));
            const auto atom = JS_GetModuleName(context, module);
            const char* name = JS_AtomToCString(context, atom);
            const bool matches = name && std::string_view(name) == moduleName;
            if (name) JS_FreeCString(context, name);
            JS_FreeAtom(context, atom);
            if (!matches) throw std::runtime_error("ESM module name differs from manifest");
            ScopedValue meta(context, JS_GetImportMeta(context, module));
            if (JS_IsException(meta.get()) || JS_SetPropertyStr(context, meta.get(), "url", JS_NewString(context, moduleName)) < 0) return nullptr;
            return module;
        } catch (const std::exception& error) {
            JS_ThrowReferenceError(context, "UI module '%s': %s", moduleName, error.what());
            return nullptr;
        }
    }
}

#endif
