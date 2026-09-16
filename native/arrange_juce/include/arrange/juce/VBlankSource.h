#pragma once

#include <functional>
#include <limits>
#include <utility>

namespace arrange::juce {
    class VBlankSource {
    public:
        using Callback = std::function<void(double)>;
        virtual ~VBlankSource() = default;
        virtual void start(Callback callback) = 0;
        virtual void stop() noexcept = 0;
    };

    class ManualVBlankSource final : public VBlankSource {
    public:
        void start(Callback callback) override { callback_ = std::move(callback); }
        void stop() noexcept override { callback_ = {}; }
        void pulse(double timestampMillis) {
            // 回调允许停钟；调用期间保留当前闭包。
            const auto callback = callback_;
            if (callback) callback(timestampMillis);
        }

    private:
        Callback callback_;
    };

    class VBlankFrameDriver final {
    public:
        explicit VBlankFrameDriver(VBlankSource& source) : source_(source) {}
        ~VBlankFrameDriver() { stop(); }
        VBlankFrameDriver(const VBlankFrameDriver&) = delete;
        VBlankFrameDriver& operator=(const VBlankFrameDriver&) = delete;

        void start(VBlankSource::Callback callback);
        void stop() noexcept;
        bool active() const noexcept { return active_; }

    private:
        void tick(double timestampMillis);
        VBlankSource& source_;
        VBlankSource::Callback callback_;
        double previousTimestamp_ = -std::numeric_limits<double>::infinity();
        bool active_ = false;
        bool ticking_ = false;
    };
}
