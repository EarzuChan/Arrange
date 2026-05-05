#include <arrange/juce/ErrorScreenModel.h>

#include <sstream>
#include <utility>

namespace arrange {
    const char* toString(ErrorSource source) noexcept {
        switch (source) {
        case ErrorSource::AppPackage: return "AppPackage";
        case ErrorSource::ScriptLoad: return "ScriptLoad";
        case ErrorSource::ScriptRuntime: return "ScriptRuntime";
        case ErrorSource::BridgeProtocol: return "BridgeProtocol";
        case ErrorSource::Hmr: return "HMR";
        case ErrorSource::Resource: return "Resource";
        case ErrorSource::Unknown: return "Unknown";
        }
        return "Unknown";
    }

    std::string ErrorScreenModel::diagnosticText() const {
        std::ostringstream out;
        out << "Arrange Error\n";
        out << "source: " << toString(source) << "\n";
        out << "title: " << title << "\n";
        out << "summary: " << summary << "\n";
        if (!detail.empty()) out << "detail: " << detail << "\n";
        if (!relatedPath.empty()) out << "path: " << relatedPath.string() << "\n";
        out << "retryAvailable: " << (retryAvailable ? "true" : "false") << "\n";
        return out.str();
    }

    ErrorScreenModel makeErrorScreenModel(ErrorSource source, std::string summary, std::string detail, std::filesystem::path relatedPath, bool retryAvailable) {
        ErrorScreenModel model;
        model.source = source;
        model.title = std::string("Arrange ") + toString(source) + " Error";
        model.summary = std::move(summary);
        model.detail = std::move(detail);
        model.relatedPath = std::move(relatedPath);
        model.retryAvailable = retryAvailable;
        return model;
    }
} // namespace arrange
