#include <arrange/juce/ArrangeEditor.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/EditorSceneHost.h>

#include <utility>

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
    // reload 在本帧求值前处理；一次 VBlank 只调用一次视觉流水线
    if (editor.sceneHost_->consumeDevReloadRequested()) editor.sceneHost_->reloadFromDevServer();
    const auto frameChanged = editor.sceneHost_->pumpFrame(nowMillis);
    editor.updateWindowTitle();
    editor.updateFrameClockState();
    if (frameChanged) editor.sceneHost_->repaintDirty(editor);
}

ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor)
    : ArrangeEditor(processor, EditorConfig{}) {}

ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor, EditorConfig config)
    : ::juce::AudioProcessorEditor(processor),
      sceneHost_(std::make_unique<EditorSceneHost>()) {
    configure(std::move(config));
}

ArrangeEditor::~ArrangeEditor() { frameClock_.stop(); }

void ArrangeEditor::configure(EditorConfig config) {
    config_ = config;
    sceneHost_->resized(config_.width, config_.height);
    setSize(config_.width, config_.height);
    setName(config_.window.title);
    setResizeLimits(config_.window.minWidth, config_.window.minHeight, config_.window.maxWidth, config_.window.maxHeight);
    setResizable(config_.window.resizable, config_.window.useCornerResizer);
    setWantsKeyboardFocus(true);
    sceneHost_->configure(config_);
    sceneHost_->resized(getWidth(), getHeight());
    shell_.afterConfigure(*this);
}

void ArrangeEditor::reload() {
    sceneHost_->reload();
    shell_.afterReload(*this);
}

void ArrangeEditor::resized() {
    sceneHost_->resized(getWidth(), getHeight());
    shell_.afterResize(*this);
}

void ArrangeEditor::paint(::juce::Graphics& g) { sceneHost_->paint(g, getLocalBounds()); }

void ArrangeEditor::parentHierarchyChanged() {
    updateWindowTitle();
    updateFrameClockState();
}

void ArrangeEditor::mouseDown(const ::juce::MouseEvent& event) {
    grabKeyboardFocus();
    sceneHost_->pointerDown(event);
    shell_.afterPointerDown(*this);
}

void ArrangeEditor::mouseDrag(const ::juce::MouseEvent& event) {
    if (sceneHost_->pointerDrag(event)) {
        shell_.afterFrameRelevantChange(*this);
    }
}

void ArrangeEditor::mouseUp(const ::juce::MouseEvent& event) {
    sceneHost_->pointerUp(event);
    shell_.afterFrameRelevantChange(*this);
}

void ArrangeEditor::mouseWheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
    if (sceneHost_->wheelMove(event, wheel)) {
        shell_.afterFrameRelevantChange(*this);
    }
}

bool ArrangeEditor::keyPressed(const ::juce::KeyPress& key) {
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
    if (key.getModifiers().isCommandDown() && (key.getTextCharacter() == 'c' || key.getTextCharacter() == 'C')) {
        if (sceneHost_->copyDiagnosticsToClipboard()) {
            shell_.afterFrameRelevantChange(*this);
            return true;
        }
    }
    const auto consumed = sceneHost_->keyPressed(key);
    if (consumed) {
        shell_.afterFrameRelevantChange(*this);
    }
    return consumed;
}

bool ArrangeEditor::isTextInputActive() const { return sceneHost_->isTextInputActive(); }

::juce::Range<int> ArrangeEditor::getHighlightedRegion() const { return sceneHost_->highlightedRegion(); }

void ArrangeEditor::setHighlightedRegion(const ::juce::Range<int>& newRange) {
    if (sceneHost_->setHighlightedRegion(newRange)) {
        shell_.afterFrameRelevantChange(*this);
    }
}

void ArrangeEditor::setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& underlinedRegions) {
    if (sceneHost_->setTemporaryUnderlining(underlinedRegions)) {
        shell_.afterFrameRelevantChange(*this);
    }
}

::juce::String ArrangeEditor::getTextInRange(const ::juce::Range<int>& range) const { return sceneHost_->textInRange(range); }

void ArrangeEditor::insertTextAtCaret(const ::juce::String& textToInsert) {
    if (sceneHost_->insertTextAtCaret(textToInsert)) {
        shell_.afterFrameRelevantChange(*this);
    }
}

int ArrangeEditor::getCaretPosition() const { return sceneHost_->caretPosition(); }

::juce::Rectangle<int> ArrangeEditor::getCaretRectangleForCharIndex(int characterIndex) const { return sceneHost_->caretRectangleForCharIndex(characterIndex); }

int ArrangeEditor::getTotalNumChars() const { return sceneHost_->totalNumChars(); }

int ArrangeEditor::getCharIndexForPoint(::juce::Point<int> point) const { return sceneHost_->charIndexForPoint(point); }

::juce::RectangleList<int> ArrangeEditor::getTextBounds(::juce::Range<int> textRange) const { return sceneHost_->textBounds(textRange); }

void ArrangeEditor::updateFrameClockState() {
    frameClock_.sync(
        *this,
        sceneHost_->wantsVBlank(),
        [this](double timestampMillis) {
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
    const auto title = ::juce::String(sceneHost_->windowTitle(config_.window.title));
    setName(title);
    if (auto* peer = getPeer()) { peer->setTitle(title); }
    if (auto* topLevel = getTopLevelComponent()) {
        topLevel->setName(title);
        if (auto* peer = topLevel->getPeer()) { peer->setTitle(title); }
    }
}

} // namespace arrange::juce

#endif
