#include <arrange/juce/ArrangeEditor.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/Bridge.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/InputEditing.h>
#include <arrange/core/Layout.h>
#include <arrange/core/Paint.h>
#include <arrange/core/PointerDispatcher.h>
#include <arrange/core/PropValue.h>
#include <arrange/core/RenderTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/core/TextLayoutService.h>
#include <arrange/juce/AppResolver.h>
#include <arrange/juce/DevServerClient.h>
#include <arrange/juce/DiagnosticsOverlay.h>
#include <arrange/juce/ErrorScreenModel.h>
#include <arrange/juce/ImageResourceCache.h>
#include <arrange/juce/InputTextController.h>
#include <arrange/juce/InputTextSession.h>
#include <arrange/juce/JuceDrawOpsPainter.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/RuntimePackageLoader.h>
#include <arrange/juce/ScriptEventBridge.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cmath>
#include <filesystem>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <atomic>
#include <algorithm>
#include <utility>
#include <vector>

namespace arrange::juce {
    namespace {
        constexpr arrange::core::NodeId rootNodeId = 1;

        enum class LoadedSource {
            None,
            Live,
            Dist,
        };

        const char* loadedSourceLabel(LoadedSource source) noexcept {
            switch (source) {
            case LoadedSource::Live: return "live";
            case LoadedSource::Dist: return "dist";
            case LoadedSource::None: return "none";
            }
            return "none";
        }

        std::string decodedPropString(std::string value) { return arrange::core::decodeStringProp(value); }

        std::string nodeProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr) {
            if (const auto it = node.props.find(camelCase); it != node.props.end()) return it->second;
            if (kebabCase != nullptr) { if (const auto it = node.props.find(kebabCase); it != node.props.end()) return it->second; }
            return {};
        }

        std::string inputModelValue(const arrange::core::ArrangeNode& node) {
            auto value = nodeProp(node, "modelValue", "model-value");
            if (value.empty()) value = nodeProp(node, "value");
            return decodedPropString(value);
        }

