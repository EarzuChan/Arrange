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
#include "ScrollProbe.h"

#include <utility>

namespace arrange::juce {
    namespace {
        constexpr arrange::core::NodeId rootNodeId = 1;
    }

    class EditorSceneHost::Impl final {
       public:
        Impl() : textLayoutService_(textMeasurer_), runtime_(arrange::core::SceneFramePipeline(arrange::core::LayoutEngine(textLayoutService_))), interaction_(textLayoutService_), paint_(textLayoutService_) {}

        void setWorkAvailable(std::function<void()> callback) {
            runtime_.setWorkAvailable(std::move(callback));
        }

        void configure(const EditorConfig& config) {
            pendingReload_ = ReloadKind::None;
            config_ = config;
            diagnostics_.configure(config_.diagnostics);
            applyPackageLoadOutcome(packageSource_.configure(config_));
        }

        void reload() {
            pendingReload_ = ReloadKind::Configured;
        }

        void reloadFromDevServer() {
            pendingReload_ = ReloadKind::DevServer;
        }

        void manualReload(bool toggleLive) {
            pendingReload_ = toggleLive ? ReloadKind::ToggleLive : ReloadKind::Manual;
        }

        bool triggerManualDiagnosticError() {
            const auto result = actions_.triggerManualDiagnosticError(diagnostics_, interaction_, runtime_, config_.app.distPath());
            if (result.clearLoaded) {
                session_.markUnloaded();
            }
            return result.handled;
        }

        bool pushManualDiagnosticToast() {
            return actions_.pushManualDiagnosticToast(diagnostics_, runtime_);
        }

        bool copyDiagnosticsToClipboard() {
            return actions_.copyDiagnosticsToClipboard(diagnostics_, runtime_, chrome_.diagnosticsTextContext(packageSource_, diagnostics_));
        }

        bool diagnosticsOverlayAvailable() const {
            return diagnosticVisibilityEnabled(config_.diagnostics.overlay);
        }

        bool setDiagnosticsOverlay(bool enabled) {
            if (enabled && !diagnosticsOverlayAvailable()) return false;
            if (overlay_.enabled() == enabled) return true;
            overlay_.setEnabled(enabled);
            syncTimeline();
            overlayPending_ = true;
            return true;
        }

        bool diagnosticsOverlayEnabled() const {
            return overlay_.enabled();
        }

        void setDiagnosticsOverlayLayers(arrange::core::OverlayLayers layers) {
            if (overlay_.layers() == layers) return;
            overlay_.setLayers(layers);
            overlayPending_ = true;
        }

        arrange::core::OverlayLayers diagnosticsOverlayLayers() const {
            return overlay_.layers();
        }

        void setFrameTimelineEnabled(bool enabled) {
            timelineRequested_ = enabled;
            syncTimeline();
        }

        const arrange::core::FrameTimeline& frameTimeline() const {
            return runtime_.frameTimeline();
        }

        // 场景脏区只在发布帧推进后转交；叠加层自身的重绘单独请求，不计入场景脏区
        void repaintDirty(::juce::Component& owner) {
            if (std::exchange(sceneChanged_, false)) repaint_.repaintDirty(owner, runtime_.publishedFrame());
            if (overlayRegion_.full)
                owner.repaint();
            else
                for (const auto& rect : overlayRegion_.rects) owner.repaint(::juce::Rectangle<float>(rect.x, rect.y, rect.width, rect.height).getSmallestIntegerContainer());
            overlayRegion_ = {};
        }

        bool wantsVBlank() const {
            return pendingReload_ != ReloadKind::None || wantsReloadPolling() || diagnostics_.hasActiveToasts() || runtime_.hasPendingFrameWork() || overlayPending_ || overlay_.animating();
        }

