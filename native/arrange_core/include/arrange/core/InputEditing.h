#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <optional>
#include <vector>

namespace arrange::core {
    enum class TextSelectionGranularity { Character, Word, VisualLine, All };

    struct TextSelectionRange {
        std::size_t start = 0;
        std::size_t end = 0;
    };

    struct InputEditResult {
        bool consumed = false;
        bool textChanged = false;
        bool submitRequested = false;
    };

    class TextInputState {
       public:
        void begin(std::string value, bool selectAll);
        void reset();
        void replaceExternal(std::string value);

        void setEditTime(double timeMillis) noexcept {
            editTime_ = timeMillis;
        }

        void breakUndoGroup() noexcept;
        void beginPlatformEdit();
        void finishPlatformEdit() noexcept;
        void beginComposition();
        void beginCompositionFromLastEdit();

        [[nodiscard]] bool composing() const noexcept {
            return composition_.has_value();
        }

        InputEditResult commitComposition();
        InputEditResult cancelComposition();
        InputEditResult moveTo(std::size_t index, bool extend);

        [[nodiscard]] const std::string& text() const noexcept {
            return text_;
        }

        [[nodiscard]] const std::string& committedText() const noexcept {
            return committedText_;
        }

        [[nodiscard]] std::size_t cursorIndex() const noexcept {
            return cursorIndex_;
        }

        [[nodiscard]] std::size_t selectionStart() const noexcept {
            return selectionStart_;
        }

        [[nodiscard]] std::size_t selectionEnd() const noexcept {
            return selectionEnd_;
        }

        [[nodiscard]] bool hasSelection() const noexcept {
            return selectionStart_ != selectionEnd_;
        }

        [[nodiscard]] bool changedSinceBegin() const noexcept {
            return text_ != committedText_;
        }

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
        InputEditResult replaceSelectionWithText(std::string text, bool typing = false);
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
        enum class EditKind { Atomic, Typing, Backward, Forward };
        void recordUndoPoint(EditKind kind = EditKind::Atomic);
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
        std::optional<Snapshot> composition_;
        std::optional<Snapshot> lastEditBefore_;

        struct PlatformEdit {
            Snapshot before;
            std::vector<Snapshot> undo;
            std::vector<Snapshot> redo;
        };

        std::optional<PlatformEdit> platformEdit_;
        bool lastEditAddedUndo_ = false;
        EditKind undoGroup_ = EditKind::Atomic;
        double editTime_ = -1;
        double lastEditTime_ = -1;
    };
}
