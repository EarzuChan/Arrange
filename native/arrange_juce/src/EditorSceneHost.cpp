#include <arrange/juce/EditorSceneHost.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/Layout.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/juce/ArrangeEditor.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/EditorChromeModel.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/EditorDebugActions.h>
#include <arrange/juce/FramePumpDriver.h>
#include <arrange/juce/TextInputMutationSink.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/PackageRuntimeSource.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/JucePointerInputAdapter.h>
#include <arrange/juce/JuceRepaintAdapter.h>
#include <arrange/juce/RuntimePackageBinder.h>
#include <arrange/juce/RuntimeSessionState.h>
#include <arrange/juce/JuceTextInputAdapter.h>

#include <utility>

namespace arrange::juce {
    namespace {
        constexpr arrange::core::NodeId rootNodeId = 1;
    } // namespace

    class EditorSceneHost::Impl final {
    public:
        Impl()
            : textLayoutService_(textMeasurer_),
              runtime_(arrange::core::SceneFramePipeline(arrange::core::LayoutEngine(textLayoutService_))),
              interaction_(textLayoutService_) {}

        void configure(const EditorConfig& config) {
            config_ = config;
            diagnostics_.configure(config_.diagnostics);
            applyPackageLoadOutcome(packageSource_.configure(config_));
        }

        void reload() { applyPackageLoadOutcome(packageSource_.reload()); }

        void reloadFromDevServer() { applyPackageLoadOutcome(packageSource_.reloadFromDevServer()); }

        void manualReload(bool toggleLive) {
            applyPackageLoadOutcome(packageSource_.manualReload(toggleLive));
        }

        bool triggerManualDiagnosticError() {
            const auto result = actions_.triggerManualDiagnosticError(
                diagnostics_,
                interaction_,
                runtime_,
                config_.app.distPath());
            if (result.clearLoaded) {
                session_.markUnloaded();
            }
            return result.handled;
        }

        bool pushManualDiagnosticToast() {
            return actions_.pushManualDiagnosticToast(diagnostics_, runtime_);
        }

        bool copyDiagnosticsToClipboard() {
            return actions_.copyDiagnosticsToClipboard(
                diagnostics_,
                runtime_,
                chrome_.diagnosticsTextContext(packageSource_, diagnostics_));
        }

        void repaintDirty(::juce::Component& owner, bool fullIfNoBounds) {
            repaint_.repaintDirty(owner, runtime_, diagnostics_, rootNodeId, session_.loaded(), fullIfNoBounds);
        }

        bool consumeDevReloadRequested() { return packageSource_.consumeDevReloadRequested(); }

        EditorTimerDemand timerDemand() const {
            return {wantsTimer(), desiredTimerFrequencyHz(), wantsFrameClock()};
        }

        bool pumpFrame(double nowMillis) {
            const auto frameChanged = framePump_.pumpFrame(
                runtime_,
                session_,
                diagnostics_,
                interaction_,
                rootNodeId,
                config_.app.distPath(),
                lastPaintBounds_,
                config_.diagnostics.errorScreen,
                chrome_.diagnosticsBadgeModel(packageSource_, diagnostics_),
                nowMillis);
            const auto resourcesChanged = paint_.prepareResources(runtime_, diagnostics_);
            const auto diagnosticsChanged = diagnostics_.prepareFrame(
                lastPaintBounds_,
                config_.diagnostics.errorScreen,
                chrome_.diagnosticsBadgeModel(packageSource_, diagnostics_));
            if (diagnosticsChanged) {
                runtime_.publishDiagnosticsDrawOps(
                    diagnostics_.errorOpsSnapshot(),
                    diagnostics_.badgeOpsSnapshot(),
                    diagnostics_.toastOpsSnapshot());
                runtime_.enqueueIntent(arrange::core::InputIntent::diagnostics("diagnostics frame prepared"));
            }
            return frameChanged || diagnosticsChanged || resourcesChanged;
        }

        std::string windowTitle(std::string_view baseTitle) const {
            return chrome_.windowTitle(baseTitle, packageSource_, diagnostics_);
        }

        void resized(int width, int height) {
            lastPaintBounds_ = {0, 0, width, height};
            session_.resize(width, height, runtime_);
        }

