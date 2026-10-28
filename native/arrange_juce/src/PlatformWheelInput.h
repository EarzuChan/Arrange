#pragma once

#include <arrange/core/WheelInput.h>
#include <juce_gui_basics/juce_gui_basics.h>

namespace arrange::juce {
    arrange::core::WheelInput readPlatformWheelInput(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel);
}
