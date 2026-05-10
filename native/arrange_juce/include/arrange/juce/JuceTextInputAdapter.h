#pragma once

#include <arrange/juce/TextInputOwner.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

namespace arrange::core {
    class LayoutTree;
}

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class DiagnosticsState;
    class InteractionStateOwner;
    class RuntimeSessionState;

    class JuceTextInputAdapter final {
    public:
        [[nodiscard]] bool isActive(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction) const;

        [[nodiscard]] ::juce::Range<int> highlightedRegion(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction) const;

        [[nodiscard]] bool setHighlightedRegion(
            arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            const ::juce::Range<int>& range,
            const TextInputCallbacks& callbacks) const;

        [[nodiscard]] bool setTemporaryUnderlining(
            arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            const ::juce::Array<::juce::Range<int>>& ranges,
            const TextInputCallbacks& callbacks) const;

        [[nodiscard]] ::juce::String textInRange(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction,
            const ::juce::Range<int>& range) const;

        [[nodiscard]] bool insertTextAtCaret(
            arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            const ::juce::String& textToInsert,
            const TextInputCallbacks& callbacks) const;

        [[nodiscard]] int caretPosition(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction) const;

        [[nodiscard]] int totalNumChars(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction) const;

        [[nodiscard]] int charIndexForPoint(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction,
            ::juce::Point<int> point) const;

        [[nodiscard]] ::juce::Rectangle<int> caretRectangleForCharIndex(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction,
            int characterIndex) const;

        [[nodiscard]] ::juce::RectangleList<int> textBounds(
            const arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            const InteractionStateOwner& interaction,
            ::juce::Range<int> range) const;

        [[nodiscard]] bool keyPressed(
            arrange::core::LayoutTree& tree,
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics,
            InteractionStateOwner& interaction,
            const ::juce::KeyPress& key,
            const TextInputCallbacks& callbacks) const;
    };

#endif
} // namespace arrange::juce
