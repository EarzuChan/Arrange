#pragma once

#include <arrange/core/InputEditing.h>
#include <arrange/core/Node.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <optional>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class InputTextSession final {
    public:
        void reset();

        std::optional<arrange::core::NodeId>& focusedNode() noexcept { return focusedNode_; }
        const std::optional<arrange::core::NodeId>& focusedNode() const noexcept { return focusedNode_; }

        std::optional<std::size_t>& dragAnchor() noexcept { return dragAnchor_; }
        const std::optional<std::size_t>& dragAnchor() const noexcept { return dragAnchor_; }

        arrange::core::TextInputState& state() noexcept { return state_; }
        const arrange::core::TextInputState& state() const noexcept { return state_; }

        float& viewportX() noexcept { return viewportX_; }
        float viewportX() const noexcept { return viewportX_; }

        std::vector<::juce::Range<int>>& temporaryUnderlines() noexcept { return temporaryUnderlines_; }
        const std::vector<::juce::Range<int>>& temporaryUnderlines() const noexcept { return temporaryUnderlines_; }

    private:
        std::optional<arrange::core::NodeId> focusedNode_;
        std::optional<std::size_t> dragAnchor_;
        arrange::core::TextInputState state_;
        float viewportX_ = 0.0f;
        std::vector<::juce::Range<int>> temporaryUnderlines_;
    };

#endif
} // namespace arrange::juce
