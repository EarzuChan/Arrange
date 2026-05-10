#include <arrange/juce/EditorTimerDriver.h>

#if ARRANGE_JUCE_WITH_JUCE

namespace arrange::juce {
    void EditorTimerDriver::sync(::juce::Timer& timer, EditorTimerDemand demand) {
        if (demand.running && demand.frequencyHz > 0) {
            if (!timer.isTimerRunning() || activeFrequencyHz_ != demand.frequencyHz) {
                timer.startTimerHz(demand.frequencyHz);
                activeFrequencyHz_ = demand.frequencyHz;
            }
            return;
        }

        stop(timer);
    }

    void EditorTimerDriver::stop(::juce::Timer& timer) noexcept {
        timer.stopTimer();
        activeFrequencyHz_ = 0;
    }

    int EditorTimerDriver::activeFrequencyHz() const noexcept { return activeFrequencyHz_; }
} // namespace arrange::juce

#endif
