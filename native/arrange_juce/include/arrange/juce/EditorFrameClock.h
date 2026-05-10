#pragma once

#include <arrange/juce/EditorTimerDriver.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <functional>
#include <memory>
#include <juce_gui_basics/juce_gui_basics.h>
#endif

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class EditorFrameClock final {
    public:
        using VBlankTickCallback = std::function<void(double timestampMillis)>;

        void sync(
            ::juce::Component& owner,
            ::juce::Timer& fallbackTimer,
            EditorTimerDemand demand,
            VBlankTickCallback onVBlankTick);
        void stop(::juce::Timer& fallbackTimer) noexcept;

        void beginVBlankCallback() noexcept;
        [[nodiscard]] bool endVBlankCallback() noexcept;

        [[nodiscard]] bool usingVBlank() const noexcept;
        [[nodiscard]] int activeFallbackFrequencyHz() const noexcept;

    private:
        [[nodiscard]] static bool shouldUseVBlank(const ::juce::Component& owner, EditorTimerDemand demand) noexcept;
        void deferResyncAfterVBlank() noexcept;

        EditorTimerDriver fallbackTimer_;
        std::unique_ptr<::juce::VBlankAttachment> vblank_;
        bool insideVBlankCallback_ = false;
        bool resyncAfterVBlank_ = false;
    };

#endif
} // namespace arrange::juce
