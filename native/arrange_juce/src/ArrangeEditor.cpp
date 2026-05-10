#include <arrange/juce/ArrangeEditor.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/EditorSceneHost.h>

#include <utility>

namespace arrange::juce {
void EditorShellDriver::afterConfigure(ArrangeEditor& editor) const {
    editor.updateWindowTitle();
    editor.updateTimerState();
    if (editor.sceneHost_->pumpFrame(::juce::Time::getMillisecondCounterHiRes())) {
        editor.updateWindowTitle();
    }
    editor.sceneHost_->repaintDirty(editor, true);
}

void EditorShellDriver::afterReload(ArrangeEditor& editor) const {
    editor.updateWindowTitle();
    editor.updateTimerState();
    if (editor.sceneHost_->pumpFrame(::juce::Time::getMillisecondCounterHiRes())) {
        editor.updateWindowTitle();
    }
    editor.sceneHost_->repaintDirty(editor, true);
}

void EditorShellDriver::afterResize(ArrangeEditor& editor) const {
    editor.updateWindowTitle();
    editor.updateTimerState();
    (void)editor.sceneHost_->pumpFrame(::juce::Time::getMillisecondCounterHiRes());
    editor.sceneHost_->repaintDirty(editor, true);
}

void EditorShellDriver::afterPointerDown(ArrangeEditor& editor) const {
    if (auto* peer = editor.getPeer()) {
        peer->refreshTextInputTarget();
    }
    editor.updateTimerState();
}

void EditorShellDriver::afterTimerRelevantChange(ArrangeEditor& editor) const {
    editor.updateTimerState();
}

void EditorShellDriver::afterTitleAndTimerRelevantChange(ArrangeEditor& editor) const {
    editor.updateWindowTitle();
    editor.updateTimerState();
}

void EditorShellDriver::timerTick(ArrangeEditor& editor, double nowMillis) const {
    const auto frameChanged = editor.sceneHost_->pumpFrame(nowMillis);
    editor.updateWindowTitle();
    if (!editor.sceneHost_->consumeDevReloadRequested()) {
        editor.updateTimerState();
        if (frameChanged) {
            editor.sceneHost_->repaintDirty(editor, true);
        }
        return;
    }

    editor.sceneHost_->reloadFromDevServer();
    editor.updateWindowTitle();
    editor.updateTimerState();
    (void)editor.sceneHost_->pumpFrame(nowMillis);
    editor.sceneHost_->repaintDirty(editor, true);
}

ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor)
    : ArrangeEditor(processor, EditorConfig{}) {}

ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor, EditorConfig config)
    : ::juce::AudioProcessorEditor(processor),
      sceneHost_(std::make_unique<EditorSceneHost>()) { configure(std::move(config)); }

ArrangeEditor::~ArrangeEditor() { frameClock_.stop(static_cast<::juce::Timer&>(*this)); }

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
    updateTimerState();
}

void ArrangeEditor::mouseDown(const ::juce::MouseEvent& event) {
    grabKeyboardFocus();
    sceneHost_->pointerDown(event);
    shell_.afterPointerDown(*this);
}

void ArrangeEditor::mouseDrag(const ::juce::MouseEvent& event) {
    if (sceneHost_->pointerDrag(event)) {
        shell_.afterTimerRelevantChange(*this);
    }
}

void ArrangeEditor::mouseUp(const ::juce::MouseEvent& event) {
    sceneHost_->pointerUp(event);
    shell_.afterTimerRelevantChange(*this);
}

void ArrangeEditor::mouseWheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
    if (sceneHost_->wheelMove(event, wheel)) {
        shell_.afterTimerRelevantChange(*this);
    }
}

bool ArrangeEditor::keyPressed(const ::juce::KeyPress& key) {
    if (key.isKeyCode(::juce::KeyPress::F5Key)) {
        sceneHost_->manualReload(key.getModifiers().isCommandDown());
        shell_.afterTitleAndTimerRelevantChange(*this);
        return true;
    }
    if (key.isKeyCode(::juce::KeyPress::F6Key)) {
        if (sceneHost_->pushManualDiagnosticToast()) {
            shell_.afterTimerRelevantChange(*this);
        }
        return true;
    }
    if (key.isKeyCode(::juce::KeyPress::F7Key)) {
        if (sceneHost_->triggerManualDiagnosticError()) {
            shell_.afterTitleAndTimerRelevantChange(*this);
        }
        return true;
    }
    if (key.getModifiers().isCommandDown() && (key.getTextCharacter() == 'c' || key.getTextCharacter() == 'C')) {
        if (sceneHost_->copyDiagnosticsToClipboard()) {
            shell_.afterTimerRelevantChange(*this);
            return true;
        }
    }
    const auto consumed = sceneHost_->keyPressed(key);
    if (consumed) {
        shell_.afterTimerRelevantChange(*this);
    }
    return consumed;
}

bool ArrangeEditor::isTextInputActive() const { return sceneHost_->isTextInputActive(); }

::juce::Range<int> ArrangeEditor::getHighlightedRegion() const { return sceneHost_->highlightedRegion(); }

void ArrangeEditor::setHighlightedRegion(const ::juce::Range<int>& newRange) {
    if (sceneHost_->setHighlightedRegion(newRange)) {
        shell_.afterTimerRelevantChange(*this);
    }
}

void ArrangeEditor::setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& underlinedRegions) {
    if (sceneHost_->setTemporaryUnderlining(underlinedRegions)) {
        shell_.afterTimerRelevantChange(*this);
    }
}

::juce::String ArrangeEditor::getTextInRange(const ::juce::Range<int>& range) const { return sceneHost_->textInRange(range); }

void ArrangeEditor::insertTextAtCaret(const ::juce::String& textToInsert) {
    if (sceneHost_->insertTextAtCaret(textToInsert)) {
        shell_.afterTimerRelevantChange(*this);
    }
}

int ArrangeEditor::getCaretPosition() const { return sceneHost_->caretPosition(); }

::juce::Rectangle<int> ArrangeEditor::getCaretRectangleForCharIndex(int characterIndex) const { return sceneHost_->caretRectangleForCharIndex(characterIndex); }

int ArrangeEditor::getTotalNumChars() const { return sceneHost_->totalNumChars(); }

int ArrangeEditor::getCharIndexForPoint(::juce::Point<int> point) const { return sceneHost_->charIndexForPoint(point); }

::juce::RectangleList<int> ArrangeEditor::getTextBounds(::juce::Range<int> textRange) const { return sceneHost_->textBounds(textRange); }

void ArrangeEditor::timerCallback() {
    shell_.timerTick(*this, ::juce::Time::getMillisecondCounterHiRes());
}

void ArrangeEditor::updateTimerState() {
    frameClock_.sync(
        *this,
        static_cast<::juce::Timer&>(*this),
        sceneHost_->timerDemand(),
        [this](double timestampMillis) {
            frameClock_.beginVBlankCallback();
            shell_.timerTick(*this, timestampMillis);
            if (frameClock_.endVBlankCallback()) {
                requestFrameClockResyncAsync();
            }
        });
}

void ArrangeEditor::requestFrameClockResyncAsync() {
    ::juce::Component::SafePointer<ArrangeEditor> safeThis(this);
    ::juce::MessageManager::callAsync([safeThis]() mutable {
        if (auto* editor = safeThis.getComponent()) {
            editor->updateTimerState();
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
