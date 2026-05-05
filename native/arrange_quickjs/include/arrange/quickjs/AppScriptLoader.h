#pragma once

#include <filesystem>
#include <string>
#include "ScriptHost.h"

namespace arrange::quickjs {
    struct ScriptLoadResult {
        bool ok = false;
        std::filesystem::path modulePath;
        std::string error;
    };

    class AppScriptLoader {
    public:
        explicit AppScriptLoader(ScriptHost& host) : host_(host) {}
        ScriptLoadResult loadEntry(const std::filesystem::path& entryPath);

    private:
        ScriptHost& host_;
    };
} // namespace arrange::quickjs
