#pragma once

#include <chrono>
#include <cstdlib>
#include <string_view>

namespace arrange::juce {
    // 环境开关只在对象建立时读取，0 关闭、1 开启，其他值沿用默认值
    inline bool renderEnvironmentFlag(const char* name, bool fallback) {
        const auto* value = std::getenv(name);
        if (!value) return fallback;
        if (std::string_view(value) == "0") return false;
        if (std::string_view(value) == "1") return true;
        return fallback;
    }

    // 关闭诊断时不读取时钟；耗时含调用内部的等待，不代表 GPU 执行时间
    class RenderMetricsTimer {
       public:
        RenderMetricsTimer(bool enabled, double& elapsed) : elapsed_(enabled ? &elapsed : nullptr) {
            if (elapsed_) started_ = Clock::now();
        }

        ~RenderMetricsTimer() {
            if (elapsed_) *elapsed_ += std::chrono::duration<double, std::milli>(Clock::now() - started_).count();
        }

       private:
        using Clock = std::chrono::steady_clock;
        double* elapsed_;
        Clock::time_point started_;
    };
}
