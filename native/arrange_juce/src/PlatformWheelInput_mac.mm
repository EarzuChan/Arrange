#include "PlatformWheelInput.h"

#import <AppKit/AppKit.h>

#include <cmath>

namespace arrange::juce {
    namespace {
        constexpr float jucePreciseWheelScale = 0.5f / 256.0f;
        constexpr float juceDiscreteWheelScale = 10.0f / 256.0f;
        constexpr float fallbackDiscreteWheelDistance = 48.0f;
        constexpr float wheelDeltaTolerance = 0.000001f;
        constexpr float eventPositionTolerancePoints = 0.5f;
        constexpr ::juce::int64 eventTimeToleranceMillis = 2;

        WheelPhase wheelPhase(NSEventPhase phase) noexcept {
            if ((phase & NSEventPhaseCancelled) != 0) return WheelPhase::Cancelled;
            if ((phase & NSEventPhaseEnded) != 0) return WheelPhase::Ended;
            if ((phase & NSEventPhaseBegan) != 0) return WheelPhase::Began;
            if ((phase & NSEventPhaseMayBegin) != 0) return WheelPhase::MayBegin;
            if ((phase & (NSEventPhaseChanged | NSEventPhaseStationary)) != 0) return WheelPhase::Changed;
            return WheelPhase::None;
        }

        void transposeShiftWheel(WheelInput& input, const ::juce::MouseEvent& event) noexcept {
            // 系统已产生横向位移时保留原轴；精细手势不使用离散滚轮的 Shift 转轴约定
            if (input.precise || !event.mods.isShiftDown() || input.deltaX != 0.0f || input.deltaY == 0.0f) return;
            input.deltaX = input.deltaY;
            input.deltaY = 0.0f;
            input.unitX = input.unitY;
        }

        WheelInput fallbackWheelInput(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
            WheelInput input;
            const auto distanceScale = wheel.isSmooth ? 1.0f / jucePreciseWheelScale : fallbackDiscreteWheelDistance;
            input.deltaX = wheel.deltaX * distanceScale;
            input.deltaY = wheel.deltaY * distanceScale;
            input.timeMillis = ::juce::Time::getMillisecondCounterHiRes();
            input.precise = wheel.isSmooth;
            input.inertial = wheel.isInertial;
            transposeShiftWheel(input, event);
            return input;
        }

        bool matchesWheelDetails(NSEvent* nativeEvent, const ::juce::MouseWheelDetails& wheel) {
            const auto precise = static_cast<bool>(nativeEvent.hasPreciseScrollingDeltas);
            auto deltaX = precise ? static_cast<float>(nativeEvent.scrollingDeltaX) * jucePreciseWheelScale : 0.0f;
            auto deltaY = precise ? static_cast<float>(nativeEvent.scrollingDeltaY) * jucePreciseWheelScale : 0.0f;
            // JUCE 在零位移边界仍转发事件，只会先尝试旧 delta 作为备用距离
            if (deltaX == 0.0f && deltaY == 0.0f) {
                deltaX = static_cast<float>(nativeEvent.deltaX) * juceDiscreteWheelScale;
                deltaY = static_cast<float>(nativeEvent.deltaY) * juceDiscreteWheelScale;
            }
            return std::abs(deltaX - wheel.deltaX) <= wheelDeltaTolerance && std::abs(deltaY - wheel.deltaY) <= wheelDeltaTolerance && precise == wheel.isSmooth && (nativeEvent.momentumPhase != NSEventPhaseNone) == wheel.isInertial && static_cast<bool>(nativeEvent.isDirectionInvertedFromDevice) == wheel.isReversed;
        }

        NSEvent* matchingNativeWheelEvent(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
            if (!event.source.isMouse() || event.eventComponent == nullptr) return nil;
            auto* nativeEvent = NSApp.currentEvent;
            if (nativeEvent == nil || nativeEvent.type != NSEventTypeScrollWheel) return nil;
            auto* component = event.originalComponent != nullptr ? event.originalComponent : event.eventComponent;
            if (component == nullptr) return nil;
            auto* peer = component->getPeer();
            if (peer == nullptr) return nil;
            auto* nativeView = static_cast<NSView*>(peer->getNativeHandle());
            if (nativeView == nil || nativeView.window == nil || nativeEvent.window != nativeView.window) return nil;

            // 复用 JUCE 的 uptime 到墙钟换算，避免把旧原生事件误认为当前回调
            const auto nativeTimeMillis = ::juce::Time::currentTimeMillis() - ::juce::Time::getMillisecondCounter() + static_cast<::juce::int64>(nativeEvent.timestamp * 1000.0);
            const auto timeDifference = event.eventTime.toMilliseconds() - nativeTimeMillis;
            if (timeDifference < -eventTimeToleranceMillis || timeDifference > eventTimeToleranceMillis) return nil;

            auto& peerComponent = peer->getComponent();
            const auto position = event.getEventRelativeTo(&peerComponent).position * peerComponent.getDesktopScaleFactor();
            const auto nativePosition = [nativeView convertPoint:nativeEvent.locationInWindow fromView:nil];
            if (std::abs(position.x - nativePosition.x) > eventPositionTolerancePoints || std::abs(position.y - nativePosition.y) > eventPositionTolerancePoints) return nil;
            if (!matchesWheelDetails(nativeEvent, wheel)) return nil;
            return nativeEvent;
        }
    }

    WheelInput readPlatformWheelInput(const ::juce::MouseEvent& event, const ::juce::MouseWheelDetails& wheel) {
        auto* nativeEvent = matchingNativeWheelEvent(event, wheel);
        if (nativeEvent == nil) return fallbackWheelInput(event, wheel);

        WheelInput input;
        input.deltaX = static_cast<float>(nativeEvent.scrollingDeltaX);
        input.deltaY = static_cast<float>(nativeEvent.scrollingDeltaY);
        input.timeMillis = ::juce::Time::getMillisecondCounterHiRes();
        input.precise = static_cast<bool>(nativeEvent.hasPreciseScrollingDeltas);
        input.unitX = input.precise ? WheelUnit::LogicalPixels : WheelUnit::Lines;
        input.unitY = input.unitX;
        input.phase = wheelPhase(nativeEvent.phase);
        input.momentumPhase = wheelPhase(nativeEvent.momentumPhase);
        input.inertial = nativeEvent.momentumPhase != NSEventPhaseNone;
        input.nativePhases = nativeEvent.phase != NSEventPhaseNone || nativeEvent.momentumPhase != NSEventPhaseNone;
        // AppKit 已应用自然滚动偏好；保留逻辑 point 和行单位，不再次反向或乘 Retina 倍率
        transposeShiftWheel(input, event);
        return input;
    }
}
