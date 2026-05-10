#pragma once

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_events/juce_events.h>
#endif

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct EditorTimerDemand {
        bool running = false;
        int frequencyHz = 0;
        bool preferVBlank = false;
    };

    class EditorTimerDriver final {
    public:
        void sync(::juce::Timer& timer, EditorTimerDemand demand);
        void stop(::juce::Timer& timer) noexcept;

        [[nodiscard]] int activeFrequencyHz() const noexcept;

    private:
        int activeFrequencyHz_ = 0;
    };

#endif
} // namespace arrange::juce
