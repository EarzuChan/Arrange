#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/InputEvent.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/InputEditing.h>
#include <arrange/core/InputSession.h>
#include <arrange/core/Paint.h>
#include <arrange/core/LayoutTree.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/TextInputLayoutModel.h>
#include <arrange/juce/InputTextSession.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <functional>
#include <string>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    // 文本编辑与 IME 会话；作为 InputSession 的文本桥接，焦点与按键时点由会话决定
    class TextInputOwner final : public arrange::core::TextInputBridge {
       public:
        explicit TextInputOwner(arrange::core::TextLayoutService& textLayoutService) noexcept;

        void reset();

        void commitState(TextInputOwner&& candidate) noexcept {
            session_ = std::move(candidate.session_);
            focusedGeneration_ = candidate.focusedGeneration_;
            focusedModifier_ = candidate.focusedModifier_;
            publishedModelValue_ = std::move(candidate.publishedModelValue_);
        }

        void cancelDrag() noexcept override;

        [[nodiscard]] const std::optional<arrange::core::NodeId>& focusedNode() const noexcept;
        [[nodiscard]] float viewportX() const noexcept;

        [[nodiscard]] float viewportY() const noexcept {
            return session_.viewportY();
        }

        void focus(const arrange::core::LayoutTree& tree, arrange::core::NodeId node, arrange::core::ModifierHandle receiver, const arrange::core::InputCallbacks& callbacks) override;
        void dispatchPendingTextEdits(const arrange::core::LayoutTree& tree, const arrange::core::InputCallbacks& callbacks);

        [[nodiscard]] arrange::core::ModifierHandle focusedModifier() const noexcept {
            return focusedModifier_;
        }

        void pointerDown(arrange::core::LayoutTree& tree, const arrange::core::HitTestResult& hit, float x, float y, const arrange::core::InputCallbacks& callbacks, arrange::core::PointerDownOptions options = {}) override;
        [[nodiscard]] bool pointerDrag(arrange::core::LayoutTree& tree, bool runtimeReady, float x, float y, const arrange::core::InputCallbacks& callbacks) override;

        [[nodiscard]] bool isTextInputActive(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] ::juce::Range<int> highlightedRegion(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] bool setHighlightedRegion(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range, const arrange::core::InputCallbacks& callbacks);
        [[nodiscard]] bool setTemporaryUnderlining(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Array<::juce::Range<int>>& ranges, const arrange::core::InputCallbacks& callbacks);
        [[nodiscard]] ::juce::String textInRange(const arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::Range<int>& range) const;
        [[nodiscard]] bool insertTextAtCaret(arrange::core::LayoutTree& tree, bool runtimeReady, const ::juce::String& textToInsert, const arrange::core::InputCallbacks& callbacks);
        [[nodiscard]] int caretPosition(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] int totalNumChars(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] int charIndexForPoint(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Point<int> point) const;
        [[nodiscard]] ::juce::Rectangle<int> caretRectangleForCharIndex(const arrange::core::LayoutTree& tree, bool runtimeReady, int characterIndex) const;
        [[nodiscard]] ::juce::RectangleList<int> textBounds(const arrange::core::LayoutTree& tree, bool runtimeReady, ::juce::Range<int> range) const;

        [[nodiscard]] bool keyPressed(arrange::core::LayoutTree& tree, bool runtimeReady, const arrange::core::KeyInput& key, const arrange::core::InputCallbacks& callbacks) override;

        void finishFocusedInput(const arrange::core::LayoutTree& tree, bool submit, const arrange::core::InputCallbacks& callbacks) override;
        void synchronizePublishedInput(const arrange::core::LayoutTree& tree, bool runtimeReady) override;
        void updateFocusedInputViewport(const arrange::core::LayoutTree& tree, bool runtimeReady);
        [[nodiscard]] std::vector<arrange::core::DrawOp> buildFocusedInputOps(const arrange::core::LayoutTree& tree, bool runtimeReady) const;

       private:
        [[nodiscard]] const arrange::core::LayoutNode* activeInputNode(const arrange::core::LayoutTree& tree, bool runtimeReady) const;
        [[nodiscard]] arrange::core::LayoutNode* activeInputNode(arrange::core::LayoutTree& tree, bool runtimeReady);
        [[nodiscard]] ::juce::RectangleList<int> textBoundsForByteRange(const arrange::core::LayoutTree& tree, bool runtimeReady, std::size_t start, std::size_t end) const;
        [[nodiscard]] std::string normalizeInsertionText(const arrange::core::LayoutNode& node, std::string text) const;
        [[nodiscard]] bool applyEdit(arrange::core::LayoutNode& node, const arrange::core::InputEditResult& edit, const arrange::core::InputCallbacks& callbacks);

        TextInputLayoutModel text_;
        InputTextSession session_;
        std::uint64_t focusedGeneration_ = 0;
        arrange::core::ModifierHandle focusedModifier_;
        const arrange::core::ModifierInstance& inputInstance(const arrange::core::LayoutNode& node) const;
        std::string publishedModelValue_;
    };

#endif
}