        bool pumpFrame(double nowMillis) {
#if ARRANGE_WITH_QUICKJS_NG
            for (auto& packet : packageSource_.takeLivePackets()) {
                if (packet.reload)
                    applyPackageLoadOutcome(packageSource_.completeLiveLoad(std::move(packet)));
                else {
                    if (packet.message.type == "update" && packageSource_.activeSource() != PackageSource::Live) {
                        applyPackageLoadOutcome(packageSource_.reloadFromDevServer());
                        continue;
                    }
                    if (packet.error.empty() && packageSource_.activeSource() == PackageSource::Live) {
                        const auto result = runtime_.applyHotUpdate(packet.snapshot, packet.message);
                        if (!result.ok) packet.error = result.error;
                    }
                    if (!packet.error.empty()) {
                        (void)DiagnosticsToast::e(diagnostics_, TAG, "Live 热更新失败", packet.error);
                    }
                }
            }
            packageSource_.sendHotMessages(runtime_.takeHotMessages());
#endif
            const auto scriptReload = runtime_.consumeReloadRequest();
            if (scriptReload && pendingReload_ == ReloadKind::None) pendingReload_ = ReloadKind::Configured;
            const auto reloadKind = std::exchange(pendingReload_, ReloadKind::None);
            switch (reloadKind) {
                case ReloadKind::None:
                    break;
                case ReloadKind::Configured:
                    applyPackageLoadOutcome(packageSource_.reload());
                    break;
                case ReloadKind::DevServer:
                    applyPackageLoadOutcome(packageSource_.reloadFromDevServer());
                    break;
                case ReloadKind::Manual:
                    applyPackageLoadOutcome(packageSource_.manualReload(false));
                    break;
                case ReloadKind::ToggleLive:
                    applyPackageLoadOutcome(packageSource_.manualReload(true));
                    break;
            }
            const auto sceneChanged = framePump_.pumpFrame(runtime_, session_, diagnostics_, interaction_, paint_, rootNodeId, config_.app.distPath(), lastPaintBounds_, config_.diagnostics.errorScreen, chrome_.diagnosticsBadgeModel(packageSource_, diagnostics_), nowMillis);
            sceneChanged_ = sceneChanged_ || sceneChanged;
            return updateOverlay(nowMillis) || sceneChanged;
        }

        bool ready() const {
            return session_.interactive(diagnostics_) && runtime_.publishedFrame().revision > 0;
        }

        std::string windowTitle(std::string_view baseTitle) const {
            return chrome_.windowTitle(baseTitle, packageSource_, diagnostics_);
        }

        void resized(int width, int height) {
            lastPaintBounds_ = {0, 0, width, height};
            session_.resize(width, height, runtime_);
        }

        void paint(::juce::Graphics& g, ::juce::Rectangle<int> bounds) {
            if (ScrollProbe::active()) {
                ScrollProbe::Sample sample;
                sample.kind = ScrollProbe::Kind::Paint;
                sample.revision = runtime_.publishedFrame().revision;
                ScrollProbe::record(sample);
            }
            lastPaintBounds_ = bounds;
            const auto& frame = runtime_.publishedFrame();
            const auto millis = paint_.paint(g, frame, overlayOps_);
            runtime_.frameTimeline().notePaint(frame.revision, millis);
        }

        void pointerMove(const ::juce::MouseEvent& event) {
            if (overlay_.enabled() && overlay_.layers().hit) {
                overlay_.setPointer(arrange::core::Point{event.position.x, event.position.y});
                overlayPending_ = true;
            }
            pointerEvents_.pointerMove(runtime_, session_, diagnostics_, interaction_, event);
        }

        void pointerExit() {
            overlay_.setPointer(std::nullopt);
            overlayPending_ = overlayPending_ || overlay_.enabled();
            pointerEvents_.pointerExit(runtime_, interaction_);
        }

        void cancelPointer() {
            pointerEvents_.cancelPointer(runtime_, interaction_);
        }

