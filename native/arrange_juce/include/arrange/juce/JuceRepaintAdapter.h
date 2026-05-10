#pragma once

#include <arrange/core/LayoutTree.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ArrangeRuntime;
    class DiagnosticsState;

    class JuceRepaintAdapter final {
    public:
        void repaintDirty(
            ::juce::Component& owner,
            const ArrangeRuntime& runtime,
            const DiagnosticsState& diagnostics,
            arrange::core::NodeId root,
            bool loaded,
            bool fullIfNoBounds);
    };

#endif
} // namespace arrange::juce
