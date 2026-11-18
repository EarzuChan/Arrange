#include <arrange/juce/AppResolver.h>
#include <arrange/juce/UiPackage.h>

#include <cstdlib>
#include <string>

#if defined(_WIN32)
#include <windows.h>
#elif defined(__APPLE__)
#include <dlfcn.h>
#endif

namespace arrange {
    namespace {
        const int moduleAnchor = 0;

        std::filesystem::path currentModulePath() {
#if defined(_WIN32)
            HMODULE module = nullptr;
            constexpr DWORD flags = GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT;
            if (!GetModuleHandleExW(flags, reinterpret_cast<LPCWSTR>(&moduleAnchor), &module)) return {};

            std::wstring buffer(512, L'\0');
            for (;;) {
                const auto size = GetModuleFileNameW(module, buffer.data(), static_cast<DWORD>(buffer.size()));
                if (size == 0) return {};
                if (size < buffer.size() - 1) {
                    buffer.resize(size);
                    return std::filesystem::path(buffer);
                }
                buffer.resize(buffer.size() * 2);
            }
#elif defined(__APPLE__)
            Dl_info info{};
            if (dladdr(reinterpret_cast<const void*>(&moduleAnchor), &info) == 0 || info.dli_fname == nullptr) {
                return {};
            }
            return std::filesystem::path(info.dli_fname);
#else
            return {};
#endif
        }

        std::filesystem::path runtimeResourceRoot() {
            const auto modulePath = currentModulePath();
            if (modulePath.empty()) return {};

            const auto normalized = std::filesystem::absolute(modulePath).lexically_normal();
            for (auto current = normalized.parent_path(); !current.empty();) {
                if (current.filename() == "Contents") return current / "Resources";
                const auto parent = current.parent_path();
                if (parent == current) break;
                current = parent;
            }
            return normalized.parent_path();
        }

        std::filesystem::path resolvePackageDir(const std::filesystem::path& configuredPath) {
            if (configuredPath.is_absolute()) return std::filesystem::absolute(configuredPath).lexically_normal();

            const auto root = runtimeResourceRoot();
            if (root.empty()) return {};
            return (root / configuredPath).lexically_normal();
        }
    }

    ResolvedApp AppResolver::resolvePackage(const App& app) const {
        ResolvedApp result;
        if (!app.hasDist()) {
            result.error = "你啥也没给我给你加载啥app（笑），请调用`config.app.useDist(...)`喵";
            return result;
        }

        result.packageDir = resolvePackageDir(app.distPath());
        if (result.packageDir.empty())
            result.error = "找不到 Arrange 产品资源根";
        else
            try {
                result.package = juce::mountUiPackage(result.packageDir);
                result.ok = true;
            } catch (const std::exception& error) {
                result.error = error.what();
            }
        return result;
    }

    ResolvedApp AppResolver::resolveDebug(const App& app, std::string_view explicitDevServerUrl) const {
        ResolvedApp result;
        result.ok = true;
        result.devServer = true;
        result.devServerUrl = devServerUrlFromEnvironment(explicitDevServerUrl.empty() ? app.liveUrl() : explicitDevServerUrl);

        const auto distPath = app.hasDist() ? app.distPath() : std::filesystem::path("ui");
        result.packageDir = resolvePackageDir(distPath);
        return result;
    }

    std::string AppResolver::devServerUrlFromEnvironment(std::string_view explicitDevServerUrl) const {
        if (!explicitDevServerUrl.empty()) return std::string(explicitDevServerUrl);
        if (const char* env = std::getenv("ARRANGE_DEV_SERVER"))
            if (*env != '\0') return std::string(env);
        return DefaultDevServer;
    }

}