        void paint(::juce::Graphics& g, ::juce::Rectangle<int> bounds) {
            lastPaintBounds_ = bounds;
            paint_.paint(
                g,
                bounds,
                runtime_,
                diagnostics_,
                interaction_,
                rootNodeId,
                session_.loaded(),
                config_.diagnostics.errorScreen,
                chrome_.diagnosticsBadgeModel(packageSource_, diagnostics_));
        }

        void pointerDown(const ::juce::MouseEvent& event) {
            pointerEvents_.pointerDown(
                runtime_,
                session_,
                diagnostics_,
                interaction_,
                rootNodeId,
                event,
                inputCallbacks());
        }

        bool pointerDrag(const ::juce::MouseEvent& event) {
            return pointerEvents_.pointerDrag(
                runtime_,
                session_,
                diagnostics_,
                interaction_,
                event,
                inputCallbacks());
        }

        void pointerUp(const ::juce::MouseEvent& event) {
            if (diagnostics_.hasError()) {
                if (diagnostics_.errorRetryAvailable()) {
                    applyPackageLoadOutcome(packageSource_.reload());
                }
                return;
            }
            (void)pointerEvents_.pointerUp(runtime_, session_, diagnostics_, interaction_, rootNodeId, event);
        }

        bool wheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
            return pointerEvents_.wheelMove(
                runtime_,
                session_,
                diagnostics_,
                interaction_,
                rootNodeId,
                event,
                wheel);
        }

