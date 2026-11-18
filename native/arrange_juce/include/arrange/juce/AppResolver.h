#pragma once

#include <filesystem>
#include <arrange/core/UiPackage.h>
#include <memory>
#include <string>
#include <string_view>
#include "App.h"

namespace arrange {
    struct ResolvedApp {
        bool ok = false;
        bool devServer = false;
        std::filesystem::path packageDir;
        std::shared_ptr<const core::UiPackage> package;
        std::string devServerUrl;
        std::string error;
    };

    class AppResolver {
       public:
        static constexpr const char* DefaultDevServer = "http://127.0.0.1:9178";

        ResolvedApp resolvePackage(const App& app) const;

        ResolvedApp resolveRelease(const App& app) const {
            return resolvePackage(app);
        }

        ResolvedApp resolveDebug(const App& app, std::string_view explicitDevServerUrl = {}) const;
        std::string devServerUrlFromEnvironment(std::string_view explicitDevServerUrl = {}) const;
    };
}
