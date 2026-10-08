#pragma once

#include <arrange/juce/WheelInput.h>
#include <juce_gui_basics/juce_gui_basics.h>

namespace arrange::juce {
    WheelInput readPlatformWheelInput(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel);
}
