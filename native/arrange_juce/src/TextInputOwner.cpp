#include <arrange/juce/TextInputOwner.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/PropValue.h>
#include <arrange/core/ModifierGeometry.h>
#include <arrange/juce/JuceTextServices.h>

#include <algorithm>
#include <stdexcept>
#include <utility>

namespace arrange::juce {
    TextInputOwner::TextInputOwner(arrange::core::TextLayoutService& textLayoutService) noexcept : text_(textLayoutService) {}

    void TextInputOwner::reset() {
        session_.reset();
        focusedGeneration_ = 0;
        focusedModifier_ = {};
        publishedModelValue_.clear();
    }

    void TextInputOwner::cancelDrag() noexcept {
        session_.dragAnchor().reset();
    }

    const std::optional<arrange::core::NodeId>& TextInputOwner::focusedNode() const noexcept {
        return session_.focusedNode();
    }

    float TextInputOwner::viewportX() const noexcept {
        return session_.viewportX();
    }

    const arrange::core::ModifierInstance& TextInputOwner::inputInstance(const arrange::core::LayoutNode& node) const {
        const auto* instance = node.modifier.find(focusedModifier_);
        if (!instance || !std::holds_alternative<arrange::core::TextFieldModifier>(instance->descriptor.value)) throw std::logic_error("文本编辑受体已退休");
        return *instance;
    }

    const arrange::core::LayoutNode* TextInputOwner::activeInputNode(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        if (!runtimeReady || !session_.focusedNode() || !tree.contains(*session_.focusedNode())) return nullptr;
        const auto& node = tree.node(*session_.focusedNode());
        if (node.generation != focusedGeneration_ || !arrange::core::nodeInteractionEnabled(tree, node.id)) return nullptr;
        const auto* instance = node.modifier.find(focusedModifier_);
        const auto* field = instance ? std::get_if<arrange::core::TextFieldModifier>(&instance->descriptor.value) : nullptr;
        return field && field->enabled ? &node : nullptr;
    }

    arrange::core::LayoutNode* TextInputOwner::activeInputNode(arrange::core::LayoutTree& tree, bool runtimeReady) {
        const auto* node = std::as_const(*this).activeInputNode(tree, runtimeReady);
        return node ? &tree.node(node->id) : nullptr;
    }

