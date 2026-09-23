#pragma once

#include <arrange/core/MutationTransaction.h>
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

    struct RuntimeLoadLog {
        LogLevel level = LogLevel::Info;
        std::string message;
    };

    struct RuntimeLoadToast {
        LogLevel level = LogLevel::Info;
        std::string title;
        std::string message;
        bool coalesce = true;
    };

    struct RuntimePackageLoadResult {
        bool ok = false;
        bool serverUnavailable = false;
        std::filesystem::path packageDir;
        std::optional<ErrorScreenModel> error;
        std::optional<RuntimeLoadLog> log;
        std::optional<RuntimeLoadToast> toast;
        std::optional<arrange::core::MutationTransaction> initialTransaction;
#if ARRANGE_WITH_QUICKJS_NG
        std::unique_ptr<arrange::quickjs::QuickJsScriptHost> scriptHost;
#endif
    };

    class RuntimePackageLoader final {
       public:
        RuntimePackageLoadResult loadLiveSnapshot(const EditorConfig& config, arrange::AppResolver& resolver, const quickjs::LiveModuleSnapshot& snapshot, const std::string& error) const;
        RuntimePackageLoadResult loadDist(const EditorConfig& config, arrange::AppResolver& resolver) const;
    };

#endif
}  // namespace arrange::juce