        bool boolProp(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase = nullptr, bool fallback = false) {
            auto value = nodeProp(node, camelCase, kebabCase);
            return value.empty() ? fallback : arrange::core::EncodedProp(value).boolValue(fallback);
        }
    } // namespace

    class ArrangeEditor::Surface {
    public:
        Surface()
            : textLayoutService_(textMeasurer_),
              layout_(textLayoutService_) {}

        ~Surface() { stopDevServerClient(); }

        void configure(const EditorConfig& config) {
            config_ = config;
            diagnostics_.configure(config_.diagnostics);
            if (config_.preferDevServer && !config_.app.hasLive()) { config_.app.useLive(config_.devServerUrl); }
            stopDevServerClient();
            liveRuntimeEnabled_ = config_.app.hasLive();
            loadConfiguredPackage();
            startDevServerClientIfNeeded();
        }

        void reload() {
            emitDiagnostic(LogLevel::Info, "Reload requested", "Reloading Arrange app package.", true);
            loadConfiguredPackage();
        }

        void noteDevReloadRequested() { emitDiagnostic(LogLevel::Info, "HMR reload", "Dev server requested Arrange reload.", true); }

        void manualReload(bool toggleLive) {
            if (toggleLive && config_.app.hasLive()) {
                liveRuntimeEnabled_ = !liveRuntimeEnabled_;
                stopDevServerClient();
                startDevServerClientIfNeeded();
                emitDiagnostic(
                    LogLevel::Info,
                    liveRuntimeEnabled_ ? "Live enabled" : "Live disabled",
                    liveRuntimeEnabled_ ? "Manual reload will try live before dist." : "Manual reload will skip live and use dist.",
                    true);
            }
            else { emitDiagnostic(LogLevel::Info, "Manual reload", "F5 requested Arrange reload.", true); }
            loadConfiguredPackage();
        }

        bool triggerManualDiagnosticError() {

#if defined(NDEBUG)
return false;
#else
if (error_)return true;
loaded_=false;
inputSession_.focusedNode().reset();
inputSession_.dragAnchor().reset();
error_= makeErrorScreenModel(
    ErrorSource::ScriptRuntime,
      "Manual debug error triggered by F6.",
      "This is an intentional Arrange diagnostic error probe for testing error screen, retry/reload, copy diagnostics and repaint recovery.",
config_.app.distPath(),
      true);
emitDiagnostic(LogLevel::Error, "Manual debug error", "F6 intentionally opened the Arrange error screen.", true);
requiresFullRepaint_=true;
    return true;
#endif
}

bool pushManualDiagnosticToast() {

#if defined(NDEBUG)
return false;
#else
const auto time = DiagnosticsOverlay::currentLocalTimeLabel();
emitDiagnostic(LogLevel::Info, "Manual toast probe", "F7 at " + time, true, false);
    return true;
#endif
}

void repaintDirty(::juce::Component& owner, bool fullIfNoBounds) {
    if (requiresFullRepaint_) {
        requiresFullRepaint_ = false;
        if (loaded_&& tree_
        .
        contains(rootNodeId)
        )
        tree_.clearDirty();
        owner.repaint();
        return;
    }

    if (error_) {
        owner.repaint();
        return;
    }

    if (!loaded_ || !tree_.contains(rootNodeId)) {
        if (fullIfNoBounds) owner.repaint();
        return;
    }

    const auto snapshot = tree_.dirtySnapshot();
    tree_.clearDirty();
    if (!snapshot.hasRepaintBounds) {
        if (fullIfNoBounds) owner.repaint();
        return;
    }

    const auto left = static_cast<int>(std::floor(snapshot.repaintBounds.x)) - 2;
    const auto top = static_cast<int>(std::floor(snapshot.repaintBounds.y)) - 2;
    const auto right = static_cast<int>(std::ceil(snapshot.repaintBounds.x + snapshot.repaintBounds.width)) + 2;
    const auto bottom = static_cast<int>(std::ceil(snapshot.repaintBounds.y + snapshot.repaintBounds.height)) + 2;
    auto area = ::juce::Rectangle<int>::leftTopRightBottom(left, top, right, bottom);
    area = area.getIntersection(owner.getLocalBounds());
    if (!area.isEmpty()) { owner.repaint(area); }
    else if (fullIfNoBounds) { owner.repaint(); }
}

bool consumeDevReloadRequested() { return devReloadRequested_.exchange(false); }

bool wantsDevTimer() const { return config_.app.hasLive(); }

bool wantsTimer() const { return wantsDevTimer() || diagnostics_.hasActiveToasts() || wantsAnimationTimer(); }

int desiredTimerFrequencyHz() const { return wantsAnimationTimer() ? 60 : 20; }

bool tickDiagnostics() {
    if (!diagnostics_.tick(nativeFrameTimeMillis())) return false;
    requiresFullRepaint_ = true;
    return true;
}

bool tickAnimationFrame() {

#if ARRANGE_WITH_QUICKJS_NG
if (!scriptHost_|| !scriptHost_->hasPendingAnimationFrame()) return false;
const auto pumped = scriptHost_->pumpAnimationFrame(nativeFrameTimeMillis());
    if (!pumped.ok) {
      error_ = makeErrorScreenModel(ErrorSource::ScriptRuntime, pumped.error, {}, config_.app.distPath());
      emitDiagnostic(LogLevel::Error, "Animation frame failed", pumped.error, true);
      loaded_ = false;
      return true;
    }
    return applyMountedScriptBatch();
#else
return false;
#endif
}

bool copyDiagnosticsToClipboard() {
    if (!error_) return false;
    ::juce::SystemClipboard::copyTextToClipboard(diagnosticsText());
    emitDiagnostic(LogLevel::Info, "Copied diagnostics", "Error diagnostics copied to clipboard.", true);
    return true;
}

std::string windowTitle(std::string_view baseTitle) const {

#if defined(NDEBUG)
return std::string (baseTitle);
#else
std::string title(baseTitle);
title+= " [Debug ";
    if (!config_.app.hasAnySource()) {
      title += "no app";
    } else if (error_) { title += "error"; }else if (activeSource_== LoadedSource::Dist&& lastLiveUnavailable_) {
      title += "dist fallback";
    } else {
      title += loadedSourceLabel(activeSource_);
    }
title+= "]";
    return title;
#endif
}

void resized(int width, int height) {
    width_ = width;
    height_ = height;
    if (loaded_&& tree_
    .
    contains(rootNodeId)
    )
    {
        layout_.layout(tree_, rootNodeId, {0.0f, static_cast<float>(width_), 0.0f, static_cast<float>(height_)});
        requiresFullRepaint_ = true;
    }
}

void paint(::juce::Graphics& g, ::juce::Rectangle<int> bounds) {
    g.fillAll(::juce::Colour(0xff1f232a));
    if (error_) {
        diagnostics_.paintErrorScreen(g, bounds, *error_, config_.diagnostics.errorScreen);
        paintDiagnosticsBadge(g, bounds);
        paintDiagnosticToasts(g, bounds);
        return;
    }

    if (!loaded_ || !tree_.contains(rootNodeId)) {
        diagnostics_.paintErrorScreen(g, bounds, makeErrorScreenModel(ErrorSource::BridgeProtocol, "Arrange render tree is empty after loading UI package."), true);
        paintDiagnosticsBadge(g, bounds);
        paintDiagnosticToasts(g, bounds);
        return;
    }

    updateFocusedInputViewport();

    const auto paintResult = drawOpsPainter_.paint(g, paintModel_.collect(tree_, rootNodeId), imageResources_, inputSession_.focusedNode(), inputSession_.viewportX());
    if (paintResult.error) {
        error_ = *paintResult.error;
        loaded_ = false;
        diagnostics_.paintErrorScreen(g, bounds, *error_, config_.diagnostics.errorScreen);
        paintDiagnosticsBadge(g, bounds);
        return;
    }
    paintFocusedInput(g);
    paintDiagnosticsBadge(g, bounds);
    paintDiagnosticToasts(g, bounds);
}

void pointerDown(const ::juce::MouseEvent& event) {
    if (error_) return;
    if (!loaded_) return;
    const auto hit = hitTester_.hitTest(tree_, rootNodeId, {static_cast<float>(event.x), static_cast<float>(event.y)});
    if (!hit.hit || tree_.node(hit.node).type != arrange::core::NodeType::Input) {
        finishFocusedInput(false);
        inputSession_.dragAnchor().reset();
        (void)pointer_.pointerDown(tree_, rootNodeId, {static_cast<float>(event.x), static_cast<float>(event.y)}, 0);
        return;
    }

    const auto sameInput = inputSession_.focusedNode() && *inputSession_.focusedNode() == hit.node;
    if (inputSession_.focusedNode() && *inputSession_.focusedNode() != hit.node) finishFocusedInput(false);
    inputSession_.focusedNode() = hit.node;
    const auto& node = tree_.node(hit.node);
    const auto selectAllOnFocus = !sameInput && boolProp(node, "selectAllOnFocus", "select-all-on-focus", false);
    if (!sameInput) {
        inputSession_.viewportX() = 0.0f;
        inputSession_.state().begin(inputModelValue(node), selectAllOnFocus);
    }
    if (!selectAllOnFocus) inputSession_.state().moveCursorTo(inputTextController_.textIndexAtPoint(node, inputSession_.state().text(), inputSession_.viewportX(), static_cast<float>(event.x), static_cast<float>(event.y)));
    updateFocusedInputViewport();
    inputSession_.dragAnchor() = inputSession_.state().cursorIndex();
    arrange::core::markDirty(tree_.node(hit.node), arrange::core::DirtyFlag::Paint);
    (void)pointer_.pointerDown(tree_, rootNodeId, {static_cast<float>(event.x), static_cast<float>(event.y)}, 0);
}

bool pointerDrag(const ::juce::MouseEvent& event) {
    if (error_ || !loaded_ || !inputSession_.focusedNode() || !inputSession_.dragAnchor() || !tree_.contains(*inputSession_.focusedNode())) return false;
    auto& node = tree_.node(*inputSession_.focusedNode());
    if (node.type != arrange::core::NodeType::Input) return false;
    inputSession_.state().selectRange(*inputSession_.dragAnchor(), inputTextController_.textIndexAtPoint(node, inputSession_.state().text(), inputSession_.viewportX(), static_cast<float>(event.x), static_cast<float>(event.y)));
    updateFocusedInputViewport();
    arrange::core::markDirty(node, arrange::core::DirtyFlag::Paint);
    return true;
}

void pointerUp(const ::juce::MouseEvent& event) {
    if (error_) {
        if (error_->retryAvailable) loadConfiguredPackage();
        return;
    }
    if (!loaded_) return;
    inputSession_.dragAnchor().reset();
    const auto result = pointer_.pointerUp(tree_, rootNodeId, {static_cast<float>(event.x), static_cast<float>(event.y)}, 0);
    if (!result.clickTriggered || result.callbackHandle == 0) return;

#if ARRANGE_WITH_QUICKJS_NG
const auto invoked = eventBridge_.invoke(scriptHost_.get(), result.callbackHandle, nativeFrameTimeMillis());
    if (!invoked.ok) {
      error_ = makeErrorScreenModel(ErrorSource::ScriptRuntime, invoked.error, {}, config_.app.distPath());
      emitDiagnostic(LogLevel::Error, "Pointer callback failed", invoked.error, true);
      loaded_ = false;
      return;
    }
    if (invoked.invoked) (void)applyMountedScriptBatch();
#endif
}

bool wheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
    if (error_ || !loaded_ || !tree_.contains(rootNodeId)) return false;
    const auto point = arrange::core::Point{static_cast<float>(event.x), static_cast<float>(event.y)};
    const auto result = wheel.deltaX != 0.0f
                            ? scroll_.horizontalWheel(tree_, rootNodeId, point, wheel.deltaX)
                            : scroll_.verticalWheel(tree_, rootNodeId, point, wheel.deltaY);
    if (!result.consumed) return false;
    resized(width_, height_);
#if ARRANGE_WITH_QUICKJS_NG
const auto invoked = eventBridge_.invokeString(scriptHost_.get(), result.callbackHandle, nativeFrameTimeMillis(), ScriptEventBridge::scrollSnapshotJson(result));
    if (!invoked.ok) {
      error_ = makeErrorScreenModel(ErrorSource::ScriptRuntime, invoked.error, {}, config_.app.distPath());
      emitDiagnostic(LogLevel::Error, "Scroll callback failed", invoked.error, true);
      loaded_ = false;
      return true;
    }
    if (invoked.invoked) (void)applyMountedScriptBatch();
#endif
return true;
  }

