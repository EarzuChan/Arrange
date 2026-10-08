#include "PlatformWheelInput.h"

#if ARRANGE_JUCE_WITH_JUCE && JUCE_WINDOWS

#include <windows.h>

namespace arrange::juce {
    namespace {
        // 未测试！
        void normalizeWheelAxis(float rawDelta, UINT setting, float& delta, WheelUnit& unit) {
            UINT count = 3;
            SystemParametersInfoW(setting, 0, &count, 0);
            const auto turns = rawDelta * 512.0f / static_cast<float>(WHEEL_DELTA);
            unit = count == WHEEL_PAGESCROLL ? WheelUnit::Pages : WheelUnit::Lines;
            delta = count == WHEEL_PAGESCROLL ? turns : turns * static_cast<float>(count);
        }
    }

    // 未测试！
    WheelInput readPlatformWheelInput(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
        WheelInput input;
        input.timeMillis = ::juce::Time::getMillisecondCounterHiRes();
        input.precise = wheel.isSmooth;
        input.inertial = wheel.isInertial;
        // JUCE 将 Win32 原始滚轮值除以 512；恢复轮数并遵守系统行数、字符数及整页设置
        normalizeWheelAxis(wheel.deltaX, SPI_GETWHEELSCROLLCHARS, input.deltaX, input.unitX);
        normalizeWheelAxis(wheel.deltaY, SPI_GETWHEELSCROLLLINES, input.deltaY, input.unitY);
        if (!input.precise && event.mods.isShiftDown() && input.deltaX == 0.0f && input.deltaY != 0.0f) {
            input.deltaX = input.deltaY;
            input.deltaY = 0.0f;
            input.unitX = input.unitY;
        }
        return input;
    }
}

#endif
