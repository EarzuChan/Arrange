#pragma once

#include "VBlankSource.h"

#if ARRANGE_JUCE_WITH_JUCE
#include <memory>
#include <juce_gui_basics/juce_gui_basics.h>

namespace arrange::juce {
    class EditorFrameClock final {
       public:
        using VBlankTickCallback = VBlankSource::Callback;
        ~EditorFrameClock();
        void sync(::juce::Component& owner, bool running, VBlankTickCallback onVBlankTick);
        void stop() noexcept;
        void beginVBlankCallback() noexcept;
        bool endVBlankCallback() noexcept;

       private:
        std::unique_ptr<VBlankSource> source_;
        std::unique_ptr<VBlankFrameDriver> driver_;
        bool insideVBlankCallback_ = false;
        bool resyncAfterVBlank_ = false;
    };
}  // namespace arrange::juce
#endif