bool isTextInputActive() const {
    return !error_ && loaded_ && inputSession_.focusedNode() && tree_.contains(*inputSession_.focusedNode()) &&
        tree_.node(*inputSession_.focusedNode()).type == arrange::core::NodeType::Input;
}

::juce::Range<int> highlightedRegion() const {
    if (!isTextInputActive()) return {};
    const auto& text = inputSession_.state().text();
    return {
        charIndexForByteIndex(text, std::min(inputSession_.state().selectionStart(), inputSession_.state().selectionEnd())),
        charIndexForByteIndex(text, std::max(inputSession_.state().selectionStart(), inputSession_.state().selectionEnd())),
    };
}

bool setHighlightedRegion(const ::juce::Range<int>& range) {
    if (!isTextInputActive()) return false;
    auto& node = tree_.node(*inputSession_.focusedNode());
    const auto anchor = byteIndexForCharIndex(inputSession_.state().text(), range.getStart());
    const auto active = byteIndexForCharIndex(inputSession_.state().text(), range.getEnd());
    inputSession_.state().selectRange(anchor, active);
    inputSession_.temporaryUnderlines().clear();
    updateFocusedInputViewport();
    arrange::core::markDirty(node, arrange::core::DirtyFlag::Paint);
    return true;
}

bool setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& ranges) {
    if (!isTextInputActive()) return false;
    inputSession_.temporaryUnderlines().clear();
    for (const auto& range : ranges) { if (!range.isEmpty()) inputSession_.temporaryUnderlines().push_back(range); }
    arrange::core::markDirty(tree_.node(*inputSession_.focusedNode()), arrange::core::DirtyFlag::Paint);
    return true;
}

