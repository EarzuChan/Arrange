#pragma once

#include <filesystem>
#include <string>
#include <string_view>
#include "App.h"

namespace arrange {
    struct ResolvedApp {
        bool ok = false;
        bool devServer = false;
        std::filesystem::path packageDir;
        std::filesystem::path entryPath;
        std::string devServerUrl;
        std::string error;
    };

    struct ResolvedResource {
        bool ok = false;
        std::filesystem::path packageDir;
        std::filesystem::path path;
        std::string resource;
        std::string error;
    };

    ResolvedResource resolvePackageResource(const std::filesystem::path& packageDir, std::string_view resource);

    class AppResolver {
    public:
        static constexpr const char* DefaultEntry = "app.mjs";
        static constexpr const char* DefaultDevServer = "http://127.0.0.1:9178";

        ResolvedApp resolvePackage(const App& app) const;
        ResolvedApp resolveRelease(const App& app) const { return resolvePackage(app); }
        ResolvedApp resolveDebug(const App& app, std::string_view explicitDevServerUrl = {}) const;
        std::string devServerUrlFromEnvironment(std::string_view explicitDevServerUrl = {}) const;
    };
} // namespace arrange
