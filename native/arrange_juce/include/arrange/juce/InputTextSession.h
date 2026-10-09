#pragma once

#include <arrange/core/InputEditing.h>
#include <arrange/core/LayoutNode.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct TextDragSelection {
        arrange::core::TextSelectionRange range;
        arrange::core::TextSelectionGranularity granularity = arrange::core::TextSelectionGranularity::Character;
    };

    class InputTextSession final {
       public:
        void reset();

        std::optional<arrange::core::NodeId>& focusedNode() noexcept {
            return focusedNode_;
        }

        const std::optional<arrange::core::NodeId>& focusedNode() const noexcept {
            return focusedNode_;
        }

        std::optional<TextDragSelection>& dragAnchor() noexcept {
            return dragAnchor_;
        }

        const std::optional<TextDragSelection>& dragAnchor() const noexcept {
            return dragAnchor_;
        }

        arrange::core::TextInputState& state() noexcept {
            return state_;
        }

        const arrange::core::TextInputState& state() const noexcept {
            return state_;
        }

        float& viewportX() noexcept {
            return viewportX_;
        }

        float viewportX() const noexcept {
            return viewportX_;
        }

        float& viewportY() noexcept {
            return viewportY_;
        }

        float viewportY() const noexcept {
            return viewportY_;
        }

        std::optional<float>& preferredX() noexcept {
            return preferredX_;
        }

        bool& pendingPlatformEdit() noexcept {
            return pendingPlatformEdit_;
        }

        bool& compositionCancelled() noexcept {
            return compositionCancelled_;
        }

        std::vector<::juce::Range<int>>& temporaryUnderlines() noexcept {
            return temporaryUnderlines_;
        }

        const std::vector<::juce::Range<int>>& temporaryUnderlines() const noexcept {
            return temporaryUnderlines_;
        }

       private:
        std::optional<arrange::core::NodeId> focusedNode_;
        std::optional<TextDragSelection> dragAnchor_;
        arrange::core::TextInputState state_;
        float viewportX_ = 0.0f;
        float viewportY_ = 0.0f;
        std::optional<float> preferredX_;
        bool pendingPlatformEdit_ = false;
        bool compositionCancelled_ = false;
        std::vector<::juce::Range<int>> temporaryUnderlines_;
    };

#endif
}
