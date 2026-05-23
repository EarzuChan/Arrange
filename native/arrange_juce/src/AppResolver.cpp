#include <arrange/juce/AppResolver.h>

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

        bool pathEscapesBase(const std::filesystem::path& candidate, const std::filesystem::path& base) {
            const auto relative = candidate.lexically_relative(base);
            if (relative.empty()) return true;
            for (const auto& part : relative) {
                if (part == "..") return true;
                if (part == ".") continue;
                return false;
            }
            return true;
        }

        std::filesystem::path currentModulePath() {
#if defined(_WIN32)
            HMODULE module = nullptr;
            constexpr DWORD flags = GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                                    | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT;
            if (!GetModuleHandleExW(flags, reinterpret_cast<LPCWSTR>(&moduleAnchor), &module)) {
                return {};
            }

            std::wstring buffer(512, L'\0');
            for (;;) {
                const auto size = GetModuleFileNameW(
                    module,
                    buffer.data(),
                    static_cast<DWORD>(buffer.size()));
                if (size == 0) {
                    return {};
                }
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
            if (modulePath.empty()) {
                return {};
            }

            const auto normalized = std::filesystem::absolute(modulePath).lexically_normal();
            for (auto current = normalized.parent_path(); !current.empty();) {
                if (current.filename() == "Contents") {
                    return current / "Resources";
                }
                const auto parent = current.parent_path();
                if (parent == current) break;
                current = parent;
            }
            return normalized.parent_path();
        }

        std::filesystem::path resolvePackageDir(const std::filesystem::path& configuredPath) {
            if (configuredPath.is_absolute()) {
                return std::filesystem::absolute(configuredPath).lexically_normal();
            }

            const auto root = runtimeResourceRoot();
            if (root.empty()) {
                return {};
            }
            return (root / configuredPath).lexically_normal();
        }
    } // namespace

    ResolvedApp AppResolver::resolvePackage(const App& app) const {
        ResolvedApp result;
        if (!app.hasDist()) {
            result.error = "你啥也没给我给你加载啥app（笑）Call config.app.useDist(...).";
            return result;
        }

        result.packageDir = resolvePackageDir(app.distPath());
        result.entryPath = result.packageDir / DefaultEntry;

        if (result.packageDir.empty()) {
            result.error = "Arrange runtime resource root could not be discovered.";
            return result;
        }
        if (!std::filesystem::exists(result.packageDir)) {
            result.error = "Arrange UI package directory does not exist: " + result.packageDir.string();
            return result;
        }
        if (!std::filesystem::is_directory(result.packageDir)) {
            result.error = "Arrange UI package path is not a directory: " + result.packageDir.string();
            return result;
        }
        if (!std::filesystem::exists(result.entryPath)) {
            result.error = "Arrange UI package entry app.js does not exist: " + result.entryPath.string();
            return result;
        }
        if (!std::filesystem::is_regular_file(result.entryPath)) {
            result.error = "Arrange UI package entry app.js is not a file: " + result.entryPath.string();
            return result;
        }

        result.ok = true;
        return result;
    }

    ResolvedApp AppResolver::resolveDebug(const App& app, std::string_view explicitDevServerUrl) const {
        ResolvedApp result;
        result.ok = true;
        result.devServer = true;
        result.devServerUrl = devServerUrlFromEnvironment(
            explicitDevServerUrl.empty() ? app.liveUrl() : explicitDevServerUrl);

        const auto distPath = app.hasDist() ? app.distPath() : std::filesystem::path("ui");
        result.packageDir = resolvePackageDir(distPath);
        return result;
    }

    std::string AppResolver::devServerUrlFromEnvironment(std::string_view explicitDevServerUrl) const {
        if (!explicitDevServerUrl.empty()) return std::string(explicitDevServerUrl);
        if (const char* env = std::getenv("ARRANGE_DEV_SERVER")) {
            if (*env != '\0') return std::string(env);
        }
        return DefaultDevServer;
    }

    ResolvedResource resolvePackageResource(const std::filesystem::path& packageDir, std::string_view resource) {
        ResolvedResource result;
        result.packageDir = std::filesystem::absolute(packageDir).lexically_normal();
        result.resource = std::string(resource);

        if (result.resource.empty()) {
            result.error = "Arrange resource path is empty.";
            return result;
        }

        const auto resourcePath = std::filesystem::path(result.resource);
        if (resourcePath.is_absolute()) {
            result.error = "Arrange resource path must be relative to the UI package: " + result.resource;
            return result;
        }

        if (!std::filesystem::exists(result.packageDir) || !std::filesystem::is_directory(result.packageDir)) {
            result.error = "Arrange UI package directory is not available while resolving resource: " + result.packageDir.string();
            return result;
        }

        result.path = (result.packageDir / resourcePath).lexically_normal();
        if (pathEscapesBase(result.path, result.packageDir)) {
            result.error = "Arrange resource path escapes the UI package: " + result.resource;
            return result;
        }

        if (!std::filesystem::exists(result.path)) {
            result.error = "Arrange resource does not exist: " + result.path.string();
            return result;
        }
        if (!std::filesystem::is_regular_file(result.path)) {
            result.error = "Arrange resource is not a file: " + result.path.string();
            return result;
        }

        result.ok = true;
        return result;
    }
} // namespace arrange
