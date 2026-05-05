#include <arrange/core/InputEditing.h>

#include <algorithm>
#include <string>

namespace arrange::core {
    namespace {
        constexpr std::size_t maxUndoStackDepth = 128;

        std::string encodeUtf8(char32_t codepoint) {
            if (codepoint <= 0x7fu) { return std::string(1, static_cast<char>(codepoint)); }
            if (codepoint <= 0x7ffu) {
                return {
                    static_cast<char>(0xc0u | ((codepoint >> 6u) & 0x1fu)),
                    static_cast<char>(0x80u | (codepoint & 0x3fu)),
                };
            }
            if (codepoint <= 0xffffu) {
                return {
                    static_cast<char>(0xe0u | ((codepoint >> 12u) & 0x0fu)),
                    static_cast<char>(0x80u | ((codepoint >> 6u) & 0x3fu)),
                    static_cast<char>(0x80u | (codepoint & 0x3fu)),
                };
            }
            return {
                static_cast<char>(0xf0u | ((codepoint >> 18u) & 0x07u)),
                static_cast<char>(0x80u | ((codepoint >> 12u) & 0x3fu)),
                static_cast<char>(0x80u | ((codepoint >> 6u) & 0x3fu)),
                static_cast<char>(0x80u | (codepoint & 0x3fu)),
            };
        }

        bool isSupportedScalar(char32_t codepoint) {
            if (codepoint < 32u || codepoint == 127u) return false;
            if (codepoint > 0x10ffffu) return false;
            return !(codepoint >= 0xd800u && codepoint <= 0xdfffu);
        }

        bool isUtf8Continuation(unsigned char ch) { return (ch & 0xc0u) == 0x80u; }

        std::size_t previousUtf8Boundary(const std::string& text, std::size_t cursor) {
            if (cursor == 0 || text.empty()) return 0;
            auto pos = std::min(cursor - 1, text.size() - 1);
            while (pos > 0 && isUtf8Continuation(static_cast<unsigned char>(text[pos]))) --pos;
            return pos;
        }

        std::size_t nextUtf8Boundary(const std::string& text, std::size_t cursor) {
            if (cursor >= text.size()) return text.size();
            auto pos = cursor + 1;
            while (pos < text.size() && isUtf8Continuation(static_cast<unsigned char>(text[pos]))) ++pos;
            return pos;
        }
    } // namespace

    void TextInputState::begin(std::string value, bool selectAll) {
        text_ = std::move(value);
        committedText_ = text_;
        cursorIndex_ = text_.size();
        undoStack_.clear();
        redoStack_.clear();
        clearSelection();
        if (selectAll && !text_.empty()) {
            selectionStart_ = 0;
            selectionEnd_ = text_.size();
            cursorIndex_ = selectionEnd_;
        }
    }

    void TextInputState::reset() {
        text_.clear();
        committedText_.clear();
        cursorIndex_ = 0;
        undoStack_.clear();
        redoStack_.clear();
        clearSelection();
    }

    InputEditResult TextInputState::insertCodepoint(char32_t codepoint) {
        if (!isSupportedScalar(codepoint)) return {};
        recordUndoPoint();
        (void)deleteSelection();
        const auto text = encodeUtf8(codepoint);
        text_.insert(cursorIndex_, text);
        cursorIndex_ += text.size();
        clearSelection();
        return {true, true, false};
    }

    InputEditResult TextInputState::insertLineBreak() {
        recordUndoPoint();
        (void)deleteSelection();
        text_.insert(cursorIndex_, "\n");
        ++cursorIndex_;
        clearSelection();
        return {true, true, false};
    }

    InputEditResult TextInputState::backspace() {
        if (hasSelection()) {
            recordUndoPoint();
            (void)deleteSelection();
            return {true, true, false};
        }
        if (cursorIndex_ == 0 || text_.empty()) return {};
        recordUndoPoint();
        const auto start = previousUtf8Boundary(text_, cursorIndex_);
        text_.erase(start, cursorIndex_ - start);
        cursorIndex_ = start;
        clearSelection();
        return {true, true, false};
    }

    InputEditResult TextInputState::deleteForward() {
        if (hasSelection()) {
            recordUndoPoint();
            (void)deleteSelection();
            return {true, true, false};
        }
        if (cursorIndex_ >= text_.size()) return {};
        recordUndoPoint();
        const auto end = nextUtf8Boundary(text_, cursorIndex_);
        text_.erase(cursorIndex_, end - cursorIndex_);
        clearSelection();
        return {true, true, false};
    }

    InputEditResult TextInputState::moveLeft() {
        cursorIndex_ = previousUtf8Boundary(text_, cursorIndex_);
        clearSelection();
        return {true, false, false};
    }

    InputEditResult TextInputState::moveRight() {
        cursorIndex_ = nextUtf8Boundary(text_, cursorIndex_);
        clearSelection();
        return {true, false, false};
    }

    InputEditResult TextInputState::moveHome() {
        auto start = cursorIndex_;
        while (start > 0 && text_[start - 1] != '\n') --start;
        cursorIndex_ = start;
        clearSelection();
        return {true, false, false};
    }

