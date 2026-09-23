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
        void setLog(RuntimePackageLoadResult& result, LogLevel level, std::string message) {
            result.log = RuntimeLoadLog{level, std::move(message)};
        }

        void setToast(RuntimePackageLoadResult& result, LogLevel level, std::string title, std::string message, bool coalesce = true) {
            result.toast = RuntimeLoadToast{level, std::move(title), std::move(message), coalesce};
        }
    }  // namespace

    RuntimePackageLoadResult RuntimePackageLoader::loadLiveSnapshot(const EditorConfig& config, AppResolver& resolver, const quickjs::LiveModuleSnapshot& snapshot, const std::string& error) const {
        RuntimePackageLoadResult result;
        const auto resolved = resolver.resolveDebug(config.app, config.devServerUrl);
        const auto bundleUrl = resolved.devServerUrl;
        result.packageDir = resolved.packageDir;

        if (!resolved.ok || bundleUrl.empty()) {
            result.error = makeErrorScreenModel(ErrorSource::AppPackage, resolved.error.empty() ? "Arrange 开发服务器地址无效" : resolved.error, {}, resolved.devServerUrl);
            setToast(result, LogLevel::Error, "Live 源无效", result.error->summary);
            return result;
        }

#if ARRANGE_WITH_QUICKJS_NG
        if (!error.empty()) {
            result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, error, {}, bundleUrl);
            setToast(result, LogLevel::Error, "Live 模块加载失败", error);
            return result;
        }

        auto scriptHost = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
        scriptHost->setPainterLoader(packagePainterLoader(result.packageDir));
        const auto executed = scriptHost->executeLiveModules(snapshot);
        if (!executed.ok) {
            result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, executed.error, {}, bundleUrl);
            setToast(result, LogLevel::Error, "Live 运行时异常", executed.error);
            return result;
        }
        auto initialTransaction = scriptHost->takePendingTransaction();
        result.initialTransaction = std::move(initialTransaction);
        result.scriptHost = std::move(scriptHost);
        result.ok = true;
        setToast(result, LogLevel::Info, "Live App 已启动", bundleUrl);
        return result;
#else
        result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, "ArrangeEditor 需要 QuickJS-NG 才能运行开发服务器 app.js，请通过 Arrange::framework 构建", {}, bundleUrl);
        setToast(result, LogLevel::Error, "QuickJS 不可用", "无法运行 Live app.js");
        return result;
#endif
    }

    RuntimePackageLoadResult RuntimePackageLoader::loadDist(const EditorConfig& config, arrange::AppResolver& resolver) const {
        RuntimePackageLoadResult result;
        const auto resolved = resolver.resolveRelease(config.app);
        if (!resolved.ok) {
            result.error = makeErrorScreenModel(ErrorSource::AppPackage, resolved.error, {}, resolved.entryPath);
            setToast(result, LogLevel::Error, "Dist 应用源无效", resolved.error);
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
            setToast(result, LogLevel::Error, "Dist 运行时异常", loaded.error);
            return result;
        }
        auto initialTransaction = scriptHost->takePendingTransaction();
        result.initialTransaction = std::move(initialTransaction);
        result.scriptHost = std::move(scriptHost);
        result.ok = true;
        setLog(result, LogLevel::Info, "Dist App 已启动 " + resolved.entryPath.string());
        return result;
#else
        result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, "ArrangeEditor 需要 QuickJS-NG 才能运行 ui/app.js，请通过 Arrange::framework 构建", "Arrange 运行时没有序列化回退路径，原生事务 API 需要 QuickJS-NG", resolved.entryPath);
        setToast(result, LogLevel::Error, "QuickJS 不可用", "无法运行 Dist ui/app.js");
        return result;
#endif
    }
}  // namespace arrange::juce

#endif