        void pointerDown(const ::juce::MouseEvent& event) {
            pointerEvents_.pointerDown(runtime_, session_, diagnostics_, interaction_, rootNodeId, event, inputCallbacks());
        }

        bool pointerDrag(const ::juce::MouseEvent& event) {
            return pointerEvents_.pointerDrag(runtime_, session_, diagnostics_, interaction_, event, inputCallbacks());
        }

        void pointerUp(const ::juce::MouseEvent& event) {
            if (diagnostics_.hasError()) {
                if (diagnostics_.errorRetryAvailable()) {
                    reload();
                }
                return;
            }
            (void)pointerEvents_.pointerUp(runtime_, session_, diagnostics_, interaction_, rootNodeId, event);
        }

        bool wheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
            return pointerEvents_.wheelMove(runtime_, session_, diagnostics_, interaction_, rootNodeId, event, wheel);
        }

        bool wheelMove(arrange::core::Point point, const arrange::core::WheelInput& input) {
            return pointerEvents_.wheelMove(runtime_, session_, diagnostics_, interaction_, rootNodeId, point, input);
        }

        void cancelWheel() {
            interaction_.cancelWheel();
        }

        arrange::core::PointerIcon pointerIcon() const {
            return interaction_.pointerIcon();
        }

        PointerPlatformEffects takePointerEffects() {
            return interaction_.takePointerEffects();
        }

        bool pointerDragging() const {
            return interaction_.pointerDragging();
        }

