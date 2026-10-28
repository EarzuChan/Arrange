#include <arrange/juce/TextInputOwner.h>

#include <string_view>

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

    void TextInputOwner::focus(const arrange::core::LayoutTree& tree, arrange::core::NodeId id, arrange::core::ModifierHandle receiver, const arrange::core::InputCallbacks& callbacks) {
        if (activeInputNode(tree, true) && session_.focusedNode() == id && focusedModifier_ == receiver) return;
        finishFocusedInput(tree, false, callbacks);
        if (!tree.contains(id) || !arrange::core::nodeInteractionEnabled(tree, id)) return;
        const auto* instance = tree.node(id).modifier.find(receiver);
        const auto* field = instance ? std::get_if<arrange::core::TextFieldModifier>(&instance->descriptor.value) : nullptr;
        if (!field || !field->enabled) return;
        session_.focusedNode() = id;
        focusedGeneration_ = tree.node(id).generation;
        focusedModifier_ = receiver;
        publishedModelValue_ = field->value;
        session_.state().begin(field->value, field->selectAllOnFocus);
        updateFocusedInputViewport(tree, true);
    }

    void TextInputOwner::dispatchPendingTextEdits(const arrange::core::LayoutTree& tree, const arrange::core::InputCallbacks& callbacks) {
        const auto* node = activeInputNode(tree, true);
        if (!node || session_.state().composing()) return;
        session_.state().finishPlatformEdit();
        if (!session_.pendingPlatformEdit()) return;
        session_.pendingPlatformEdit() = false;
        if (callbacks.invokeStringEvent) callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(*node).descriptor.value, arrange::core::EventSlotKind::InputUpdate), session_.state().text());
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
        return node ? &tree.mutableNode(node->id) : nullptr;
    }

    void TextInputOwner::pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestResult& hit, float x, float y, const arrange::core::InputCallbacks& callbacks, arrange::core::PointerDownOptions options) {
        session_.preferredX().reset();
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
        using Granularity = arrange::core::TextSelectionGranularity;
        const auto granularity = options.clickCount > 3 ? Granularity::All : options.clickCount == 3 ? Granularity::VisualLine : options.clickCount == 2 ? Granularity::Word : Granularity::Character;
        const auto range = text_.selectionAtPoint(*instance, session_.state().text(), session_.viewportX(), point, session_.viewportY(), granularity);
        const auto anchor = session_.state().hasSelection() ? session_.state().selectionStart() : session_.state().cursorIndex();
        if (options.extendSelection && same && granularity != Granularity::All) {
            session_.state().selectRange(anchor, range.end <= anchor ? range.start : range.end);
            session_.dragAnchor() = TextDragSelection{{anchor, anchor}, granularity};
        } else if (granularity != Granularity::Character) {
            session_.state().selectRange(range.start, range.end);
            session_.dragAnchor() = TextDragSelection{range, granularity};
        } else {
            if (same || !field->selectAllOnFocus) session_.state().moveCursorTo(range.start);
            session_.dragAnchor() = TextDragSelection{range, granularity};
        }
        updateFocusedInputViewport(tree, true);
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(hit.node, arrange::core::DirtyFlag::Paint);
    }

    bool TextInputOwner::pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const arrange::core::InputCallbacks& callbacks) {
        if (!session_.dragAnchor()) return false;
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;

        const auto point = arrange::core::rootToNodeContent(tree, node->id, {x, y}, focusedModifier_);
        const auto anchor = *session_.dragAnchor();
        const auto range = text_.selectionAtPoint(inputInstance(*node), session_.state().text(), session_.viewportX(), point, session_.viewportY(), anchor.granularity);
        if (range.end <= anchor.range.start)
            session_.state().selectRange(anchor.range.end, range.start);
        else if (range.start >= anchor.range.end)
            session_.state().selectRange(anchor.range.start, range.end);
        else
            session_.state().selectRange(anchor.range.start, anchor.range.end);
        updateFocusedInputViewport(tree, runtimeReady);
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint);
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

    bool TextInputOwner::setHighlightedRegion(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range, const arrange::core::InputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;

        const auto anchor = byteIndexForCharIndex(session_.state().text(), range.getStart());
        const auto active = byteIndexForCharIndex(session_.state().text(), range.getEnd());
        session_.state().selectRange(anchor, active);
        if (callbacks.enqueueImeCompositionIntent) callbacks.enqueueImeCompositionIntent(node->id);
        updateFocusedInputViewport(tree, runtimeReady);
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint);
        return true;
    }

    bool TextInputOwner::setTemporaryUnderlining(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Array<::juce::Range<int>>& ranges, const arrange::core::InputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;

        session_.temporaryUnderlines().clear();
        if (callbacks.enqueueImeCompositionIntent) callbacks.enqueueImeCompositionIntent(node->id);
        for (const auto& range : ranges) {
            if (!range.isEmpty()) session_.temporaryUnderlines().push_back(range);
        }
        if (!session_.temporaryUnderlines().empty()) {
            session_.state().beginCompositionFromLastEdit();
            session_.pendingPlatformEdit() = false;
        } else if (session_.state().composing()) {
            if (session_.compositionCancelled()) {
                (void)session_.state().cancelComposition();
                session_.pendingPlatformEdit() = false;
            } else {
                const auto edit = session_.state().commitComposition();
                session_.pendingPlatformEdit() = edit.textChanged;
            }
            session_.compositionCancelled() = false;
            dispatchPendingTextEdits(tree, callbacks);
        } else {
            dispatchPendingTextEdits(tree, callbacks);
        }
        updateFocusedInputViewport(tree, runtimeReady);
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint);
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

    bool TextInputOwner::insertTextAtCaret(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::String& textToInsert, const arrange::core::InputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;
        if (callbacks.enqueueTextInputIntent) callbacks.enqueueTextInputIntent(node->id);
        session_.state().setEditTime(::juce::Time::getMillisecondCounterHiRes());
        session_.compositionCancelled() = session_.state().composing() && textToInsert.isEmpty();
        // JUCE/Windows 在 composition start 用空插入清理选区；先保存事务基线。
        if (textToInsert.isEmpty() && !session_.state().composing())
            session_.state().beginComposition();
        else
            session_.state().beginPlatformEdit();
        auto insertion = normalizeInsertionText(*node, textToInsert.toStdString());
        const auto typing = !session_.state().composing() && textToInsert.length() == 1 && insertion != "\n";
        const auto edit = session_.state().replaceSelectionWithText(std::move(insertion), typing);
        session_.pendingPlatformEdit() = session_.pendingPlatformEdit() || edit.textChanged;
        auto deferred = callbacks;
        deferred.invokeStringEvent = {};
        return applyEdit(*node, edit, deferred);
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
        const auto byteIndex = text_.textIndexAtPoint(inputInstance(*node), session_.state().text(), session_.viewportX(), local.x, local.y, session_.viewportY());
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

    bool TextInputOwner::keyPressed(arrange::core::LayoutTree& tree, bool runtimeReady, const arrange::core::KeyInput& key, const arrange::core::InputCallbacks& callbacks) {
        auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return false;
        dispatchPendingTextEdits(tree, callbacks);
        session_.state().setEditTime(::juce::Time::getMillisecondCounterHiRes());
        const auto is = [&](std::string_view name) {
            return key.key == name;
        };
        if (!is("ArrowUp") && !is("ArrowDown") && !is("PageUp") && !is("PageDown")) session_.preferredX().reset();
        if (callbacks.enqueueKeyIntent) callbacks.enqueueKeyIntent(node->id);

        arrange::core::InputEditResult edit;
        const auto commandDown = key.modifiers.command;
        const auto shiftDown = key.modifiers.shift;
        const auto shortcut = [&](char letter) {
            const auto upper = static_cast<char>(letter - 'a' + 'A');
            return key.key.size() == 1 && (key.key[0] == letter || key.key[0] == upper);
        };
        if (session_.state().composing() && (is("Escape") || commandDown && shortcut('z'))) {
            (void)session_.state().cancelComposition();
            session_.pendingPlatformEdit() = false;
            session_.temporaryUnderlines().clear();
            session_.compositionCancelled() = false;
            edit = {true, false, false};
        } else if (commandDown && shortcut('a')) {
            edit = session_.state().selectAll();
        } else if (commandDown && shortcut('c')) {
            const auto selected = session_.state().selectedText();
            if (selected.empty()) return false;
            if (callbacks.writeClipboard)
                callbacks.writeClipboard(selected);
            else
                ::juce::SystemClipboard::copyTextToClipboard(selected);
            if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint);
            return true;
        } else if (commandDown && shortcut('x')) {
            const auto selected = session_.state().selectedText();
            if (!selected.empty()) {
                if (callbacks.writeClipboard)
                    callbacks.writeClipboard(selected);
                else
                    ::juce::SystemClipboard::copyTextToClipboard(selected);
            }
            edit = session_.state().cutSelection();
        } else if (commandDown && shortcut('v')) {
            edit = session_.state().replaceSelectionWithText(normalizeInsertionText(*node, callbacks.readClipboard ? callbacks.readClipboard() : ::juce::SystemClipboard::getTextFromClipboard().toStdString()));
        } else if (commandDown && shortcut('z')) {
            edit = shiftDown ? session_.state().redo() : session_.state().undo();
        } else if (commandDown && shortcut('y')) {
            edit = session_.state().redo();
        } else if (is("Backspace")) {
            edit = session_.state().backspace();
        } else if (is("Delete")) {
            edit = session_.state().deleteForward();
        } else if (is("ArrowUp") || is("ArrowDown") || TextInputLayoutModel::allowsLineBreak(inputInstance(*node)) && (is("PageUp") || is("PageDown"))) {
            const auto prepared = text_.layout(inputInstance(*node), session_.state().text(), session_.viewportX(), session_.viewportY());
            const auto caret = text_.textLayoutService().caretRect(*prepared.text, session_.state().cursorIndex());
            if (!session_.preferredX()) session_.preferredX() = caret.x;
            const auto line = is("ArrowUp") || is("PageUp") ? -1 : 1;
            const auto page = is("PageUp") || is("PageDown");
            const auto distance = page ? std::max(caret.height, inputInstance(*node).bounds.height) : caret.height;
            const auto index = text_.textLayoutService().byteIndexAtPoint(*prepared.text, {*session_.preferredX(), caret.y + caret.height * 0.5f + distance * line});
            edit = session_.state().moveTo(index, shiftDown);
        } else if (is("ArrowLeft")) {
            edit = shiftDown ? session_.state().extendSelectionLeft() : session_.state().moveLeft();
        } else if (is("ArrowRight")) {
            edit = shiftDown ? session_.state().extendSelectionRight() : session_.state().moveRight();
        } else if (is("Home") || is("End")) {
            const auto end = is("End");
            const auto prepared = text_.layout(inputInstance(*node), session_.state().text(), session_.viewportX(), session_.viewportY());
            const auto caret = text_.textLayoutService().caretRect(*prepared.text, session_.state().cursorIndex());
            const auto index = commandDown ? (end ? session_.state().text().size() : 0) : text_.textLayoutService().byteIndexAtPoint(*prepared.text, {end ? 1e9f : -1e9f, caret.y + caret.height * 0.5f});
            edit = session_.state().moveTo(index, shiftDown);
        } else if (is("Enter")) {
            edit = TextInputLayoutModel::allowsLineBreak(inputInstance(*node)) && !commandDown ? session_.state().insertLineBreak() : session_.state().submit();
        } else {
            if (key.text.empty()) return false;
            edit = session_.state().insertCodepoint(static_cast<char32_t>(::juce::String::fromUTF8(key.text.c_str())[0]));
        }

        return applyEdit(*node, edit, callbacks);
    }

    void TextInputOwner::finishFocusedInput(const arrange::core::LayoutTree& tree, bool submit, const arrange::core::InputCallbacks& callbacks) {
        if (session_.state().composing()) {
            (void)session_.state().cancelComposition();
            session_.pendingPlatformEdit() = false;
        }
        dispatchPendingTextEdits(tree, callbacks);
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
                callbacks.invalidateNativeState(node->id, arrange::core::DirtyFlag::Paint);
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
            session_.pendingPlatformEdit() = false;
            session_.preferredX().reset();
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
        session_.viewportY() = text_.updatedViewportY(inputInstance(*node), session_.state().text(), session_.state().cursorIndex(), session_.viewportY());
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
        state.viewportY = session_.viewportY();
        for (const auto& range : session_.temporaryUnderlines()) {
            state.temporaryUnderlines.push_back({
                byteIndexForCharIndex(state.text, range.getStart()),
                byteIndexForCharIndex(state.text, range.getEnd()),
            });
        }
        auto receiver = inputInstance(*node);
        receiver.bounds.x = 0;
        receiver.bounds.y = 0;
        return arrange::core::TextInputOverlayBuilder{}.build(node->id, receiver, state, text_.textLayoutService());
    }

    ::juce::RectangleList<int> TextInputOwner::textBoundsForByteRange(const arrange::core::LayoutTree& tree, bool runtimeReady, std::size_t start, std::size_t end) const {
        const auto* node = activeInputNode(tree, runtimeReady);
        if (node == nullptr) return {};
        const auto& text = session_.state().text();
        const auto localBounds = text_.textBoundsForByteRange(text_.layout(inputInstance(*node), text, session_.viewportX(), session_.viewportY()), text, start, end);
        ::juce::RectangleList<int> bounds;
        for (const auto local : localBounds) {
            const auto root = arrange::core::nodeContentRectToRoot(tree, node->id, {static_cast<float>(local.getX()), static_cast<float>(local.getY()), static_cast<float>(local.getWidth()), static_cast<float>(local.getHeight())}, focusedModifier_);
            bounds.add(::juce::Rectangle<float>(root.x, root.y, root.width, root.height).getSmallestIntegerContainer());
        }
        return bounds;
    }

    std::string TextInputOwner::normalizeInsertionText(const arrange::core::LayoutNode& node, std::string text) const {
        std::string normalized;
        const auto multiline = TextInputLayoutModel::allowsLineBreak(inputInstance(node));
        for (std::size_t i = 0; i < text.size(); ++i) {
            auto ch = text[i];
            if (ch == '\r') {
                if (i + 1 < text.size() && text[i + 1] == '\n') ++i;
                ch = '\n';
            }
            normalized += !multiline && ch == '\n' ? ' ' : ch;
        }
        return normalized;
    }

    bool TextInputOwner::applyEdit(arrange::core::LayoutNode& node, const arrange::core::InputEditResult& edit, const arrange::core::InputCallbacks& callbacks) {
        if (!edit.consumed) return false;
        if (!session_.state().composing()) session_.temporaryUnderlines().clear();
        session_.viewportX() = text_.updatedViewportX(inputInstance(node), session_.state().text(), session_.state().cursorIndex(), session_.viewportX());
        session_.viewportY() = text_.updatedViewportY(inputInstance(node), session_.state().text(), session_.state().cursorIndex(), session_.viewportY());
        if (callbacks.invalidateNativeState) callbacks.invalidateNativeState(node.id, arrange::core::DirtyFlag::Paint);

        if (edit.submitRequested) {
            if (callbacks.invokeStringEvent) {
                callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(node).descriptor.value, arrange::core::EventSlotKind::InputSubmit), session_.state().text());
            }
            return true;
        }

        if (edit.textChanged && !session_.state().composing()) {
            if (callbacks.invokeStringEvent) {
                callbacks.invokeStringEvent(arrange::core::modifierEventSlot(inputInstance(node).descriptor.value, arrange::core::EventSlotKind::InputUpdate), session_.state().text());
            }
        }
        return true;
    }
}

#endif
