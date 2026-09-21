#include <arrange/juce/VBlankSource.h>

#include <cmath>

namespace arrange::juce {
    void VBlankFrameDriver::start(VBlankSource::Callback callback) {
        callback_ = std::move(callback);
        if (active_) return;
        active_ = true;
        source_.start([this](double timestampMillis) { tick(timestampMillis); });
    }

    void VBlankFrameDriver::stop() noexcept {
        active_ = false;
        source_.stop();
        callback_ = {};
    }

    void VBlankFrameDriver::tick(double timestampMillis) {
        if (!active_ || ticking_ || !std::isfinite(timestampMillis) || timestampMillis <= previousTimestamp_) return;
        previousTimestamp_ = timestampMillis;
        ticking_ = true;
        const auto callback = callback_;
        try {
            if (callback) callback(timestampMillis);
        } catch (...) {
            ticking_ = false;
            throw;
        }
        ticking_ = false;
    }
}  // namespace arrange::juce
