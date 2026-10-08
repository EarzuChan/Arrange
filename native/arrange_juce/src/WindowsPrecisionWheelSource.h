#pragma once

#if ARRANGE_JUCE_WITH_JUCE

#include <juce_gui_basics/juce_gui_basics.h>

#if JUCE_WINDOWS

#include <functional>
#include <memory>
#include <arrange/core/Geometry.h>
#include <arrange/juce/WheelInput.h>

namespace arrange::juce {
    // 未测试！
    class WindowsPrecisionWheelSource final {
       public:
        using InputCallback = std::function<void(arrange::core::Point, const WheelInput&)>;
        using WakeCallback = std::function<void()>;

        WindowsPrecisionWheelSource(InputCallback onInput, WakeCallback onWake);
        ~WindowsPrecisionWheelSource();
        WindowsPrecisionWheelSource(const WindowsPrecisionWheelSource&) = delete;
        WindowsPrecisionWheelSource& operator=(const WindowsPrecisionWheelSource&) = delete;
        void sync(::juce::Component& owner);
        void tick();
        bool needsTicks() const noexcept;
        void cancel();

       private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
    };
}

#endif

#endif
