#pragma once

#include <arrange/core/Bridge.h>
#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_WITH_QUICKJS_NG
#include <arrange/quickjs/QuickJsScriptHost.h>
#endif

#include <filesystem>
#include <memory>
#include <optional>
#include <string>

namespace arrange {
    class AppResolver;
}

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct RuntimeLoadDiagnostic {
        LogLevel level = LogLevel::Info;
        std::string title;
        std::string message;
        bool toast = false;
        bool coalesceToast = true;
    };

    struct RuntimePackageLoadResult {
        bool ok = false;
        bool serverUnavailable = false;
        std::filesystem::path packageDir;
        std::optional<ErrorScreenModel> error;
        std::optional<RuntimeLoadDiagnostic> diagnostic;
        std::optional<arrange::core::BridgeBatch> mountedBatch;
#if ARRANGE_WITH_QUICKJS_NG
    std::unique_ptr<arrange::quickjs::QuickJsScriptHost> scriptHost;
#endif
    };

    class RuntimePackageLoader final {
    public:
        RuntimePackageLoadResult loadLive(const EditorConfig& config, arrange::AppResolver& resolver) const;
        RuntimePackageLoadResult loadDist(const EditorConfig& config, arrange::AppResolver& resolver) const;
    };

#endif
} // namespace arrange::juce