::juce::String textInRange(const ::juce::Range<int>& range) const {
    if (!isTextInputActive()) return {};
    const auto& text = inputSession_.state().text();
    const auto start = byteIndexForCharIndex(text, range.getStart());
    const auto end = byteIndexForCharIndex(text, range.getEnd());
    if (end <= start) return {};
    return ::juce::String::fromUTF8(text.data() + start, static_cast<int>(end - start));
}

bool insertTextAtCaret(const ::juce::String& textToInsert) {
    if (!isTextInputActive()) return false;
    auto& node = tree_.node(*inputSession_.focusedNode());
    const auto edit = inputSession_.state().replaceSelectionWithText(normalizeInputInsertionText(node, textToInsert.toStdString()));
    return applyInputEdit(node, edit);
}

int caretPosition() const {
    if (!isTextInputActive()) return 0;
    return charIndexForByteIndex(inputSession_.state().text(), inputSession_.state().cursorIndex());
}

int totalNumChars() const {
    if (!isTextInputActive()) return 0;
    return totalUtf8Chars(inputSession_.state().text());
}

int charIndexForPoint(::juce::Point<int> point) const {
    if (!isTextInputActive()) return 0;
    const auto byteIndex = inputTextController_.textIndexAtPoint(tree_.node(*inputSession_.focusedNode()), inputSession_.state().text(), inputSession_.viewportX(), static_cast<float>(point.x), static_cast<float>(point.y));
    return charIndexForByteIndex(inputSession_.state().text(), byteIndex);
}

::juce::Rectangle<int> caretRectangleForCharIndex(int characterIndex) const {
    if (!isTextInputActive()) return {};
    const auto byteIndex = byteIndexForCharIndex(inputSession_.state().text(), characterIndex);
    const auto rects = textBoundsForByteRange(byteIndex, byteIndex);
    if (!rects.isEmpty()) return rects.getBounds();
    return {};
}

::juce::RectangleList<int> textBounds(::juce::Range<int> range) const {
    if (!isTextInputActive()) return {};
    const auto& text = inputSession_.state().text();
    return textBoundsForByteRange(
        byteIndexForCharIndex(text, range.getStart()),
        byteIndexForCharIndex(text, range.getEnd()));
}

bool keyPressed(const ::juce::KeyPress& key) {
    if (error_ || !loaded_ || !inputSession_.focusedNode() || !tree_.contains(*inputSession_.focusedNode())) return false;
    auto& node = tree_.node(*inputSession_.focusedNode());
    if (node.type != arrange::core::NodeType::Input) return false;

    arrange::core::InputEditResult edit;
    const auto textCharacter = key.getTextCharacter();
    const auto commandDown = key.getModifiers().isCommandDown();
    const auto shiftDown = key.getModifiers().isShiftDown();
    if (commandDown && (textCharacter == 'a' || textCharacter == 'A')) { edit = inputSession_.state().selectAll(); }
    else if (commandDown && (textCharacter == 'c' || textCharacter == 'C')) {
        const auto selected = inputSession_.state().selectedText();
        if (selected.empty()) return false;
        ::juce::SystemClipboard::copyTextToClipboard(selected);
        arrange::core::markDirty(node, arrange::core::DirtyFlag::Paint);
        return true;
    }
    else if (commandDown && (textCharacter == 'x' || textCharacter == 'X')) {
        const auto selected = inputSession_.state().selectedText();
        if (!selected.empty()) ::juce::SystemClipboard::copyTextToClipboard(selected);
        edit = inputSession_.state().cutSelection();
    }
    else if (commandDown && (textCharacter == 'v' || textCharacter == 'V')) { edit = inputSession_.state().replaceSelectionWithText(normalizeInputInsertionText(node, ::juce::SystemClipboard::getTextFromClipboard().toStdString())); }
    else if (commandDown && (textCharacter == 'z' || textCharacter == 'Z')) { edit = shiftDown ? inputSession_.state().redo() : inputSession_.state().undo(); }
    else if (commandDown && (textCharacter == 'y' || textCharacter == 'Y')) { edit = inputSession_.state().redo(); }
    else if (key == ::juce::KeyPress::backspaceKey) { edit = inputSession_.state().backspace(); }
    else if (key == ::juce::KeyPress::deleteKey) { edit = inputSession_.state().deleteForward(); }
    else if (key == ::juce::KeyPress::leftKey) { edit = shiftDown ? inputSession_.state().extendSelectionLeft() : inputSession_.state().moveLeft(); }
    else if (key == ::juce::KeyPress::rightKey) { edit = shiftDown ? inputSession_.state().extendSelectionRight() : inputSession_.state().moveRight(); }
    else if (key == ::juce::KeyPress::homeKey) { edit = shiftDown ? inputSession_.state().extendSelectionHome() : inputSession_.state().moveHome(); }
    else if (key == ::juce::KeyPress::endKey) { edit = shiftDown ? inputSession_.state().extendSelectionEnd() : inputSession_.state().moveEnd(); }
    else if (key == ::juce::KeyPress::returnKey) { edit = InputTextController::allowsLineBreak(node) && !commandDown ? inputSession_.state().insertLineBreak() : inputSession_.state().submit(); }
    else { edit = inputSession_.state().insertCodepoint(static_cast<char32_t>(textCharacter)); }

    return applyInputEdit(node, edit);
}

