#include <arrange/juce/JuceTextInputAdapter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/LayoutTree.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/RuntimeSessionState.h>

namespace arrange::juce {
    namespace {
        [[nodiscard]] bool inputReady(
            const RuntimeSessionState& session,
            const DiagnosticsState& diagnostics) noexcept {
            return session.interactive(diagnostics);
        }
    } // namespace

    bool JuceTextInputAdapter::isActive(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction) const {
        return inputReady(session, diagnostics) && interaction.isTextInputActive(tree, session.loaded());
    }

    ::juce::Range<int> JuceTextInputAdapter::highlightedRegion(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction) const {
        return interaction.highlightedRegion(tree, inputReady(session, diagnostics));
    }

    bool JuceTextInputAdapter::setHighlightedRegion(
        arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        const ::juce::Range<int>& range,
        const TextInputCallbacks& callbacks) const {
        return inputReady(session, diagnostics)
               && interaction.setHighlightedRegion(tree, session.loaded(), range, callbacks);
    }

    bool JuceTextInputAdapter::setTemporaryUnderlining(
        arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        const ::juce::Array<::juce::Range<int>>& ranges,
        const TextInputCallbacks& callbacks) const {
        return inputReady(session, diagnostics)
               && interaction.setTemporaryUnderlining(tree, session.loaded(), ranges, callbacks);
    }

    ::juce::String JuceTextInputAdapter::textInRange(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction,
        const ::juce::Range<int>& range) const {
        return interaction.textInRange(tree, inputReady(session, diagnostics), range);
    }

    bool JuceTextInputAdapter::insertTextAtCaret(
        arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        const ::juce::String& textToInsert,
        const TextInputCallbacks& callbacks) const {
        return inputReady(session, diagnostics)
               && interaction.insertTextAtCaret(tree, session.loaded(), textToInsert, callbacks);
    }

    int JuceTextInputAdapter::caretPosition(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction) const {
        return interaction.caretPosition(tree, inputReady(session, diagnostics));
    }

    int JuceTextInputAdapter::totalNumChars(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction) const {
        return interaction.totalNumChars(tree, inputReady(session, diagnostics));
    }

    int JuceTextInputAdapter::charIndexForPoint(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction,
        ::juce::Point<int> point) const {
        return interaction.charIndexForPoint(tree, inputReady(session, diagnostics), point);
    }

    ::juce::Rectangle<int> JuceTextInputAdapter::caretRectangleForCharIndex(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction,
        int characterIndex) const {
        return interaction.caretRectangleForCharIndex(
            tree,
            inputReady(session, diagnostics),
            characterIndex);
    }

    ::juce::RectangleList<int> JuceTextInputAdapter::textBounds(
        const arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        const InteractionStateOwner& interaction,
        ::juce::Range<int> range) const {
        return interaction.textBounds(tree, inputReady(session, diagnostics), range);
    }

    bool JuceTextInputAdapter::keyPressed(
        arrange::core::LayoutTree& tree,
        const RuntimeSessionState& session,
        const DiagnosticsState& diagnostics,
        InteractionStateOwner& interaction,
        const ::juce::KeyPress& key,
        const TextInputCallbacks& callbacks) const {
        if (diagnostics.hasError()) {
            return false;
        }
        return interaction.keyPressed(tree, session.loaded(), key, callbacks);
    }
} // namespace arrange::juce

#endif