    void TextInputOwner::pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestResult& hit, float x, float y, const TextInputCallbacks& callbacks) {
        const auto* instance = hit.hit && tree.contains(hit.node) ? tree.node(hit.node).modifier.find(hit.modifier) : nullptr;
        const auto* field = instance ? std::get_if<arrange::core::TextFieldModifier>(&instance->descriptor.value) : nullptr;
        if (!field || !field->enabled || !arrange::core::nodeInteractionEnabled(tree, hit.node)) {
            finishFocusedInput(tree, false, callbacks);
            return;
        }
        const auto same = activeInputNode(tree, true) && session_.focusedNode() == hit.node && focusedModifier_ == hit.modifier;
        if (!same) {
            finishFocusedInput(tree, false, callbacks);
            session_.focusedNode() = hit.node;
            focusedGeneration_ = tree.node(hit.node).generation;
            focusedModifier_ = hit.modifier;
            publishedModelValue_ = field->value;
            session_.state().begin(field->value, field->selectAllOnFocus);
        }
        const auto point = arrange::core::rootToNodeContent(tree, hit.node, {x, y}, hit.modifier);
        const auto cursor = text_.textIndexAtPoint(*instance, session_.state().text(), session_.viewportX(), point.x, point.y);
        if (same || !field->selectAllOnFocus) session_.state().moveCursorTo(cursor);
        session_.dragAnchor() = cursor;
        updateFocusedInputViewport(tree, true);
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(hit.node, arrange::core::DirtyFlag::Paint, "文本输入焦点改变");
    }

    bool TextInputOwner::pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const TextInputCallbacks& callbacks) {
        if (!session_.dragAnchor()) return false;
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;

        const auto point = arrange::core::rootToNodeContent(tree, node->id, {x, y}, focusedModifier_);
        session_.state().selectRange(*session_.dragAnchor(), text_.textIndexAtPoint(inputInstance(*node), session_.state().text(), session_.viewportX(), point.x, point.y));
        updateFocusedInputViewport(tree, runtimeReady);
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint, "input selection/caret changed");
        return true;
    }

    bool TextInputOwner::isTextInputActive(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        return activeInputNode(tree, runtimeReady) != nullptr;
    }

    ::juce::Range<int> TextInputOwner::highlightedRegion(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        if (!isTextInputActive(tree, runtimeReady)) return {};
        const auto& text = session_.state().text();
        return {
            charIndexForByteIndex(text, std::min(session_.state().selectionStart(), session_.state().selectionEnd())),
            charIndexForByteIndex(text, std::max(session_.state().selectionStart(), session_.state().selectionEnd())),
        };
    }

    bool TextInputOwner::setHighlightedRegion(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range, const TextInputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;

        const auto anchor = byteIndexForCharIndex(session_.state().text(), range.getStart());
        const auto active = byteIndexForCharIndex(session_.state().text(), range.getEnd());
        session_.state().selectRange(anchor, active);
        if (callbacks.enqueueImeCompositionIntent) callbacks.enqueueImeCompositionIntent(node->id, "ime highlighted region changed");
        session_.temporaryUnderlines().clear();
        updateFocusedInputViewport(tree, runtimeReady);
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint, "input selection/caret changed");
        return true;
    }

    bool TextInputOwner::setTemporaryUnderlining(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Array<::juce::Range<int>>& ranges, const TextInputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;

        session_.temporaryUnderlines().clear();
        if (callbacks.enqueueImeCompositionIntent) callbacks.enqueueImeCompositionIntent(node->id, "ime temporary underlining changed");
        for (const auto& range : ranges) {
            if (!range.isEmpty()) session_.temporaryUnderlines().push_back(range);
        }
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint, "input selection/caret changed");
        return true;
    }

    ::juce::String TextInputOwner::textInRange(const arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range) const {
        if (!isTextInputActive(tree, runtimeReady)) return {};
        const auto& text = session_.state().text();
        const auto start = byteIndexForCharIndex(text, range.getStart());
        const auto end = byteIndexForCharIndex(text, range.getEnd());
        if (end <= start) return {};
        return ::juce::String::fromUTF8(text.data() + start, static_cast<int>(end - start));
    }

    bool TextInputOwner::insertTextAtCaret(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::String& textToInsert, const TextInputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;
        if (callbacks.enqueueTextInputIntent) callbacks.enqueueTextInputIntent(node->id, "text inserted at caret");
        return applyEdit(*node, session_.state().replaceSelectionWithText(normalizeInsertionText(*node, textToInsert.toStdString())), callbacks);
    }

    int TextInputOwner::caretPosition(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        if (!isTextInputActive(tree, runtimeReady)) return 0;
        return charIndexForByteIndex(session_.state().text(), session_.state().cursorIndex());
    }

    int TextInputOwner::totalNumChars(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        if (!isTextInputActive(tree, runtimeReady)) return 0;
        return totalUtf8Chars(session_.state().text());
    }

    int TextInputOwner::charIndexForPoint(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Point<int> point) const {
        const auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return 0;
        const auto local = arrange::core::rootToNodeContent(tree, node->id, {static_cast<float>(point.x), static_cast<float>(point.y)}, focusedModifier_);
        const auto byteIndex = text_.textIndexAtPoint(inputInstance(*node), session_.state().text(), session_.viewportX(), local.x, local.y);
        return charIndexForByteIndex(session_.state().text(), byteIndex);
    }

    ::juce::Rectangle<int> TextInputOwner::caretRectangleForCharIndex(const arrange::core::LayoutTree& tree, bool runtimeReady, int characterIndex) const {
        if (!isTextInputActive(tree, runtimeReady)) return {};
        const auto byteIndex = byteIndexForCharIndex(session_.state().text(), characterIndex);
        const auto rects = textBoundsForByteRange(tree, runtimeReady, byteIndex, byteIndex);
        if (!rects.isEmpty()) return rects.getBounds();
        return {};
    }

    ::juce::RectangleList<int> TextInputOwner::textBounds(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Range<int> range) const {
        if (!isTextInputActive(tree, runtimeReady)) return {};
        const auto& text = session_.state().text();
        return textBoundsForByteRange(tree, runtimeReady, byteIndexForCharIndex(text, range.getStart()), byteIndexForCharIndex(text, range.getEnd()));
    }

    bool TextInputOwner::keyPressed(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::KeyPress& key, const TextInputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;
        if (callbacks.enqueueKeyIntent) callbacks.enqueueKeyIntent(node->id, "text input key pressed");

        arrange::core::InputEditResult edit;
        const auto textCharacter = key.getTextCharacter();
        const auto commandDown = key.getModifiers().isCommandDown();
        const auto shiftDown = key.getModifiers().isShiftDown();
        if (commandDown && (textCharacter == 'a' || textCharacter == 'A')) {
            edit = session_.state().selectAll();
        } else if (commandDown && (textCharacter == 'c' || textCharacter == 'C')) {
            const auto selected = session_.state().selectedText();
            if (selected.empty()) return false;
            ::juce::SystemClipboard::copyTextToClipboard(selected);
            if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint, "input selection/caret changed");
            return true;
        } else if (commandDown && (textCharacter == 'x' || textCharacter == 'X')) {
            const auto selected = session_.state().selectedText();
            if (!selected.empty()) ::juce::SystemClipboard::copyTextToClipboard(selected);
            edit = session_.state().cutSelection();
        } else if (commandDown && (textCharacter == 'v' || textCharacter == 'V')) {
            edit = session_.state().replaceSelectionWithText(normalizeInsertionText(*node, ::juce::SystemClipboard::getTextFromClipboard().toStdString()));
        } else if (commandDown && (textCharacter == 'z' || textCharacter == 'Z')) {
            edit = shiftDown ? session_.state().redo() : session_.state().undo();
        } else if (commandDown && (textCharacter == 'y' || textCharacter == 'Y')) {
            edit = session_.state().redo();
        } else if (key == ::juce::KeyPress::backspaceKey) {
            edit = session_.state().backspace();
        } else if (key == ::juce::KeyPress::deleteKey) {
            edit = session_.state().deleteForward();
        } else if (key == ::juce::KeyPress::leftKey) {
            edit = shiftDown ? session_.state().extendSelectionLeft() : session_.state().moveLeft();
        } else if (key == ::juce::KeyPress::rightKey) {
            edit = shiftDown ? session_.state().extendSelectionRight() : session_.state().moveRight();
        } else if (key == ::juce::KeyPress::homeKey) {
            edit = shiftDown ? session_.state().extendSelectionHome() : session_.state().moveHome();
        } else if (key == ::juce::KeyPress::endKey) {
            edit = shiftDown ? session_.state().extendSelectionEnd() : session_.state().moveEnd();
        } else if (key == ::juce::KeyPress::returnKey) {
            edit = TextInputLayoutModel::allowsLineBreak(inputInstance(*node)) && !commandDown ? session_.state().insertLineBreak() : session_.state().submit();
        } else {
            edit = session_.state().insertCodepoint(static_cast<char32_t>(textCharacter));
        }

        return applyEdit(*node, edit, callbacks);
    }

    void TextInputOwner::finishFocusedInput(arrange::core::LayoutTree& tree, bool submit, const TextInputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, true);
        if (node != nullptr) {
            if (submit && callbacks.invokeStringEvent) {
                callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(*node).descriptor.value, arrange::core::EventSlotKind::InputSubmit), session_.state().text());
            }
            if (session_.state().changedSinceBegin() && callbacks.invokeStringEvent) {
                callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(*node).descriptor.value, arrange::core::EventSlotKind::InputChange), session_.state().text());
            }
            if (callbacks.invokeStringEvent) {
                callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(*node).descriptor.value, arrange::core::EventSlotKind::InputBlur), session_.state().text());
            }
            if (callbacks.invalidateNativeState) {
                callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint, "input focus cleared");
            }
        }
        session_.reset();
        focusedGeneration_ = 0;
        focusedModifier_ = {};
        publishedModelValue_.clear();
    }

    void TextInputOwner::synchronizePublishedInput(const arrange::core::LayoutTree& tree, bool runtimeReady) {
        const auto* node = activeInputNode(tree, runtimeReady);
        if (!node) {
            reset();
            return;
        }
        const auto value = std::get<arrange::core::TextFieldModifier>(inputInstance(*node).descriptor.value).value;
        if (value == publishedModelValue_) return;
        publishedModelValue_ = value;
        // 编辑回执保留光标、选区和撤销记录，外部替换重新对齐 UTF-8 边界
        if (value != session_.state().text()) {
            session_.state().replaceExternal(value);
            session_.temporaryUnderlines().clear();
            session_.dragAnchor().reset();
        }
    }

    void TextInputOwner::updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady) {
        const auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) {
            reset();
            return;
        }
        session_.viewportX() = text_.updatedViewportX(inputInstance(*node), session_.state().text(), session_.state().cursorIndex(), session_.viewportX());
    }

    std::vector<arrange::core::DrawOp> TextInputOwner::buildFocusedInputOps(const arrange::core::LayoutTree& tree, bool runtimeReady) const {
        const auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return {};
        arrange::core::TextInputOverlayState state;
        state.text = session_.state().text();
        state.cursorIndex = session_.state().cursorIndex();
        state.selectionStart = session_.state().selectionStart();
        state.selectionEnd = session_.state().selectionEnd();
        state.viewportX = session_.viewportX();
        for (const auto& range : session_.temporaryUnderlines()) {
            state.temporaryUnderlines.push_back({
                byteIndexForCharIndex(state.text, range.getStart()),
                byteIndexForCharIndex(state.text, range.getEnd()),
            });
        }
        return arrange::core::DrawOpsBuilder{}.collectOverlay(tree, node->id, arrange::core::TextInputOverlayBuilder{}.build(node->id, inputInstance(*node), state, text_.textLayoutService()), focusedModifier_);
    }

    ::juce::RectangleList<int> TextInputOwner::textBoundsForByteRange(const arrange::core::LayoutTree& tree, bool runtimeReady, std::size_t start, std::size_t end) const {
        const auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return {};
        const auto& text = session_.state().text();
        const auto localBounds = text_.textBoundsForByteRange(text_.layout(inputInstance(*node), text, session_.viewportX()), text, start, end);
        ::juce::RectangleList<int> bounds;
        for (const auto local : localBounds) {
            const auto root = arrange::core::nodeContentRectToRoot(tree, node->id, {static_cast<float>(local.getX()), static_cast<float>(local.getY()), static_cast<float>(local.getWidth()), static_cast<float>(local.getHeight())}, focusedModifier_);
            bounds.add(::juce::Rectangle<float>(root.x, root.y, root.width, root.height).getSmallestIntegerContainer());
        }
        return bounds;
    }

    std::string TextInputOwner::normalizeInsertionText(const arrange::core::LayoutNode& node, std::string text) const {
        if (TextInputLayoutModel::allowsLineBreak(inputInstance(node))) return text;
        for (auto& ch : text) {
            if (ch == '\r' || ch == '\n') ch = ' ';
        }
        return text;
    }

    bool TextInputOwner::applyEdit(arrange::core::LayoutNode& node, const arrange::core::InputEditResult& edit, const TextInputCallbacks& callbacks) {
        if (!edit.consumed) return false;
        session_.temporaryUnderlines().clear();
        session_.viewportX() = text_.updatedViewportX(inputInstance(node), session_.state().text(), session_.state().cursorIndex(), session_.viewportX());
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node.id, arrange::core::DirtyFlag::Paint, "input edit changed");

        if (edit.submitRequested) {
            if (callbacks.invokeStringEvent) {
                callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(node).descriptor.value, arrange::core::EventSlotKind::InputSubmit), session_.state().text());
            }
            return true;
        }

        if (edit.textChanged) {
            if (callbacks.invokeStringEvent) {
                callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(node).descriptor.value, arrange::core::EventSlotKind::InputUpdate), session_.state().text());
            }
        }
        return true;
    }
}  // namespace arrange::juce

#endif
