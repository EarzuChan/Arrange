#include <arrange/juce/ArrangeEditor.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/EditorSceneHost.h>
#include "ScrollProbe.h"
#if JUCE_WINDOWS
#include "WindowsPrecisionWheelSource.h"
#endif

#include <utility>
#include <cstdlib>
#include <string_view>
#include <fstream>
#include <filesystem>

namespace arrange::juce {

    void EditorShellDriver::afterConfigure(ArrangeEditor& editor) const {
        editor.updateWindowTitle();
        editor.updateFrameClockState();
    }

    void EditorShellDriver::afterReload(ArrangeEditor& editor) const {
        editor.updateWindowTitle();
        editor.updateFrameClockState();
    }

    void EditorShellDriver::afterResize(ArrangeEditor& editor) const {
        editor.updateWindowTitle();
        editor.updateFrameClockState();
    }

    void EditorShellDriver::afterPointerDown(ArrangeEditor& editor) const {
        if (auto* peer = editor.getPeer()) {
            peer->refreshTextInputTarget();
        }
        editor.updateFrameClockState();
    }

    void EditorShellDriver::afterFrameRelevantChange(ArrangeEditor& editor) const {
        editor.updateFrameClockState();
    }

    void EditorShellDriver::afterTitleAndFrameRelevantChange(ArrangeEditor& editor) const {
        editor.updateWindowTitle();
        editor.updateFrameClockState();
    }

