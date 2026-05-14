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
        model_.configure(std::move(config));
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

    bool DiagnosticsState::emit(DiagnosticEventInput input) {
        const auto changed = model_.emit(std::move(input));
        invalidatePreparedFrame();
        return changed;
    }

    bool DiagnosticsState::emit(LogLevel level, std::string title, std::string message, bool toast, bool coalesceToast) {
        const auto changed = model_.emit(level, std::move(title), std::move(message), toast, coalesceToast);
        invalidatePreparedFrame();
        return changed;
    }

    bool DiagnosticsState::tick(double nowMillis) {
        const auto changed = model_.tick(nowMillis);
        if (changed) invalidatePreparedFrame();
        return changed;
    }

    bool DiagnosticsState::hasActiveToasts() const noexcept {
        return model_.hasActiveToasts();
    }

    std::vector<DiagnosticsToastModel> DiagnosticsState::activeToastModels() const {
        return model_.activeToastModels();
    }

    DiagnosticVisibility DiagnosticsState::badgeVisibility() const noexcept {
        return model_.badgeVisibility();
    }

    DiagnosticVisibility DiagnosticsState::toastVisibility() const noexcept {
        return model_.toastVisibility();
    }

    void DiagnosticsState::setLogLevel(LogLevel level) noexcept {
        model_.setLogLevel(level);
    }

    void DiagnosticsState::setCategoryEnabled(DiagnosticCategory category, bool enabled) {
        model_.setCategoryEnabled(category, enabled);
    }

    void DiagnosticsState::setToastsEnabled(bool enabled) noexcept {
        model_.setToastsEnabled(enabled);
        invalidatePreparedFrame();
    }

    bool DiagnosticsState::categoryEnabled(DiagnosticCategory category) const {
        return model_.categoryEnabled(category);
    }

    const std::vector<DiagnosticEvent>& DiagnosticsState::recentEvents() const noexcept {
        return model_.recentEvents();
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
        return model_.diagnosticsText(context);
    }

    std::string DiagnosticsState::currentLocalTimeLabel() {
        return DiagnosticsModel::currentLocalTimeLabel();
    }
} // namespace arrange::juce

#endif
