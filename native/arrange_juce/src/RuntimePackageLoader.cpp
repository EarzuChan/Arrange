#include <arrange/juce/PainterResources.h>
#include <arrange/juce/RuntimePackageLoader.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/AppResolver.h>
#include <arrange/juce/DevServerClient.h>

#if ARRANGE_WITH_QUICKJS_NG
#include <arrange/quickjs/AppScriptLoader.h>
#endif

#include <filesystem>
#include <string>

namespace arrange::juce {
    namespace {
        void setDiagnostic(RuntimePackageLoadResult& result, LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast = true) {
            result.diagnostic = RuntimeLoadDiagnostic{level, std::move(title), std::move(message), toast, coalesceToast};
        }
    }  // namespace

    RuntimePackageLoadResult RuntimePackageLoader::loadLiveSnapshot(const EditorConfig& config, AppResolver& resolver, const quickjs::LiveModuleSnapshot& snapshot, const std::string& error) const {
        RuntimePackageLoadResult result;
        const auto resolved = resolver.resolveDebug(config.app, config.devServerUrl);
        const auto bundleUrl = resolved.devServerUrl;
        result.packageDir = resolved.packageDir;

        if (!resolved.ok || bundleUrl.empty()) {
            result.error = makeErrorScreenModel(ErrorSource::AppPackage, resolved.error.empty() ? "Arrange dev server URL is invalid." : resolved.error, {}, resolved.devServerUrl);
            setDiagnostic(result, LogLevel::Error, "Live 源无效", result.error->summary, true);
            return result;
        }

#if ARRANGE_WITH_QUICKJS_NG
        if (!error.empty()) {
            result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, error, {}, bundleUrl);
            setDiagnostic(result, LogLevel::Error, "Live ESM 失败（意味不明）", error, true);
            return result;
        }

        auto scriptHost = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        scriptHost->setPainterLoader(packagePainterLoader(result.packageDir));
        const auto executed = scriptHost->executeLiveModules(snapshot);
        if (!executed.ok) {
            result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, executed.error, {}, bundleUrl);
            setDiagnostic(result, LogLevel::Error, "Live 运行时失败（意味不明）", executed.error, true);
            return result;
        }
        auto initialTransaction = scriptHost->takePendingTransaction();
        result.initialTransaction = std::move(initialTransaction);
        result.scriptHost = std::move(scriptHost);
        result.ok = true;
        setDiagnostic(result, LogLevel::Info, "Live App 已加载（喜）", bundleUrl, true);
        return result;
#else
        result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, "ArrangeEditor requires QuickJS-NG to execute dev server app.js. Build through Arrange::framework.", {}, bundleUrl);
        setDiagnostic(result, LogLevel::Error, "QuickJS disabled", "Cannot execute live app.js.", true);
        return result;
#endif
    }

    RuntimePackageLoadResult RuntimePackageLoader::loadDist(const EditorConfig& config, arrange::AppResolver& resolver) const {
        RuntimePackageLoadResult result;
        const auto resolved = resolver.resolveRelease(config.app);
        if (!resolved.ok) {
            result.error = makeErrorScreenModel(ErrorSource::AppPackage, resolved.error, {}, resolved.entryPath);
            setDiagnostic(result, LogLevel::Error, "Dist source invalid", resolved.error, true);
            return result;
        }
        result.packageDir = resolved.packageDir;

#if ARRANGE_WITH_QUICKJS_NG
        auto scriptHost = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        scriptHost->setPainterLoader(packagePainterLoader(result.packageDir));
        arrange::quickjs::AppScriptLoader loader(*scriptHost);
        const auto loaded = loader.loadEntry(resolved.entryPath);
        if (!loaded.ok) {
            result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, loaded.error, {}, loaded.modulePath);
            setDiagnostic(result, LogLevel::Error, "Dist runtime failed", loaded.error, true);
            return result;
        }
        auto initialTransaction = scriptHost->takePendingTransaction();
        result.initialTransaction = std::move(initialTransaction);
        result.scriptHost = std::move(scriptHost);
        result.ok = true;
        setDiagnostic(result, LogLevel::Info, "Loaded dist app", resolved.entryPath.string(), false);
        return result;
#else
        result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, "ArrangeEditor requires QuickJS-NG to execute ui/app.js. Build through Arrange::framework.", "Arrange runtime has no serialized fallback path; the native transaction API requires QuickJS-NG.", resolved.entryPath);
        setDiagnostic(result, LogLevel::Error, "QuickJS disabled", "Cannot execute dist ui/app.js.", true);
        return result;
#endif
    }
}  // namespace arrange::juce

#endif
