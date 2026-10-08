#include "PlatformWheelInput.h"

namespace arrange::juce {
    WheelInput readPlatformWheelInput(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
        WheelInput input;
        input.deltaX = wheel.deltaX * 48.0f;
        input.deltaY = wheel.deltaY * 48.0f;
        input.timeMillis = ::juce::Time::getMillisecondCounterHiRes();
        input.precise = wheel.isSmooth;
        input.inertial = wheel.isInertial;
        if (!input.precise && event.mods.isShiftDown() && input.deltaX == 0) {
            input.deltaX = input.deltaY;
            input.deltaY = 0;
        }
        return input;
    }
}
