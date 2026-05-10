#include <arrange/juce/DiagnosticsState.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <sstream>
#include <utility>

namespace arrange::juce {
    namespace {
        std::string diagnosticsFrameSignature(
            ::juce::Rectangle<int> bounds,
            const DiagnosticsState& diagnostics,
            bool detailedErrorScreen,
            const DiagnosticsBadgeModel& badgeModel) {
            std::ostringstream out;
            out << bounds.getX() << ',' << bounds.getY() << ',' << bounds.getWidth() << ',' << bounds.getHeight();
            out << "|detail=" << (detailedErrorScreen ? 1 : 0);
            out << "|badge=" << static_cast<int>(diagnostics.badgeVisibility()) << ':' << badgeModel.text << ':' << badgeModel.dot.getARGB();
            out << "|toastVisibility=" << static_cast<int>(diagnostics.toastVisibility());
            if (const auto* error = diagnostics.error()) {
                out << "|error=" << error->diagnosticText();
            }
            for (const auto& toast : diagnostics.activeToastModels()) {
                out << "|toast=" << static_cast<int>(toast.level) << ':' << toast.title << ':' << toast.message;
            }
            return out.str();
        }
    } // namespace

    void DiagnosticsState::configure(DiagnosticsConfig config) {
        overlay_.configure(std::move(config));
        error_.reset();
        invalidatePreparedFrame();
    }

    bool DiagnosticsState::hasError() const noexcept {
        return error_.has_value();
    }

    const ErrorScreenModel* DiagnosticsState::error() const noexcept {
        return error_ ? &*error_ : nullptr;
    }

    bool DiagnosticsState::errorRetryAvailable() const noexcept {
        return error_ && error_->retryAvailable;
    }

    void DiagnosticsState::setError(ErrorScreenModel error) {
        error_ = std::move(error);
        invalidatePreparedFrame();
    }

    void DiagnosticsState::clearError() noexcept {
        error_.reset();
        invalidatePreparedFrame();
    }

    bool DiagnosticsState::emit(LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast) {
        return overlay_.emit(level, std::move(title), std::move(message), toast, coalesceToast);
    }

    bool DiagnosticsState::tick(double nowMillis) {
        return overlay_.tick(nowMillis);
    }

    bool DiagnosticsState::hasActiveToasts() const noexcept {
        return overlay_.hasActiveToasts();
    }

    std::vector<DiagnosticsToastModel> DiagnosticsState::activeToastModels() const {
        return overlay_.activeToastModels();
    }

    DiagnosticVisibility DiagnosticsState::badgeVisibility() const noexcept {
        return overlay_.badgeVisibility();
    }

    DiagnosticVisibility DiagnosticsState::toastVisibility() const noexcept {
        return overlay_.toastVisibility();
    }

    void DiagnosticsState::invalidatePreparedFrame() noexcept {
        preparedSignature_.clear();
        preparedErrorOps_.clear();
        preparedBadgeOps_.clear();
        preparedToastOps_.clear();
    }

    bool DiagnosticsState::prepareFrame(
        ::juce::Rectangle<int> bounds,
        bool detailedErrorScreen,
        const DiagnosticsBadgeModel& badgeModel) {
        const auto signature = diagnosticsFrameSignature(bounds, *this, detailedErrorScreen, badgeModel);
        if (signature == preparedSignature_) {
            return false;
        }

        preparedErrorOps_.clear();
        if (error_) {
            preparedErrorOps_ = diagnosticsScene_.buildErrorScreen(bounds, *error_, detailedErrorScreen);
        }
        preparedBadgeOps_ = diagnosticsScene_.buildBadge(bounds, badgeModel, badgeVisibility());
        preparedToastOps_ = diagnosticsScene_.buildToasts(bounds, activeToastModels(), toastVisibility());
        preparedSignature_ = signature;
        return true;
    }

    bool DiagnosticsState::copyErrorDiagnosticsToClipboard(DiagnosticsTextContext context) {
        if (!error_) {
            return false;
        }
        ::juce::SystemClipboard::copyTextToClipboard(diagnosticsText(std::move(context)));
        return true;
    }

    std::string DiagnosticsState::diagnosticsText(DiagnosticsTextContext context) const {
        if (context.error == nullptr && error_) {
            context.error = &*error_;
        }
        return overlay_.diagnosticsText(context);
    }

    std::string DiagnosticsState::currentLocalTimeLabel() {
        return DiagnosticsOverlay::currentLocalTimeLabel();
    }
} // namespace arrange::juce

#endif