    InputEditResult TextInputState::moveEnd() {
        auto end = cursorIndex_;
        while (end < text_.size() && text_[end] != '\n') ++end;
        cursorIndex_ = end;
        clearSelection();
        return {true, false, false};
    }

    InputEditResult TextInputState::extendSelectionLeft() {
        const auto anchor = hasSelection() ? selectionStart_ : cursorIndex_;
        const auto active = previousUtf8Boundary(text_, cursorIndex_);
        return selectRange(anchor, active);
    }

    InputEditResult TextInputState::extendSelectionRight() {
        const auto anchor = hasSelection() ? selectionStart_ : cursorIndex_;
        const auto active = nextUtf8Boundary(text_, cursorIndex_);
        return selectRange(anchor, active);
    }

    InputEditResult TextInputState::extendSelectionHome() {
        const auto anchor = hasSelection() ? selectionStart_ : cursorIndex_;
        auto active = cursorIndex_;
        while (active > 0 && text_[active - 1] != '\n') --active;
        return selectRange(anchor, active);
    }

    InputEditResult TextInputState::extendSelectionEnd() {
        const auto anchor = hasSelection() ? selectionStart_ : cursorIndex_;
        auto active = cursorIndex_;
        while (active < text_.size() && text_[active] != '\n') ++active;
        return selectRange(anchor, active);
    }

    InputEditResult TextInputState::moveCursorTo(std::size_t index) {
        cursorIndex_ = clampToBoundary(index);
        clearSelection();
        return {true, false, false};
    }

    InputEditResult TextInputState::selectAll() {
        selectionStart_ = 0;
        selectionEnd_ = text_.size();
        cursorIndex_ = selectionEnd_;
        return {true, false, false};
    }

    InputEditResult TextInputState::selectRange(std::size_t anchor, std::size_t active) {
        selectionStart_ = clampToBoundary(anchor);
        selectionEnd_ = clampToBoundary(active);
        cursorIndex_ = selectionEnd_;
        return {true, false, false};
    }

    std::string TextInputState::selectedText() const {
        if (!hasSelection()) return {};
        const auto start = std::min(selectionStart_, selectionEnd_);
        const auto end = std::max(selectionStart_, selectionEnd_);
        return text_.substr(start, end - start);
    }

    InputEditResult TextInputState::cutSelection() {
        if (!hasSelection()) return {};
        recordUndoPoint();
        (void)deleteSelection();
        return {true, true, false};
    }

    InputEditResult TextInputState::replaceSelectionWithText(std::string text) {
        if (text.empty() && !hasSelection()) return {};
        recordUndoPoint();
        (void)deleteSelection();
        text_.insert(cursorIndex_, text);
        cursorIndex_ += text.size();
        clearSelection();
        return {true, true, false};
    }

    InputEditResult TextInputState::undo() {
        if (undoStack_.empty()) return {};
        redoStack_.push_back(snapshot());
        const auto previous = undoStack_.back();
        undoStack_.pop_back();
        restoreSnapshot(previous);
        return {true, true, false};
    }

    InputEditResult TextInputState::redo() {
        if (redoStack_.empty()) return {};
        undoStack_.push_back(snapshot());
        const auto next = redoStack_.back();
        redoStack_.pop_back();
        restoreSnapshot(next);
        return {true, true, false};
    }

    InputEditResult TextInputState::submit() const noexcept { return {true, false, true}; }

    TextInputState::Snapshot TextInputState::snapshot() const { return {text_, cursorIndex_, selectionStart_, selectionEnd_}; }

    void TextInputState::restoreSnapshot(const Snapshot& snapshot) {
        text_ = snapshot.text;
        cursorIndex_ = std::min(snapshot.cursorIndex, text_.size());
        selectionStart_ = std::min(snapshot.selectionStart, text_.size());
        selectionEnd_ = std::min(snapshot.selectionEnd, text_.size());
    }

    void TextInputState::recordUndoPoint() {
        const auto current = snapshot();
        if (!undoStack_.empty() && sameSnapshot(undoStack_.back(), current)) {
            redoStack_.clear();
            return;
        }
        undoStack_.push_back(current);
        if (undoStack_.size() > maxUndoStackDepth) undoStack_.erase(undoStack_.begin());
        redoStack_.clear();
    }

    bool TextInputState::sameSnapshot(const Snapshot& left, const Snapshot& right) {
        return left.text == right.text &&
            left.cursorIndex == right.cursorIndex &&
            left.selectionStart == right.selectionStart &&
            left.selectionEnd == right.selectionEnd;
    }

    std::size_t TextInputState::clampToBoundary(std::size_t index) const {
        if (index >= text_.size()) return text_.size();
        while (index > 0 && isUtf8Continuation(static_cast<unsigned char>(text_[index]))) --index;
        return index;
    }

    void TextInputState::clearSelection() {
        selectionStart_ = cursorIndex_;
        selectionEnd_ = cursorIndex_;
    }

    bool TextInputState::deleteSelection() {
        if (!hasSelection()) return false;
        const auto start = std::min(selectionStart_, selectionEnd_);
        const auto end = std::max(selectionStart_, selectionEnd_);
        text_.erase(start, end - start);
        cursorIndex_ = start;
        clearSelection();
        return true;
    }
} // namespace arrange::core
