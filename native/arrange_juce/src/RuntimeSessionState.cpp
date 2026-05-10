#include <arrange/juce/RuntimeSessionState.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/InputIntent.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/InteractionStateOwner.h>

#include <string>
#include <utility>

namespace arrange::juce {
    namespace {
        [[nodiscard]] ErrorSource frameErrorSource(RuntimeFrameErrorPhase phase) noexcept {
            return phase == RuntimeFrameErrorPhase::Pipeline
                       ? ErrorSource::BridgeProtocol
                       : ErrorSource::ScriptRuntime;
        }

        [[nodiscard]] const char* frameErrorTitle(RuntimeFrameErrorPhase phase) noexcept {
            switch (phase) {
            case RuntimeFrameErrorPhase::Pipeline:
                return "Frame pipeline failed";
            case RuntimeFrameErrorPhase::Event:
                return "Runtime event failed";
            case RuntimeFrameErrorPhase::Animation:
                return "Animation frame failed";
            case RuntimeFrameErrorPhase::None:
                break;
            }
            return "Runtime frame failed";
        }

        void emitDiagnostic(
            DiagnosticsState& diagnostics,
            ArrangeRuntime& runtime,
            LogLevel level,
            std::string title,
            std::string message = {},
            bool toast = false,
            bool coalesceToast = true) {
            if (diagnostics.emit(level, std::move(title), std::move(message), toast, coalesceToast)) {
                runtime.enqueueIntent(arrange::core::InputIntent::diagnostics("runtime diagnostic event"));
            }
        }
    } // namespace

    void RuntimeSessionState::reset(
        ArrangeRuntime& runtime,
        DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction) {
        loaded_ = false;
        runtime.reset();
        diagnostics.clearError();
        interaction.reset();
    }

    void RuntimeSessionState::resize(int width, int height, ArrangeRuntime& runtime) noexcept {
        width_ = width;
        height_ = height;
        runtime.enqueueIntent(arrange::core::InputIntent::resize(
            constraints(),
            "runtime viewport resize"));
    }

    arrange::core::Constraints RuntimeSessionState::constraints() const noexcept {
        return {0.0f, static_cast<float>(width_), 0.0f, static_cast<float>(height_)};
    }

    void RuntimeSessionState::markLoaded() noexcept { loaded_ = true; }

    void RuntimeSessionState::markUnloaded() noexcept { loaded_ = false; }

    void RuntimeSessionState::setLayoutTreeEmptyError(
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime) {
        diagnostics.setError(makeErrorScreenModel(
            ErrorSource::BridgeProtocol,
            "Arrange layout tree is empty after loading UI package."));
        loaded_ = false;
        emitDiagnostic(
            diagnostics,
            runtime,
            LogLevel::Error,
            "Layout tree empty",
            "Arrange layout tree is empty after loading UI package.",
            true);
    }

    bool RuntimeSessionState::loaded() const noexcept { return loaded_; }

    bool RuntimeSessionState::interactive(const DiagnosticsState& diagnostics) const noexcept {
        return loaded_ && !diagnostics.hasError();
    }

    bool RuntimeSessionState::applyFrameError(
        const RuntimeFramePumpResult& frame,
        DiagnosticsState& diagnostics,
        ArrangeRuntime& runtime,
        const std::filesystem::path& relatedPath) {
        if (frame.ok) {
            return false;
        }

        diagnostics.setError(makeErrorScreenModel(
            frameErrorSource(frame.errorPhase),
            frame.error,
            {},
            relatedPath));
        emitDiagnostic(
            diagnostics,
            runtime,
            LogLevel::Error,
            frameErrorTitle(frame.errorPhase),
            frame.error,
            true);
        loaded_ = false;
        return true;
    }
} // namespace arrange::juce

#endif