        bool isTextInputActive() const {
            return textInput_.isActive(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        ::juce::Range<int> highlightedRegion() const {
            return textInput_.highlightedRegion(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        bool setHighlightedRegion(const ::juce::Range<int>& range) {
            return textInput_.setHighlightedRegion(runtime_.scene().tree(), session_, diagnostics_, interaction_, range, inputCallbacks());
        }

        bool setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& ranges) {
            return textInput_.setTemporaryUnderlining(runtime_.scene().tree(), session_, diagnostics_, interaction_, ranges, inputCallbacks());
        }

        ::juce::String textInRange(const ::juce::Range<int>& range) const {
            return textInput_.textInRange(runtime_.scene().tree(), session_, diagnostics_, interaction_, range);
        }

        bool insertTextAtCaret(const ::juce::String& textToInsert) {
            return textInput_.insertTextAtCaret(runtime_.scene().tree(), session_, diagnostics_, interaction_, textToInsert, inputCallbacks());
        }

        int caretPosition() const {
            return textInput_.caretPosition(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        int totalNumChars() const {
            return textInput_.totalNumChars(runtime_.scene().tree(), session_, diagnostics_, interaction_);
        }

        int charIndexForPoint(::juce::Point<int> point) const {
            return textInput_.charIndexForPoint(runtime_.scene().tree(), session_, diagnostics_, interaction_, point);
        }

        ::juce::Rectangle<int> caretRectangleForCharIndex(int characterIndex) const {
            return textInput_.caretRectangleForCharIndex(runtime_.scene().tree(), session_, diagnostics_, interaction_, characterIndex);
        }

        ::juce::RectangleList<int> textBounds(::juce::Range<int> range) const {
            return textInput_.textBounds(runtime_.scene().tree(), session_, diagnostics_, interaction_, range);
        }

        bool keyStateChanged(const std::function<bool(int)>& isDown) {
            if (diagnostics_.hasError()) return false;
            return interaction_.keyStateChanged(runtime_.scene().tree(), session_.loaded(), isDown, inputCallbacks());
        }

        void modifierKeysChanged(const ::juce::ModifierKeys& modifiers) {
            if (diagnostics_.hasError()) return;
            interaction_.modifierKeysChanged(runtime_.scene().tree(), session_.loaded(), keyModifierState(modifiers), inputCallbacks());
        }

        bool hasKeyboardFocusTarget() const {
            return interaction_.focusedNode().has_value();
        }

        bool keyPressed(const ::juce::KeyPress& key) {
            return textInput_.keyPressed(runtime_.scene().tree(), session_, diagnostics_, interaction_, key, inputCallbacks());
        }

       private:
        void syncTimeline() {
            runtime_.frameTimeline().setEnabled(timelineRequested_ || overlay_.enabled());
        }

        // 返回叠加层是否需要重绘
        bool updateOverlay(double nowMillis) {
            if (!overlay_.enabled() && overlay_.ops().empty()) {
                overlayPending_ = false;
                return false;
            }
            overlayPending_ = false;
            const auto region = overlay_.update(runtime_.frameTimeline(), runtime_.publishedFrame(), runtime_.scene().tree(), rootNodeId, nowMillis);
            if (region.empty()) return false;
            overlayOps_ = overlay_.ops();
            for (auto& op : overlayOps_) arrange::core::DrawOpsBuilder::prepareText(op, textLayoutService_);
            if (region.full || overlayRegion_.full)
                overlayRegion_ = {true, {}};
            else
                overlayRegion_.rects.insert(overlayRegion_.rects.end(), region.rects.begin(), region.rects.end());
            return true;
        }

        bool wantsReloadPolling() const {
            return packageSource_.wantsReloadPolling();
        }

        arrange::core::InputCallbacks inputCallbacks() {
            return inputState_.callbacks(runtime_);
        }

        void applyPackageLoadOutcome(PackageLoadOutcome outcome) {
            packageBinder_.apply(std::move(outcome), session_, runtime_, diagnostics_, interaction_, paint_);
        }

        enum class ReloadKind { None, Configured, DevServer, Manual, ToggleLive };
        ReloadKind pendingReload_ = ReloadKind::None;
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
        arrange::core::DiagnosticsOverlay overlay_;
        std::vector<arrange::core::DrawOp> overlayOps_;
        arrange::core::RepaintRegion overlayRegion_;
        bool overlayPending_ = false;
        bool sceneChanged_ = false;
        bool timelineRequested_ = false;
    };

    EditorSceneHost::EditorSceneHost() : impl_(std::make_unique<Impl>()) {}

    EditorSceneHost::~EditorSceneHost() = default;

    void EditorSceneHost::setWorkAvailable(std::function<void()> callback) {
        impl_->setWorkAvailable(std::move(callback));
    }

    void EditorSceneHost::configure(const EditorConfig& config) {
        impl_->configure(config);
    }

    void EditorSceneHost::reload() {
        impl_->reload();
    }

    void EditorSceneHost::reloadFromDevServer() {
        impl_->reloadFromDevServer();
    }

    void EditorSceneHost::manualReload(bool toggleLive) {
        impl_->manualReload(toggleLive);
    }

    bool EditorSceneHost::triggerManualDiagnosticError() {
        return impl_->triggerManualDiagnosticError();
    }

    bool EditorSceneHost::pushManualDiagnosticToast() {
        return impl_->pushManualDiagnosticToast();
    }

    bool EditorSceneHost::copyDiagnosticsToClipboard() {
        return impl_->copyDiagnosticsToClipboard();
    }

    bool EditorSceneHost::diagnosticsOverlayAvailable() const {
        return impl_->diagnosticsOverlayAvailable();
    }

    bool EditorSceneHost::setDiagnosticsOverlay(bool enabled) {
        return impl_->setDiagnosticsOverlay(enabled);
    }

    bool EditorSceneHost::diagnosticsOverlayEnabled() const {
        return impl_->diagnosticsOverlayEnabled();
    }

    void EditorSceneHost::setDiagnosticsOverlayLayers(arrange::core::OverlayLayers layers) {
        impl_->setDiagnosticsOverlayLayers(layers);
    }

    arrange::core::OverlayLayers EditorSceneHost::diagnosticsOverlayLayers() const {
        return impl_->diagnosticsOverlayLayers();
    }

    void EditorSceneHost::setFrameTimelineEnabled(bool enabled) {
        impl_->setFrameTimelineEnabled(enabled);
    }

    const arrange::core::FrameTimeline& EditorSceneHost::frameTimeline() const {
        return impl_->frameTimeline();
    }

    void EditorSceneHost::repaintDirty(::juce::Component& owner) {
        impl_->repaintDirty(owner);
    }

    bool EditorSceneHost::wantsVBlank() const {
        return impl_->wantsVBlank();
    }

    bool EditorSceneHost::ready() const {
        return impl_->ready();
    }

    bool EditorSceneHost::pumpFrame(double nowMillis) {
        return impl_->pumpFrame(nowMillis);
    }

    std::string EditorSceneHost::windowTitle(std::string_view baseTitle) const {
        return impl_->windowTitle(baseTitle);
    }

    void EditorSceneHost::resized(int width, int height) {
        impl_->resized(width, height);
    }

    void EditorSceneHost::paint(::juce::Graphics& g, ::juce::Rectangle<int> bounds) {
        impl_->paint(g, bounds);
    }

    void EditorSceneHost::pointerMove(const ::juce::MouseEvent& event) {
        impl_->pointerMove(event);
    }

    void EditorSceneHost::pointerExit() {
        impl_->pointerExit();
    }

    void EditorSceneHost::cancelPointer() {
        impl_->cancelPointer();
    }

    arrange::core::PointerIcon EditorSceneHost::pointerIcon() const {
        return impl_->pointerIcon();
    }

    PointerPlatformEffects EditorSceneHost::takePointerEffects() {
        return impl_->takePointerEffects();
    }

    bool EditorSceneHost::pointerDragging() const {
        return impl_->pointerDragging();
    }

    void EditorSceneHost::pointerDown(const ::juce::MouseEvent& event) {
        impl_->pointerDown(event);
    }

    bool EditorSceneHost::pointerDrag(const ::juce::MouseEvent& event) {
        return impl_->pointerDrag(event);
    }

    void EditorSceneHost::pointerUp(const ::juce::MouseEvent& event) {
        impl_->pointerUp(event);
    }

    bool EditorSceneHost::wheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
        return impl_->wheelMove(event, wheel);
    }

    bool EditorSceneHost::wheelMove(arrange::core::Point point, const arrange::core::WheelInput& input) {
        return impl_->wheelMove(point, input);
    }

    void EditorSceneHost::cancelWheel() {
        impl_->cancelWheel();
    }

    bool EditorSceneHost::isTextInputActive() const {
        return impl_->isTextInputActive();
    }

    ::juce::Range<int> EditorSceneHost::highlightedRegion() const {
        return impl_->highlightedRegion();
    }

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

    int EditorSceneHost::caretPosition() const {
        return impl_->caretPosition();
    }

    int EditorSceneHost::totalNumChars() const {
        return impl_->totalNumChars();
    }

    int EditorSceneHost::charIndexForPoint(::juce::Point<int> point) const {
        return impl_->charIndexForPoint(point);
    }

    ::juce::Rectangle<int> EditorSceneHost::caretRectangleForCharIndex(int characterIndex) const {
        return impl_->caretRectangleForCharIndex(characterIndex);
    }

    ::juce::RectangleList<int> EditorSceneHost::textBounds(::juce::Range<int> range) const {
        return impl_->textBounds(range);
    }

    bool EditorSceneHost::keyStateChanged(const std::function<bool(int)>& isDown) {
        return impl_->keyStateChanged(isDown);
    }

    void EditorSceneHost::modifierKeysChanged(const ::juce::ModifierKeys& modifiers) {
        impl_->modifierKeysChanged(modifiers);
    }

    bool EditorSceneHost::hasKeyboardFocusTarget() const {
        return impl_->hasKeyboardFocusTarget();
    }

    bool EditorSceneHost::keyPressed(const ::juce::KeyPress& key) {
        return impl_->keyPressed(key);
    }
}

#endif