private:
struct DevLoadResult {
    bool ok = false;
    bool serverUnavailable = false;
};

static double nativeFrameTimeMillis() { return ::juce::Time::getMillisecondCounterHiRes(); }

#if ARRANGE_WITH_QUICKJS_NG
bool wantsAnimationTimer() const { return scriptHost_ && scriptHost_->hasPendingAnimationFrame(); }

bool applyMountedScriptBatch() {
    if (!scriptHost_ || !scriptHost_->mountedBatch()) return false;
    tree_.apply(*scriptHost_->mountedBatch());
    resized(width_, height_);
    return true;
}
#else
bool wantsAnimationTimer() const { return false; }
bool applyMountedScriptBatch() { return false; }
#endif

void invokeInputStringCallback(const arrange::core::ArrangeNode& node, const char* camelCase, const char* kebabCase, const std::string& value) {

#if ARRANGE_WITH_QUICKJS_NG
const auto handle = ScriptEventBridge::callbackHandleFromAnyProp(node, camelCase, kebabCase);
const auto invoked = eventBridge_.invokeString(scriptHost_.get(), handle, nativeFrameTimeMillis(), value);
    if (!invoked.ok) {
      error_ = makeErrorScreenModel(ErrorSource::ScriptRuntime, invoked.error, {}, config_.app.distPath());
      emitDiagnostic(LogLevel::Error, "Input callback failed", invoked.error, true);
      loaded_ = false;
      return;
    }
    if (invoked.invoked) (void)applyMountedScriptBatch();
#else
(void)node;
(void)camelCase;
(void)kebabCase;
(void)value;
#endif
}

bool applyInputEdit(arrange::core::ArrangeNode& node, const arrange::core::InputEditResult& edit) {
    if (!edit.consumed) return false;
    inputSession_.temporaryUnderlines().clear();
    updateFocusedInputViewport();
    arrange::core::markDirty(node, arrange::core::DirtyFlag::Paint);
    if (edit.submitRequested) {
        invokeInputStringCallback(node, "onSubmit", nullptr, inputSession_.state().text());
        return true;
    }
    if (!edit.textChanged) return true;

    node.props["modelValue"] = "s:" + inputSession_.state().text();
    arrange::core::markDirty(node, arrange::core::DirtyFlag::Layout);
    arrange::core::markDirty(node, arrange::core::DirtyFlag::Paint);

#if ARRANGE_WITH_QUICKJS_NG
const auto handle = ScriptEventBridge::callbackHandleFromAnyProp(node, "onUpdate:modelValue", "onUpdate:model-value");
const auto invoked = eventBridge_.invokeString(scriptHost_.get(), handle, nativeFrameTimeMillis(), inputSession_.state().text());
    if (!invoked.ok) {
      error_ = makeErrorScreenModel(ErrorSource::ScriptRuntime, invoked.error, {}, config_.app.distPath());
      emitDiagnostic(LogLevel::Error, "Input submit callback failed", invoked.error, true);
      loaded_ = false;
      return true;
    }
    if (invoked.invoked) (void)applyMountedScriptBatch();
#endif

resized(width_, height_);
    return true;
  }

std::string normalizeInputInsertionText(const arrange::core::ArrangeNode& node, std::string text) const {
    if (InputTextController::allowsLineBreak(node)) return text;
    for (auto& ch : text) { if (ch == '\r' || ch == '\n') ch = ' '; }
    return text;
}

void finishFocusedInput(bool submit) {
    if (!inputSession_.focusedNode() || !tree_.contains(*inputSession_.focusedNode())) {
        inputSession_.focusedNode().reset();
        inputSession_.state().reset();
        inputSession_.dragAnchor().reset();
        inputSession_.temporaryUnderlines().clear();
        return;
    }

    auto& node = tree_.node(*inputSession_.focusedNode());
    if (node.type == arrange::core::NodeType::Input) {
        if (submit) invokeInputStringCallback(node, "onSubmit", nullptr, inputSession_.state().text());
        if (inputSession_.state().changedSinceBegin()) invokeInputStringCallback(node, "onChange", nullptr, inputSession_.state().text());
        invokeInputStringCallback(node, "onBlur", nullptr, inputSession_.state().text());
    }

    inputSession_.focusedNode().reset();
    inputSession_.state().reset();
    inputSession_.dragAnchor().reset();
    inputSession_.temporaryUnderlines().clear();
    inputSession_.viewportX() = 0.0f;
}

