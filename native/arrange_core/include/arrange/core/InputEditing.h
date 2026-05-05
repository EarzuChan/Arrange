#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace arrange::core {
    struct InputEditResult {
        bool consumed = false;
        bool textChanged = false;
        bool submitRequested = false;
    };

    class TextInputState {
    public:
        void begin(std::string value, bool selectAll);
        void reset();

        [[nodiscard]] const std::string& text() const noexcept { return text_; }
        [[nodiscard]] const std::string& committedText() const noexcept { return committedText_; }
        [[nodiscard]] std::size_t cursorIndex() const noexcept { return cursorIndex_; }
        [[nodiscard]] std::size_t selectionStart() const noexcept { return selectionStart_; }
        [[nodiscard]] std::size_t selectionEnd() const noexcept { return selectionEnd_; }
        [[nodiscard]] bool hasSelection() const noexcept { return selectionStart_ != selectionEnd_; }
        [[nodiscard]] bool changedSinceBegin() const noexcept { return text_ != committedText_; }

        InputEditResult insertCodepoint(char32_t codepoint);
        InputEditResult insertLineBreak();
        InputEditResult backspace();
        InputEditResult deleteForward();
        InputEditResult moveLeft();
        InputEditResult moveRight();
        InputEditResult moveHome();
        InputEditResult moveEnd();
        InputEditResult extendSelectionLeft();
        InputEditResult extendSelectionRight();
        InputEditResult extendSelectionHome();
        InputEditResult extendSelectionEnd();
        InputEditResult moveCursorTo(std::size_t index);
        InputEditResult selectAll();
        InputEditResult selectRange(std::size_t anchor, std::size_t active);
        [[nodiscard]] std::string selectedText() const;
        InputEditResult cutSelection();
        InputEditResult replaceSelectionWithText(std::string text);
        InputEditResult undo();
        InputEditResult redo();
        InputEditResult submit() const noexcept;

    private:
        struct Snapshot {
            std::string text;
            std::size_t cursorIndex = 0;
            std::size_t selectionStart = 0;
            std::size_t selectionEnd = 0;
        };

        [[nodiscard]] Snapshot snapshot() const;
        void restoreSnapshot(const Snapshot& snapshot);
        void recordUndoPoint();
        static bool sameSnapshot(const Snapshot& left, const Snapshot& right);
        [[nodiscard]] std::size_t clampToBoundary(std::size_t index) const;
        void clearSelection();
        bool deleteSelection();

        std::string text_;
        std::string committedText_;
        std::size_t cursorIndex_ = 0;
        std::size_t selectionStart_ = 0;
        std::size_t selectionEnd_ = 0;
        std::vector<Snapshot> undoStack_;
        std::vector<Snapshot> redoStack_;
    };
} // namespace arrange::core
