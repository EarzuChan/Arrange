#include <arrange/juce/EditorChromeModel.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/PackageRuntimeSource.h>

namespace arrange::juce {
    const char* EditorChromeModel::buildModeLabel() noexcept {
#if defined(NDEBUG)
        return "Release";
#else
        return "Debug";
#endif
    }

    std::string EditorChromeModel::windowTitle(
        std::string_view baseTitle,
        const PackageRuntimeSource& package,
        const DiagnosticsState& diagnostics) const {
#if defined(NDEBUG)
        return std::string(baseTitle);
#else
        std::string title(baseTitle);
        title += " [Debug ";
        if (!package.config().app.hasAnySource()) {
            title += "no app";
        }
        else if (diagnostics.hasError()) {
            title += "error";
        }
        else if (package.activeSource() == PackageSource::Dist && package.lastLiveUnavailable()) {
            title += "dist fallback";
        }
        else {
            title += packageSourceLabel(package.activeSource());
        }
        title += "]";
        return title;
#endif
    }

    DiagnosticsBadgeModel EditorChromeModel::diagnosticsBadgeModel(
        const PackageRuntimeSource& package,
        const DiagnosticsState& diagnostics) const {
        DiagnosticsBadgeModel model;
        model.dot = ::juce::Colour(0xffef4444);
        model.text = std::string(buildModeLabel()) + " " + packageSourceLabel(package.activeSource());

        if (package.activeSource() == PackageSource::Live) {
            model.dot = ::juce::Colour(0xff22c55e);
        }
        if (package.activeSource() == PackageSource::Dist) {
            model.dot = package.lastLiveUnavailable()
                            ? ::juce::Colour(0xfff59e0b)
                            : ::juce::Colour(0xff3b82f6);
        }
        if (diagnostics.hasError()) {
            model.text = std::string(buildModeLabel()) + " error";
        }
        if (!package.config().app.hasAnySource()) {
            model.text = std::string(buildModeLabel()) + " no app";
        }

        return model;
    }

    DiagnosticsTextContext EditorChromeModel::diagnosticsTextContext(
        const PackageRuntimeSource& package,
        const DiagnosticsState& diagnostics) const {
        DiagnosticsTextContext context;
        context.activeSource = packageSourceLabel(package.activeSource());
        context.liveRuntimeEnabled = package.liveRuntimeEnabled();
        context.hasLive = package.config().app.hasLive();
        context.hasDist = package.config().app.hasDist();
        context.devServerUrl = package.config().devServerUrl;
        context.appPath = package.config().app.distPath();
        context.error = diagnostics.error();
        return context;
    }
} // namespace arrange::juce

#endif
