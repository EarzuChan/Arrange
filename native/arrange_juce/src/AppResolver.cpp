#include <arrange/juce/AppResolver.h>

#include <cstdlib>
#include <string>

namespace arrange {
    namespace {
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
    } // namespace

    ResolvedApp AppResolver::resolvePackage(const App& app) const {
        ResolvedApp result;
        if (!app.hasDist()) {
            result.error = "你啥也没给我给你加载啥app（笑）Call config.app.useDist(...).";
            return result;
        }
        result.packageDir = std::filesystem::absolute(app.distPath()).lexically_normal();
        result.entryPath = result.packageDir / DefaultEntry;

        if (!std::filesystem::exists(result.packageDir)) {
            result.error = "Arrange UI package directory does not exist: " + result.packageDir.string();
            return result;
        }
        if (!std::filesystem::is_directory(result.packageDir)) {
            result.error = "Arrange UI package path is not a directory: " + result.packageDir.string();
            return result;
        }
        if (!std::filesystem::exists(result.entryPath)) {
            result.error = "Arrange UI package entry app.mjs does not exist: " + result.entryPath.string();
            return result;
        }
        if (!std::filesystem::is_regular_file(result.entryPath)) {
            result.error = "Arrange UI package entry app.mjs is not a file: " + result.entryPath.string();
            return result;
        }

        result.ok = true;
        return result;
    }

    ResolvedApp AppResolver::resolveDebug(const App& app, std::string_view explicitDevServerUrl) const {
        ResolvedApp result;
        result.ok = true;
        result.devServer = true;
        result.devServerUrl = devServerUrlFromEnvironment(explicitDevServerUrl.empty() ? app.liveUrl() : explicitDevServerUrl);
        result.packageDir = app.hasDist() ? std::filesystem::absolute(app.distPath()).lexically_normal() : std::filesystem::current_path();
        return result;
    }

    std::string AppResolver::devServerUrlFromEnvironment(std::string_view explicitDevServerUrl) const {
        if (!explicitDevServerUrl.empty()) return std::string(explicitDevServerUrl);
        if (const char* env = std::getenv("ARRANGE_DEV_SERVER")) { if (*env != '\0') return std::string(env); }
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