::juce::RectangleList<int> textBoundsForByteRange(std::size_t start, std::size_t end) const {
    if (!isTextInputActive()) return {};
    const auto& node = tree_.node(*inputSession_.focusedNode());
    const auto& text = inputSession_.state().text();
    return inputTextController_.textBoundsForByteRange(inputTextController_.layout(node, text, inputSession_.viewportX()), text, start, end);
}

void updateFocusedInputViewport() {
    if (!isTextInputActive()) {
        inputSession_.viewportX() = 0.0f;
        return;
    }
    const auto& node = tree_.node(*inputSession_.focusedNode());
    inputSession_.viewportX() = inputTextController_.updatedViewportX(node, inputSession_.state().text(), inputSession_.state().cursorIndex(), inputSession_.viewportX());
}

void paintFocusedInput(::juce::Graphics& g) {
    if (!inputSession_.focusedNode() || !tree_.contains(*inputSession_.focusedNode())) return;
    const auto& node = tree_.node(*inputSession_.focusedNode());
    if (node.type != arrange::core::NodeType::Input) return;
    inputTextController_.paintFocusedInput(g, node, inputSession_.state(), inputSession_.viewportX(), inputSession_.temporaryUnderlines());
}

void paintDiagnosticsBadge(::juce::Graphics& g, ::juce::Rectangle<int> bounds) const { diagnostics_.paintBadge(g, bounds, diagnosticsBadgeModel()); }

void paintDiagnosticToasts(::juce::Graphics& g, ::juce::Rectangle<int> bounds) const { diagnostics_.paintToasts(g, bounds); }

DiagnosticsBadgeModel diagnosticsBadgeModel() const {

#if defined(NDEBUG)
const char* buildMode = "Release";
#else
const char* buildMode = "Debug";
#endif
DiagnosticsBadgeModel model;
model.text= std::string (buildMode)+ " " + loadedSourceLabel (activeSource_);
model.dot= ::juce::Colour (0xffef4444);
    if (activeSource_== LoadedSource::Live) model.dot= ::juce::Colour (0xff22c55e);
    if (activeSource_== LoadedSource::Dist) model.dot= lastLiveUnavailable_? ::juce::Colour (0xfff59e0b) : ::juce::Colour (0xff3b82f6);
    if (error_) model.text= std::string (buildMode)+ " error";
    if (!config_.app.hasAnySource()) model.text= std::string (buildMode)+ " no app";
    return model;
  }

void emitDiagnostic(LogLevel level, std::string title, std::string message = {}, bool toast = false, bool coalesceToast = true) { if (diagnostics_.emit(level, std::move(title), std::move(message), toast, coalesceToast)) requiresFullRepaint_ = true; }

std::string diagnosticsText() const {
    DiagnosticsTextContext context;
    context.activeSource = loadedSourceLabel(activeSource_);
    context.liveRuntimeEnabled = liveRuntimeEnabled_;
    context.hasLive = config_.app.hasLive();
    context.hasDist = config_.app.hasDist();
    context.devServerUrl = config_.devServerUrl;
    context.appPath = config_.app.distPath();
    context.error = error_ ? &*error_ : nullptr;
    return diagnostics_.diagnosticsText(context);
}

void startDevServerClientIfNeeded() {
    if (!config_.app.hasLive() || !liveRuntimeEnabled_) return;
    const auto resolved = resolver_.resolveDebug(config_.app, config_.devServerUrl);
    if (!resolved.ok || resolved.devServerUrl.empty()) return;
    devServerClient_ = std::make_unique<arrange::DevServerReloadClient>();
    devServerClient_->start(resolved.devServerUrl, [this](arrange::DevReloadEvent) { devReloadRequested_ = true; });
}

void stopDevServerClient() {
    if (devServerClient_) {
        devServerClient_->stop();
        devServerClient_.reset();
    }
    devReloadRequested_ = false;
}

void resetRuntimeState() {
    loaded_ = false;
    tree_ = {};
    error_.reset();
    inputSession_.reset();
    imageResources_.clear();
#if ARRANGE_WITH_QUICKJS_NG
scriptHost_.reset();
#endif
}

void loadConfiguredPackage() {
    if (!config_.app.hasAnySource()) {
        resetRuntimeState();
        activeSource_ = LoadedSource::None;
        error_ = makeErrorScreenModel(ErrorSource::AppPackage, "你啥也没给我给你加载啥app（笑）Call config.app.useLive(...) or config.app.useDist(...).");
        emitDiagnostic(LogLevel::Error, "No app source", "Call config.app.useLive(...) or config.app.useDist(...).", true);
        requiresFullRepaint_ = true;
        return;
    }

    if (config_.app.hasLive() && liveRuntimeEnabled_) {
        const auto devLoaded = loadDevServerPackage();
        if (devLoaded.ok) return;
        if (!devLoaded.serverUnavailable || !config_.app.hasDist()) return;
        lastLiveUnavailable_ = true;
        emitDiagnostic(LogLevel::Warn, "Using dist fallback", "Live dev server is unavailable; loading configured dist package.", true);
    }
    if (config_.app.hasDist()) loadReleasePackage();
}