    void EditorShellDriver::vblankTick(ArrangeEditor& editor, double nowMillis) const {
        if (ScrollProbe::active()) {
            ScrollProbe::Sample sample;
            sample.kind = ScrollProbe::Kind::VBlank;
            sample.sourceMillis = nowMillis;
            sample.pending = editor.sceneHost_->wantsVBlank();
            ScrollProbe::record(sample);
        }
#if JUCE_WINDOWS
        // 未测试！
        if (editor.precisionWheelSource_) editor.precisionWheelSource_->tick();
#endif
        // reload 在本帧求值前处理；一次 VBlank 只调用一次视觉流水线
        const auto frameChanged = editor.sceneHost_->pumpFrame(nowMillis);
        editor.updateWindowTitle();
        editor.updateFrameClockState();
        if (frameChanged) editor.sceneHost_->repaintDirty(editor);
        editor.reportDevReady();
    }

    ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor) : ArrangeEditor(processor, EditorConfig{}) {}

    ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor, EditorConfig config) : ::juce::AudioProcessorEditor(processor), sceneHost_(std::make_unique<EditorSceneHost>()) {
        sceneHost_->setWorkAvailable([this] { updateFrameClockState(); });
#if JUCE_WINDOWS
        // 未测试！
        precisionWheelSource_ = std::make_unique<WindowsPrecisionWheelSource>([this](arrange::core::Point point, const arrange::core::WheelInput& input) { (void)sceneHost_->wheelMove(point, input); }, [this] { requestFrameClockResyncAsync(); });
#endif
        configure(std::move(config));
    }

    ArrangeEditor::~ArrangeEditor() {
#if JUCE_WINDOWS
        // 未测试！
        if (precisionWheelSource_) precisionWheelSource_->cancel();
#endif
        frameClock_.stop();
    }

    void ArrangeEditor::configure(EditorConfig config) {
        config_ = config;
        sceneHost_->resized(config_.width, config_.height);
        setSize(config_.width, config_.height);
        setName(config_.window.title);
        setResizeLimits(config_.window.minWidth, config_.window.minHeight, config_.window.maxWidth, config_.window.maxHeight);
        setResizable(config_.window.resizable, config_.window.useCornerResizer);
        setWantsKeyboardFocus(true);
        // 键盘焦点只在命中焦点受体时获取，见 mouseDown
        setMouseClickGrabsKeyboardFocus(false);
        sceneHost_->configure(config_);
        sceneHost_->resized(getWidth(), getHeight());
        shell_.afterConfigure(*this);
    }

    void ArrangeEditor::reload() {
        sceneHost_->reload();
        shell_.afterReload(*this);
    }

    void ArrangeEditor::resized() {
#if JUCE_WINDOWS
        // 未测试！
        if (precisionWheelSource_) precisionWheelSource_->sync(*this);
#endif
        sceneHost_->resized(getWidth(), getHeight());
        shell_.afterResize(*this);
    }

    void ArrangeEditor::paint(::juce::Graphics& g) {
        sceneHost_->paint(g, getLocalBounds());
        scheduleDevReadyCheck();
    }

    void ArrangeEditor::scheduleDevReadyCheck() {
        if (devReadyReported_ || devReadyCheckScheduled_ || !isShowing()) return;
        devReadyCheckScheduled_ = true;
        ::juce::Component::SafePointer<ArrangeEditor> safe(this);
        ::juce::MessageManager::callAsync([safe] {
            if (safe == nullptr) return;
            safe->devReadyCheckScheduled_ = false;
            safe->reportDevReady();
        });
    }

    // 窗口显示且首帧包含已加载应用时确认本次启动
    void ArrangeEditor::reportDevReady() {
        if (devReadyReported_ || !isShowing() || !sceneHost_->ready()) return;
#if JUCE_WINDOWS
        const auto* path = _wgetenv(L"ARRANGE_DEV_READY_FILE");
#else
        const auto* path = std::getenv("ARRANGE_DEV_READY_FILE");
#endif
        const auto* token = std::getenv("ARRANGE_DEV_READY_TOKEN");
        if (!path || !token) {
            devReadyReported_ = true;
            return;
        }
        const std::string_view value(token);
        const std::filesystem::path target(path);
        auto temporary = target;
        temporary += ".tmp";
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        output.write(value.data(), static_cast<std::streamsize>(value.size()));
        output.close();
        if (!output) return;
        std::error_code error;
        std::filesystem::rename(temporary, target, error);
        if (!error) devReadyReported_ = true;
    }

    void ArrangeEditor::parentHierarchyChanged() {
#if JUCE_WINDOWS
        // 未测试！
        if (precisionWheelSource_) precisionWheelSource_->sync(*this);
#endif
        updateWindowTitle();
        updateFrameClockState();
    }

    void ArrangeEditor::cancelPointer() {
        sceneHost_->cancelPointer();
        applyPointerEffects(nullptr);
        shell_.afterFrameRelevantChange(*this);
    }

    void ArrangeEditor::applyPointerEffects(const ::juce::MouseEvent* event) {
        const auto effects = sceneHost_->takePointerEffects();
        auto source = event ? event->source : ::juce::Desktop::getInstance().getMainMouseSource();
        if (effects.lockPointer && event && !pointerLocked_) {
            source.enableUnboundedMouseMovement(true, false);
            pointerLocked_ = true;
        }
        // 会话结束或被取消后一律解除，光标回到按下点
        if (pointerLocked_ && (effects.unlockPointer || !sceneHost_->pointerDragging())) {
            source.enableUnboundedMouseMovement(false);
            if (effects.unlockPointer) source.setScreenPosition(localPointToGlobal(::juce::Point<float>(effects.restorePoint.x, effects.restorePoint.y)));
            pointerLocked_ = false;
        }
        using Icon = arrange::core::PointerIcon;
        const auto icon = sceneHost_->pointerIcon();
        const auto cursor = icon == Icon::Hand ? ::juce::MouseCursor::PointingHandCursor : icon == Icon::Text ? ::juce::MouseCursor::IBeamCursor : icon == Icon::Crosshair ? ::juce::MouseCursor::CrosshairCursor : icon == Icon::ResizeHorizontal ? ::juce::MouseCursor::LeftRightResizeCursor : icon == Icon::ResizeVertical ? ::juce::MouseCursor::UpDownResizeCursor : icon == Icon::Grab ? ::juce::MouseCursor::DraggingHandCursor : icon == Icon::Grabbing ? ::juce::MouseCursor::DraggingHandCursor : icon == Icon::None ? ::juce::MouseCursor::NoCursor : ::juce::MouseCursor::NormalCursor;
        if (getMouseCursor() != ::juce::MouseCursor(cursor)) setMouseCursor(cursor);
    }

    void ArrangeEditor::focusLost(FocusChangeType) {
        // 为仍按下的键补发 key up
        (void)sceneHost_->keyStateChanged({});
        cancelPointer();
        sceneHost_->cancelWheel();
#if JUCE_WINDOWS
        // 未测试！
        if (precisionWheelSource_) precisionWheelSource_->cancel();
#endif
    }

    void ArrangeEditor::focusGained(FocusChangeType) {
#if JUCE_WINDOWS
        // 未测试！
        if (precisionWheelSource_) precisionWheelSource_->sync(*this);
#endif
    }

    void ArrangeEditor::visibilityChanged() {
        if (!isShowing()) {
            cancelPointer();
            sceneHost_->cancelWheel();
        }
#if JUCE_WINDOWS
        // 未测试！
        if (precisionWheelSource_) precisionWheelSource_->sync(*this);
#endif
    }

    void ArrangeEditor::mouseMove(const ::juce::MouseEvent& event) {
        sceneHost_->pointerMove(event);
        applyPointerEffects(&event);
        shell_.afterFrameRelevantChange(*this);
    }

    void ArrangeEditor::mouseEnter(const ::juce::MouseEvent& event) {
        mouseMove(event);
    }

    void ArrangeEditor::mouseExit(const ::juce::MouseEvent& event) {
        // 无界拖动中指针可能越出编辑器，会话仍归本编辑器
        if (sceneHost_->pointerDragging()) return;
        sceneHost_->pointerExit();
        applyPointerEffects(&event);
        shell_.afterFrameRelevantChange(*this);
    }

    void ArrangeEditor::mouseDown(const ::juce::MouseEvent& event) {
        sceneHost_->pointerDown(event);
        // 点击非焦点受体时交还键盘，宿主快捷键不被空白区域吞掉
        if (sceneHost_->hasKeyboardFocusTarget())
            grabKeyboardFocus();
        else if (hasKeyboardFocus(true))
            giveAwayKeyboardFocus();
        applyPointerEffects(&event);
        shell_.afterPointerDown(*this);
    }

    void ArrangeEditor::mouseDrag(const ::juce::MouseEvent& event) {
        (void)sceneHost_->pointerDrag(event);
        applyPointerEffects(&event);
        shell_.afterFrameRelevantChange(*this);
    }

    void ArrangeEditor::mouseUp(const ::juce::MouseEvent& event) {
        sceneHost_->pointerUp(event);
        applyPointerEffects(&event);
        shell_.afterFrameRelevantChange(*this);
    }

    void ArrangeEditor::mouseWheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
        (void)sceneHost_->wheelMove(event, wheel);
        shell_.afterFrameRelevantChange(*this);
    }

    bool ArrangeEditor::keyPressed(const ::juce::KeyPress& key) {
#if !defined(NDEBUG)
        if (key.isKeyCode(::juce::KeyPress::F8Key)) {
            const auto saved = ScrollProbe::toggle();
            if (ScrollProbe::active()) {
                if (auto* peer = getPeer()) peer->setTitle(::juce::String::fromUTF8("Arrange 滚动采样中 · F8 结束"));
            } else if (!saved.empty()) {
                if (auto* peer = getPeer()) peer->setTitle(::juce::String::fromUTF8("Arrange 采样已保存 · ") + ::juce::String(saved.string()));
            }
            return true;
        }
#endif
#if !defined(NDEBUG)
        if (key.isKeyCode(::juce::KeyPress::F5Key)) {
            sceneHost_->manualReload(key.getModifiers().isCommandDown());
            shell_.afterTitleAndFrameRelevantChange(*this);
            return true;
        }
        if (key.isKeyCode(::juce::KeyPress::F6Key)) {
            if (sceneHost_->pushManualDiagnosticToast()) {
                shell_.afterFrameRelevantChange(*this);
            }
            return true;
        }
        if (key.isKeyCode(::juce::KeyPress::F7Key)) {
            if (sceneHost_->triggerManualDiagnosticError()) {
                shell_.afterTitleAndFrameRelevantChange(*this);
            }
            return true;
        }
#endif
        if (key.getModifiers().isCommandDown() && (key.getTextCharacter() == 'c' || key.getTextCharacter() == 'C')) {
            if (sceneHost_->copyDiagnosticsToClipboard()) {
                shell_.afterFrameRelevantChange(*this);
                return true;
            }
        }
        const auto consumed = sceneHost_->keyPressed(key);
        // 事件是否消费和是否产生待提交工作是两个不同结果
        shell_.afterFrameRelevantChange(*this);
        return consumed;
    }

    bool ArrangeEditor::keyStateChanged(bool isKeyDown) {
        if (isKeyDown) return false;
        const auto consumed = sceneHost_->keyStateChanged([](int code) { return ::juce::KeyPress::isKeyCurrentlyDown(code); });
        shell_.afterFrameRelevantChange(*this);
        return consumed;
    }

    void ArrangeEditor::modifierKeysChanged(const ::juce::ModifierKeys& modifiers) {
        sceneHost_->modifierKeysChanged(modifiers);
        shell_.afterFrameRelevantChange(*this);
    }

    bool ArrangeEditor::isTextInputActive() const {
        return sceneHost_->isTextInputActive();
    }

    ::juce::Range<int> ArrangeEditor::getHighlightedRegion() const {
        return sceneHost_->highlightedRegion();
    }

    void ArrangeEditor::setHighlightedRegion(const ::juce::Range<int>& newRange) {
        (void)sceneHost_->setHighlightedRegion(newRange);
        shell_.afterFrameRelevantChange(*this);
    }

    void ArrangeEditor::setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& underlinedRegions) {
        (void)sceneHost_->setTemporaryUnderlining(underlinedRegions);
        shell_.afterFrameRelevantChange(*this);
    }

    ::juce::String ArrangeEditor::getTextInRange(const ::juce::Range<int>& range) const {
        return sceneHost_->textInRange(range);
    }

    void ArrangeEditor::insertTextAtCaret(const ::juce::String& textToInsert) {
        (void)sceneHost_->insertTextAtCaret(textToInsert);
        shell_.afterFrameRelevantChange(*this);
    }

    int ArrangeEditor::getCaretPosition() const {
        return sceneHost_->caretPosition();
    }

    ::juce::Rectangle<int> ArrangeEditor::getCaretRectangleForCharIndex(int characterIndex) const {
        return sceneHost_->caretRectangleForCharIndex(characterIndex);
    }

    int ArrangeEditor::getTotalNumChars() const {
        return sceneHost_->totalNumChars();
    }

    int ArrangeEditor::getCharIndexForPoint(::juce::Point<int> point) const {
        return sceneHost_->charIndexForPoint(point);
    }

    ::juce::RectangleList<int> ArrangeEditor::getTextBounds(::juce::Range<int> textRange) const {
        return sceneHost_->textBounds(textRange);
    }

    void ArrangeEditor::updateFrameClockState() {
        auto wantsVBlank = sceneHost_->wantsVBlank();
#if JUCE_WINDOWS
        // 未测试！
        wantsVBlank = wantsVBlank || (precisionWheelSource_ && precisionWheelSource_->needsTicks());
#endif
        frameClock_.sync(*this, wantsVBlank, [this](double timestampMillis) {
            frameClock_.beginVBlankCallback();
            shell_.vblankTick(*this, timestampMillis);
            if (frameClock_.endVBlankCallback()) {
                requestFrameClockResyncAsync();
            }
        });
    }

    void ArrangeEditor::requestFrameClockResyncAsync() {
        ::juce::Component::SafePointer<ArrangeEditor> safeThis(this);
        ::juce::MessageManager::callAsync([safeThis]() mutable {
            if (auto* editor = safeThis.getComponent()) {
                editor->updateFrameClockState();
            }
        });
    }

    void ArrangeEditor::updateWindowTitle() {
        const auto title = ScrollProbe::active() ? ::juce::String::fromUTF8("Arrange 滚动采样中 · F8 结束") : ::juce::String(sceneHost_->windowTitle(config_.window.title));
        setName(title);
        if (auto* peer = getPeer()) {
            peer->setTitle(title);
        }
        if (auto* topLevel = getTopLevelComponent()) {
            topLevel->setName(title);
            if (auto* peer = topLevel->getPeer()) {
                peer->setTitle(title);
            }
        }
    }

}

#endif
