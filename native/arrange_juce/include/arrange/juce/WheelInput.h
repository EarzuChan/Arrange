#pragma once

#include <cstdint>

namespace arrange::juce {
    enum class WheelPhase : std::uint8_t { None, MayBegin, Began, Changed, Ended, Cancelled };
    enum class WheelUnit : std::uint8_t { LogicalPixels, Lines, Pages };

    struct WheelInput {
        float deltaX = 0;
        float deltaY = 0;
        double timeMillis = 0;
        WheelUnit unitX = WheelUnit::LogicalPixels;
        WheelUnit unitY = WheelUnit::LogicalPixels;
        WheelPhase phase = WheelPhase::None;
        WheelPhase momentumPhase = WheelPhase::None;
        bool precise = false;
        bool inertial = false;
        bool nativePhases = false;
    };

    inline constexpr float scrollLineDistance = 16.0f;
    inline constexpr double wheelSequenceGapMillis = 300.0;
}