DevLoadResult loadDevServerPackage() {
    DevLoadResult result;
    resetRuntimeState();
    activeSource_ = LoadedSource::None;

    auto loaded = runtimeLoader_.loadLive(config_, resolver_);
    packageDir_ = loaded.packageDir;
    if (!packageDir_.empty()) imageResources_.setPackageDir(packageDir_);

    if (!loaded.ok) {
        result.serverUnavailable = loaded.serverUnavailable;
        if (loaded.error) error_ = *loaded.error;
        if (loaded.diagnostic) emitDiagnostic(loaded.diagnostic->level, loaded.diagnostic->title, loaded.diagnostic->message, loaded.diagnostic->toast, loaded.diagnostic->coalesceToast);
        return result;
    }

#if ARRANGE_WITH_QUICKJS_NG
scriptHost_= std::move (loaded.scriptHost);
#endif
if (loaded.mountedBatch) tree_.apply (*loaded.mountedBatch);
loaded_=true;
activeSource_= LoadedSource::Live;
lastLiveUnavailable_=false;
resized(width_, height_);
requiresFullRepaint_=true;
    if (loaded.diagnostic) emitDiagnostic (loaded.diagnostic->level, loaded.diagnostic->title, loaded.diagnostic->message, loaded.diagnostic->toast, loaded.diagnostic->coalesceToast);
result.ok=true;
    return result;
  }


void loadReleasePackage() {
    resetRuntimeState();
    activeSource_ = LoadedSource::None;

    auto loaded = runtimeLoader_.loadDist(config_, resolver_);
    packageDir_ = loaded.packageDir;
    if (!packageDir_.empty()) imageResources_.setPackageDir(packageDir_);

    if (!loaded.ok) {
        if (loaded.error) error_ = *loaded.error;
        if (loaded.diagnostic) emitDiagnostic(loaded.diagnostic->level, loaded.diagnostic->title, loaded.diagnostic->message, loaded.diagnostic->toast, loaded.diagnostic->coalesceToast);
        return;
    }

#if ARRANGE_WITH_QUICKJS_NG
scriptHost_= std::move (loaded.scriptHost);
#endif
if (loaded.mountedBatch) tree_.apply (*loaded.mountedBatch);
loaded_=true;
activeSource_= LoadedSource::Dist;
resized(width_, height_);
requiresFullRepaint_=true;
emitDiagnostic(LogLevel::Info, lastLiveUnavailable_ ? "Loaded dist fallback" : "Loaded dist app", loaded.diagnostic ? loaded.diagnostic->message : packageDir_.string(), lastLiveUnavailable_);
  }


EditorConfig config_;
AppResolver resolver_;
RuntimePackageLoader runtimeLoader_;
ScriptEventBridge eventBridge_;
arrange::core::RenderTree tree_;
arrange::core::PaintModel paintModel_;
arrange::core::PointerDispatcher pointer_;
arrange::core::ScrollDispatcher scroll_;
arrange::core::HitTester hitTester_;
JuceTextMeasurer textMeasurer_;
arrange::core::TextLayoutService textLayoutService_{textMeasurer_};
InputTextController inputTextController_{textLayoutService_};
arrange::core::LayoutEngine layout_{textLayoutService_};
JuceDrawOpsPainter drawOpsPainter_;
ImageResourceCache imageResources_;
std::optional<ErrorScreenModel> error_;
InputTextSession inputSession_;
DiagnosticsOverlay diagnostics_;
std::filesystem::path packageDir_;
std::unique_ptr<arrange::DevServerReloadClient> devServerClient_;
std::atomic<bool> devReloadRequested_{false};
#if ARRANGE_WITH_QUICKJS_NG
std::unique_ptr<arrange::quickjs::QuickJsScriptHost> scriptHost_;
#endif
LoadedSource activeSource_ = LoadedSource::None;
bool liveRuntimeEnabled_ = false;
bool lastLiveUnavailable_ = false;
bool requiresFullRepaint_ = false;
bool loaded_ = false;
int width_ = 0;
int height_ = 0;
};

ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor)
    : ArrangeEditor(processor, EditorConfig{}) {}

ArrangeEditor::ArrangeEditor(::juce::AudioProcessor& processor, EditorConfig config)
    : ::juce::AudioProcessorEditor(processor),
      surface_(std::make_unique<Surface>()) { configure(std::move(config)); }

ArrangeEditor::~ArrangeEditor() { stopTimer(); }

void ArrangeEditor::configure(EditorConfig config) {
    config_ = config;
    setSize(config_.width, config_.height);
    setName(config_.window.title);
    setResizeLimits(config_.window.minWidth, config_.window.minHeight, config_.window.maxWidth, config_.window.maxHeight);
    setResizable(config_.window.resizable, config_.window.useCornerResizer);
    setWantsKeyboardFocus(true);
    surface_->configure(config_);
    surface_->resized(getWidth(), getHeight());
    updateWindowTitle();
    updateTimerState();
    surface_->repaintDirty(*this, true);
}

void ArrangeEditor::reload() {
    surface_->reload();
    updateWindowTitle();
    updateTimerState();
    surface_->repaintDirty(*this, true);
}

void ArrangeEditor::resized() {
    surface_->resized(getWidth(), getHeight());
    updateWindowTitle();
    surface_->repaintDirty(*this, true);
}

void ArrangeEditor::paint(::juce::Graphics& g) { surface_->paint(g, getLocalBounds()); }

