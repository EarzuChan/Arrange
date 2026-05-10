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
        void setDiagnostic(RuntimePackageLoadResult& result, LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast = true) { result.diagnostic = RuntimeLoadDiagnostic{level, std::move(title), std::move(message), toast, coalesceToast}; }
    } // namespace

    RuntimePackageLoadResult RuntimePackageLoader::loadLive(const EditorConfig& config, arrange::AppResolver& resolver) const {
        RuntimePackageLoadResult result;
        const auto resolved = resolver.resolveDebug(config.app, config.devServerUrl);
        const auto bundleUrl = arrange::devBundleHttpUrl(resolved.devServerUrl);
        result.packageDir = std::filesystem::absolute(config.app.distPath()).lexically_normal();

        if (!resolved.ok || bundleUrl.empty()) {
            result.error = makeErrorScreenModel(ErrorSource::AppPackage, resolved.error.empty() ? "Arrange dev server URL is invalid." : resolved.error, {}, resolved.devServerUrl);
            setDiagnostic(result, LogLevel::Error, "Live source invalid", result.error->summary, true);
            return result;
        }

#if ARRANGE_WITH_QUICKJS_NG
int statusCode = 0;
const auto options = ::juce::URL::InputStreamOptions(::juce::URL::ParameterHandling::inAddress)
                     .withConnectionTimeoutMs(800)
                     .withNumRedirectsToFollow(0)
                     .withStatusCode(&statusCode)
                     .withHttpRequestCmd("GET");
auto stream = ::juce::URL(bundleUrl).createInputStream(options);
  if (!stream) {
    result.serverUnavailable = true;
    result.error = makeErrorScreenModel(
      ErrorSource::AppPackage,
      "Arrange dev server is not reachable: " + bundleUrl,
      "Debug fallback may load the last built ui/app.js, but true hot reload needs pnpm dev.",
      bundleUrl);
    setDiagnostic(result, LogLevel::Warn, "Live unavailable", bundleUrl, true);
    return result;
  }

const auto source = stream->readEntireStreamAsString().toStdString();
  if (statusCode!= 200) {
    result.error = makeErrorScreenModel(
      ErrorSource::ScriptRuntime,
      "Arrange dev bundle request failed with HTTP " + std::to_string(statusCode) + ".\n" + source,
      "Fix the Vue/SFC build error and save again; ArrangeEditor will retry through the same reload path.",
      bundleUrl);
    setDiagnostic(result, LogLevel::Error, "Live bundle failed", "HTTP " + std::to_string(statusCode) + " from " + bundleUrl, true);
    return result;
  }

auto scriptHost = std::make_unique<arrange::quickjs::QuickJsScriptHost>();
const auto modulePath = result.packageDir / "__arrange_dev_app.js";
const auto executed = scriptHost->executeModule(modulePath, source);
  if (!executed.ok) {
    result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, executed.error, {}, bundleUrl);
    setDiagnostic(result, LogLevel::Error, "Live runtime failed", executed.error, true);
    return result;
  }
  auto initialTransaction = scriptHost->takePendingTransaction();
  if (!initialTransaction) {
    result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, "Arrange dev bundle executed but did not mount a UI tree.", {}, bundleUrl);
    setDiagnostic(result, LogLevel::Error, "Live mount missing", bundleUrl, true);
    return result;
  }

result.initialTransaction=std::move(*initialTransaction);
result.scriptHost= std::move (scriptHost);
result.ok=true;
setDiagnostic(result, LogLevel::Info, "Loaded live app", bundleUrl, true);
  return result;
#else
result.error= makeErrorScreenModel(
    ErrorSource::ScriptRuntime,
    "ArrangeEditor requires QuickJS-NG to execute dev server app.js. Reconfigure with ARRANGE_WITH_QUICKJS_NG=ON.",
    {},
bundleUrl);
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
arrange::quickjs::AppScriptLoader loader(*scriptHost);
const auto loaded = loader.loadEntry(resolved.entryPath);
  if (!loaded.ok) {
    result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, loaded.error, {}, loaded.modulePath);
    setDiagnostic(result, LogLevel::Error, "Dist runtime failed", loaded.error, true);
    return result;
  }
  auto initialTransaction = scriptHost->takePendingTransaction();
  if (!initialTransaction) {
    result.error = makeErrorScreenModel(ErrorSource::ScriptRuntime, "Arrange app executed but did not mount a UI tree.", {}, resolved.entryPath);
    setDiagnostic(result, LogLevel::Error, "Dist mount missing", resolved.entryPath.string(), true);
    return result;
  }

result.initialTransaction=std::move(*initialTransaction);
result.scriptHost= std::move (scriptHost);
result.ok=true;
setDiagnostic(result, LogLevel::Info, "Loaded dist app", resolved.entryPath.string(), false);
  return result;
#else
result.error= makeErrorScreenModel(
    ErrorSource::ScriptRuntime,
    "ArrangeEditor requires QuickJS-NG to execute ui/app.js. Reconfigure with ARRANGE_WITH_QUICKJS_NG=ON.",
    "The JS-side app.bridge.bin artifact is only a smoke-test fixture and is not a native runtime fallback.",
resolved.entryPath);
setDiagnostic(result, LogLevel::Error, "QuickJS disabled", "Cannot execute dist ui/app.js.", true);
  return result;
#endif
}

} // namespace arrange::juce

#endif
