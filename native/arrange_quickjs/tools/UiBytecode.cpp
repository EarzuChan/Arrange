#include "PackageModuleName.h"
#include "QuickJsBuildIdentity.h"
#include <quickjs.h>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>

namespace {
    using Path = std::filesystem::path;

    class Compiler {
       public:
        Compiler(Path input, Path output, const Path& list) : input_(std::move(input)), output_(std::move(output)) {
            std::ifstream names(list, std::ios::binary);
            if (!names) throw std::runtime_error("无法读取 UI 模块列表");
            for (std::string name; std::getline(names, name);) modules_.emplace(name, JS_UNDEFINED);
            if (modules_.empty() || !names.eof()) throw std::runtime_error("UI 模块列表无效");
            if (!runtime_) throw std::runtime_error("无法创建 QuickJS runtime");
            context_.reset(JS_NewContext(runtime_.get()));
            if (!context_) throw std::runtime_error("无法创建 QuickJS context");
            JS_SetModuleLoaderFunc(runtime_.get(), normalize, load, this);
        }

        ~Compiler() {
            for (const auto& [name, value] : modules_) JS_FreeValue(context_.get(), value);
        }

        void run() {
            for (auto& [name, value] : modules_) {
                if (JS_IsUndefined(value) && !load(context_.get(), name.c_str(), this)) fail(name);
            }
            for (const auto& [name, value] : modules_) {
                size_t size = 0;
                auto* bytes = JS_WriteObject(context_.get(), &size, value, JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE);
                if (!bytes) fail(name);
                const auto release = [this](uint8_t* pointer) { js_free(context_.get(), pointer); };
                const std::unique_ptr<uint8_t, decltype(release)> payload(bytes, release);
                const auto file = output_ / Path(std::u8string(name.begin(), name.end()) + u8".qbc");
                std::filesystem::create_directories(file.parent_path());
                std::ofstream out(file, std::ios::binary);
                if (!(out.write(reinterpret_cast<const char*>(bytes), static_cast<std::streamsize>(size)).flush())) throw std::runtime_error("无法写入字节码 " + name);
            }
        }

       private:
        static char* normalize(JSContext* context, const char* base, const char* specifier, void*) {
            const auto name = arrange::quickjs::resolvePackageModule(base, specifier);
            if (!name.empty()) return js_strdup(context, name.c_str());
            JS_ThrowReferenceError(context, "invalid UI package ESM specifier '%s'", specifier);
            return nullptr;
        }

        static JSModuleDef* load(JSContext* context, const char* name, void* opaque) {
            auto& compiler = *static_cast<Compiler*>(opaque);
            const auto item = compiler.modules_.find(name);
            if (item == compiler.modules_.end()) {
                JS_ThrowReferenceError(context, "UI build input has no module '%s'", name);
                return nullptr;
            }
            try {
                std::ifstream input(compiler.input_ / std::filesystem::u8path(name), std::ios::binary);
                if (!input) throw std::runtime_error("无法读取模块");
                const std::string source((std::istreambuf_iterator<char>(input)), {});
                const auto value = JS_Eval(context, source.data(), source.size(), name, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
                if (JS_IsException(value)) return nullptr;
                JS_FreeValue(context, item->second);
                item->second = value;
                return static_cast<JSModuleDef*>(JS_VALUE_GET_PTR(value));
            } catch (const std::exception& error) {
                JS_ThrowReferenceError(context, "%s: %s", name, error.what());
                return nullptr;
            }
        }

        [[noreturn]] void fail(const std::string& name) {
            auto* context = context_.get();
            const auto exception = JS_GetException(context);
            const char* message = JS_ToCString(context, exception);
            const auto stack = JS_GetPropertyStr(context, exception, "stack");
            const char* location = JS_IsString(stack) ? JS_ToCString(context, stack) : nullptr;
            const std::string detail = std::string(message ? message : "QuickJS error") + (location ? "\n" + std::string(location) : "");
            JS_FreeCString(context, location);
            JS_FreeCString(context, message);
            JS_FreeValue(context, stack);
            JS_FreeValue(context, exception);
            throw std::runtime_error("QuickJS 字节码编译失败 " + name + "：" + detail);
        }

        Path input_;
        Path output_;
        std::map<std::string, JSValue> modules_;
        std::unique_ptr<JSRuntime, decltype(&JS_FreeRuntime)> runtime_{JS_NewRuntime(), JS_FreeRuntime};
        std::unique_ptr<JSContext, decltype(&JS_FreeContext)> context_{nullptr, JS_FreeContext};
    };

    template <typename Char> int run(int argc, Char** argv) {
        try {
            if (argc != 4) throw std::runtime_error("使用方法：arrange_ui_bytecode <ESM目录> <输出目录> <模块列表>");
            Compiler(argv[1], argv[2], argv[3]).run();
            std::cout << ARRANGE_QUICKJS_BUILD_IDENTITY << '\n';
            return 0;
        } catch (const std::exception& error) {
            std::cerr << error.what() << '\n';
            return 1;
        }
    }
}

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) { return run(argc, argv); }
#else
int main(int argc, char** argv) { return run(argc, argv); }
#endif
