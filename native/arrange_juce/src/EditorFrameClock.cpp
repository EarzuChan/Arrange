#include <arrange/juce/EditorFrameClock.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <utility>

namespace arrange::juce {
    void EditorFrameClock::sync(
        ::juce::Component& owner,
        ::juce::Timer& fallbackTimer,
        EditorTimerDemand demand,
        VBlankTickCallback onVBlankTick) {
        if (shouldUseVBlank(owner, demand)) {
            fallbackTimer_.stop(fallbackTimer);
            if (!vblank_) {
                vblank_ = std::make_unique<::juce::VBlankAttachment>(
                    &owner,
                    [callback = std::move(onVBlankTick)](double timestampSeconds) {
                        callback(timestampSeconds * 1000.0);
                    });
            }
            return;
        }

        if (insideVBlankCallback_) {
            deferResyncAfterVBlank();
            return;
        }

        vblank_.reset();
        fallbackTimer_.sync(fallbackTimer, demand);
    }

    void EditorFrameClock::stop(::juce::Timer& fallbackTimer) noexcept {
        if (insideVBlankCallback_) {
            deferResyncAfterVBlank();
            return;
        }

        vblank_.reset();
        fallbackTimer_.stop(fallbackTimer);
    }

    void EditorFrameClock::beginVBlankCallback() noexcept {
        insideVBlankCallback_ = true;
    }

    bool EditorFrameClock::endVBlankCallback() noexcept {
        insideVBlankCallback_ = false;
        return std::exchange(resyncAfterVBlank_, false);
    }

    bool EditorFrameClock::usingVBlank() const noexcept {
        return vblank_ != nullptr;
    }

    int EditorFrameClock::activeFallbackFrequencyHz() const noexcept {
        return fallbackTimer_.activeFrequencyHz();
    }

    bool EditorFrameClock::shouldUseVBlank(
        const ::juce::Component& owner,
        EditorTimerDemand demand) noexcept {
        return demand.running
               && demand.frequencyHz > 0
               && demand.preferVBlank
               && owner.getPeer() != nullptr;
    }

    void EditorFrameClock::deferResyncAfterVBlank() noexcept {
        resyncAfterVBlank_ = true;
    }
} // namespace arrange::juce

#endif
