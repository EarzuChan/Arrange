#pragma once

#include <arrange/core/NativePainter.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_graphics/juce_graphics.h>

#include <functional>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace arrange::juce {
    // 原生 painter 的绘制函数：只能画在目标矩形内，重放时已裁到该矩形；在消息线程调用，不得阻塞
    using NativePaint = std::function<void(::juce::Graphics&, ::juce::Rectangle<float>, const arrange::core::NativePainterParams&)>;

    // 按名称注册；JS 以 scope.drawNative(name, { params }) 引用，参数表在解码时校验
    inline void registerNativePainter(std::string name, std::vector<arrange::core::NativeParamSpec> params, NativePaint paint) {
        arrange::core::NativePainterRegistry::global().add({std::move(name), std::move(params), std::make_shared<const NativePaint>(std::move(paint))});
    }

    inline void unregisterNativePainter(const std::string& name) {
        arrange::core::NativePainterRegistry::global().remove(name);
    }
}
#endif