        bool isTextInputActive() const {
            return textInput_.isActive(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        ::juce::Range<int> highlightedRegion() const {
            return textInput_.highlightedRegion(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        bool setHighlightedRegion(const ::juce::Range<int>& range) {
            return textInput_.setHighlightedRegion(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                range,
                inputCallbacks());
        }

        bool setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& ranges) {
            return textInput_.setTemporaryUnderlining(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                ranges,
                inputCallbacks());
        }

        ::juce::String textInRange(const ::juce::Range<int>& range) const {
            return textInput_.textInRange(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                range);
        }

        bool insertTextAtCaret(const ::juce::String& textToInsert) {
            return textInput_.insertTextAtCaret(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                textToInsert,
                inputCallbacks());
        }

        int caretPosition() const {
            return textInput_.caretPosition(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        int totalNumChars() const {
            return textInput_.totalNumChars(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        int charIndexForPoint(::juce::Point<int> point) const {
            return textInput_.charIndexForPoint(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                point);
        }

        ::juce::Rectangle<int> caretRectangleForCharIndex(int characterIndex) const {
            return textInput_.caretRectangleForCharIndex(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                characterIndex);
        }

        ::juce::RectangleList<int> textBounds(::juce::Range<int> range) const {
            return textInput_.textBounds(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                range);
        }

        bool keyPressed(const ::juce::KeyPress& key) {
            return textInput_.keyPressed(
                runtime_.scene().tree(),
                session_,
                diagnostics_,
                interaction_,
                key,
                inputCallbacks());
        }

    private:
        bool wantsDevTimer() const { return packageSource_.wantsDevTimer(); }

        bool hasPendingFrameWork() const { return runtime_.hasPendingFrameWork(); }

        bool wantsTimer() const {
            return wantsDevTimer()
                   || diagnostics_.hasActiveToasts()
                   || wantsFrameClock();
        }

        bool wantsFrameClock() const {
            return runtime_.hasPendingAnimationFrame() || hasPendingFrameWork();
        }

        int desiredTimerFrequencyHz() const {
            return wantsFrameClock() ? runtime_.desiredTimerFrequencyHz() : 20;
        }

        TextInputCallbacks inputCallbacks() { return inputState_.callbacks(runtime_); }

        void applyPackageLoadOutcome(PackageLoadOutcome outcome) {
            packageBinder_.apply(
                std::move(outcome),
                session_,
                runtime_,
                diagnostics_,
                interaction_,
                paint_);
        }

        EditorConfig config_;
        JuceTextMeasurer textMeasurer_;
        arrange::core::TextLayoutService textLayoutService_;
        PackageRuntimeSource packageSource_;
        RuntimePackageBinder packageBinder_;
        EditorChromeModel chrome_;
        EditorDebugActions actions_;
        ArrangeRuntime runtime_;
        RuntimeSessionState session_;
        InteractionStateOwner interaction_;
        TextInputMutationSink inputState_;
        JucePointerInputAdapter pointerEvents_;
        JuceTextInputAdapter textInput_;
        FramePumpDriver framePump_;
        PassivePaintRenderer paint_;
        DiagnosticsState diagnostics_;
        JuceRepaintAdapter repaint_;
        ::juce::Rectangle<int> lastPaintBounds_;
    };

    EditorSceneHost::EditorSceneHost() : impl_(std::make_unique<Impl>()) {}

    EditorSceneHost::~EditorSceneHost() = default;

    void EditorSceneHost::configure(const EditorConfig& config) { impl_->configure(config); }
    void EditorSceneHost::reload() { impl_->reload(); }
    void EditorSceneHost::reloadFromDevServer() { impl_->reloadFromDevServer(); }
    void EditorSceneHost::manualReload(bool toggleLive) { impl_->manualReload(toggleLive); }

    bool EditorSceneHost::triggerManualDiagnosticError() { return impl_->triggerManualDiagnosticError(); }
    bool EditorSceneHost::pushManualDiagnosticToast() { return impl_->pushManualDiagnosticToast(); }
    bool EditorSceneHost::copyDiagnosticsToClipboard() { return impl_->copyDiagnosticsToClipboard(); }

    void EditorSceneHost::repaintDirty(::juce::Component& owner, bool fullIfNoBounds) {
        impl_->repaintDirty(owner, fullIfNoBounds);
    }

    bool EditorSceneHost::consumeDevReloadRequested() { return impl_->consumeDevReloadRequested(); }
    EditorTimerDemand EditorSceneHost::timerDemand() const { return impl_->timerDemand(); }
    bool EditorSceneHost::pumpFrame(double nowMillis) { return impl_->pumpFrame(nowMillis); }
    std::string EditorSceneHost::windowTitle(std::string_view baseTitle) const { return impl_->windowTitle(baseTitle); }

    void EditorSceneHost::resized(int width, int height) { impl_->resized(width, height); }
    void EditorSceneHost::paint(::juce::Graphics& g, ::juce::Rectangle<int> bounds) { impl_->paint(g, bounds); }

    void EditorSceneHost::pointerDown(const ::juce::MouseEvent& event) { impl_->pointerDown(event); }
    bool EditorSceneHost::pointerDrag(const ::juce::MouseEvent& event) { return impl_->pointerDrag(event); }
    void EditorSceneHost::pointerUp(const ::juce::MouseEvent& event) { impl_->pointerUp(event); }

    bool EditorSceneHost::wheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
        return impl_->wheelMove(event, wheel);
    }

    bool EditorSceneHost::isTextInputActive() const { return impl_->isTextInputActive(); }
    ::juce::Range<int> EditorSceneHost::highlightedRegion() const { return impl_->highlightedRegion(); }

    bool EditorSceneHost::setHighlightedRegion(const ::juce::Range<int>& range) {
        return impl_->setHighlightedRegion(range);
    }

    bool EditorSceneHost::setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& ranges) {
        return impl_->setTemporaryUnderlining(ranges);
    }

    ::juce::String EditorSceneHost::textInRange(const ::juce::Range<int>& range) const {
        return impl_->textInRange(range);
    }

    bool EditorSceneHost::insertTextAtCaret(const ::juce::String& textToInsert) {
        return impl_->insertTextAtCaret(textToInsert);
    }

    int EditorSceneHost::caretPosition() const { return impl_->caretPosition(); }
    int EditorSceneHost::totalNumChars() const { return impl_->totalNumChars(); }
    int EditorSceneHost::charIndexForPoint(::juce::Point<int> point) const { return impl_->charIndexForPoint(point); }

    ::juce::Rectangle<int> EditorSceneHost::caretRectangleForCharIndex(int characterIndex) const {
        return impl_->caretRectangleForCharIndex(characterIndex);
    }

    ::juce::RectangleList<int> EditorSceneHost::textBounds(::juce::Range<int> range) const {
        return impl_->textBounds(range);
    }

    bool EditorSceneHost::keyPressed(const ::juce::KeyPress& key) { return impl_->keyPressed(key); }
} // namespace arrange::juce

#endif