void ArrangeEditor::parentHierarchyChanged() { updateWindowTitle(); }

void ArrangeEditor::mouseDown(const ::juce::MouseEvent& event) {
    grabKeyboardFocus();
    surface_->pointerDown(event);
    if (auto* peer = getPeer()) peer->refreshTextInputTarget();
    surface_->repaintDirty(*this, false);
}

void ArrangeEditor::mouseDrag(const ::juce::MouseEvent& event) { if (surface_->pointerDrag(event)) surface_->repaintDirty(*this, false); }

void ArrangeEditor::mouseUp(const ::juce::MouseEvent& event) {
    surface_->pointerUp(event);
    updateTimerState();
    surface_->repaintDirty(*this, false);
}

void ArrangeEditor::mouseWheelMove(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
    if (surface_->wheelMove(event, wheel)) {
        updateTimerState();
        surface_->repaintDirty(*this, false);
    }
}

bool ArrangeEditor::keyPressed(const ::juce::KeyPress& key) {
    if (key.isKeyCode(::juce::KeyPress::F5Key)) {
        surface_->manualReload(key.getModifiers().isCommandDown());
        updateWindowTitle();
        updateTimerState();
        surface_->repaintDirty(*this, true);
        return true;
    }
    if (key.isKeyCode(::juce::KeyPress::F6Key)) {
        if (surface_->pushManualDiagnosticToast()) {
            updateTimerState();
            surface_->repaintDirty(*this, true);
        }
        return true;
    }
    if (key.isKeyCode(::juce::KeyPress::F7Key)) {
        if (surface_->triggerManualDiagnosticError()) {
            updateWindowTitle();
            updateTimerState();
            surface_->repaintDirty(*this, true);
        }
        return true;
    }
    if (key.getModifiers().isCommandDown() && (key.getTextCharacter() == 'c' || key.getTextCharacter() == 'C')) {
        if (surface_->copyDiagnosticsToClipboard()) {
            updateTimerState();
            surface_->repaintDirty(*this, true);
            return true;
        }
    }
    const auto consumed = surface_->keyPressed(key);
    if (consumed) {
        updateTimerState();
        surface_->repaintDirty(*this, false);
    }
    return consumed;
}

bool ArrangeEditor::isTextInputActive() const { return surface_->isTextInputActive(); }

::juce::Range<int> ArrangeEditor::getHighlightedRegion() const { return surface_->highlightedRegion(); }

void ArrangeEditor::setHighlightedRegion(const ::juce::Range<int>& newRange) { if (surface_->setHighlightedRegion(newRange)) surface_->repaintDirty(*this, false); }

void ArrangeEditor::setTemporaryUnderlining(const ::juce::Array<::juce::Range<int>>& underlinedRegions) { if (surface_->setTemporaryUnderlining(underlinedRegions)) surface_->repaintDirty(*this, false); }

::juce::String ArrangeEditor::getTextInRange(const ::juce::Range<int>& range) const { return surface_->textInRange(range); }

void ArrangeEditor::insertTextAtCaret(const ::juce::String& textToInsert) {
    if (surface_->insertTextAtCaret(textToInsert)) {
        updateTimerState();
        surface_->repaintDirty(*this, false);
    }
}

int ArrangeEditor::getCaretPosition() const { return surface_->caretPosition(); }

::juce::Rectangle<int> ArrangeEditor::getCaretRectangleForCharIndex(int characterIndex) const { return surface_->caretRectangleForCharIndex(characterIndex); }

int ArrangeEditor::getTotalNumChars() const { return surface_->totalNumChars(); }

int ArrangeEditor::getCharIndexForPoint(::juce::Point<int> point) const { return surface_->charIndexForPoint(point); }

::juce::RectangleList<int> ArrangeEditor::getTextBounds(::juce::Range<int> textRange) const { return surface_->textBounds(textRange); }

void ArrangeEditor::timerCallback() {
    const auto diagnosticsChanged = surface_->tickDiagnostics();
    const auto animationChanged = surface_->tickAnimationFrame();
    updateWindowTitle();
    if (!surface_->consumeDevReloadRequested()) {
        updateTimerState();
        if (diagnosticsChanged || animationChanged) surface_->repaintDirty(*this, true);
        return;
    }
    surface_->noteDevReloadRequested();
    surface_->reload();
    updateWindowTitle();
    updateTimerState();
    surface_->repaintDirty(*this, true);
}

void ArrangeEditor::updateTimerState() {
    if (surface_->wantsTimer()) {
        const auto hz = surface_->desiredTimerFrequencyHz();
        if (!isTimerRunning() || timerFrequencyHz_ != hz) {
            startTimerHz(hz);
            timerFrequencyHz_ = hz;
        }
    }
    else {
        stopTimer();
        timerFrequencyHz_ = 0;
    }
}

void ArrangeEditor::updateWindowTitle() {
    const auto title = ::juce::String(surface_->windowTitle(config_.window.title));
    setName(title);
    if (auto* peer = getPeer()) { peer->setTitle(title); }
    if (auto* topLevel = getTopLevelComponent()) {
        topLevel->setName(title);
        if (auto* peer = topLevel->getPeer()) { peer->setTitle(title); }
    }
}

} // namespace arrange::juce

#endif
