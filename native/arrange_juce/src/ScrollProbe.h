#pragma once

#include <cstdint>
#include <filesystem>

namespace arrange::juce {
    class ScrollProbe final {
       public:
        enum class Kind { Input, Route, Queue, Dispatch, DispatchDone, Batch, VBlank, Publish, Paint, PredictionReset, Clock };

        struct Sample {
            Kind kind = Kind::Input;
            double timeMillis = 0;
            double sourceMillis = 0;
            double x = 0;
            double y = 0;
            double deltaX = 0;
            double deltaY = 0;
            double value = 0;
            double maxValue = 0;
            double durationMillis = 0;
            std::uint64_t sequence = 0;
            std::uint64_t revision = 0;
            std::uint64_t target = 0;
            std::uint64_t queueDepth = 0;
            std::uint64_t processed = 0;
            std::uint64_t inputSequence = 0;
            std::uint64_t previousRevision = 0;
            std::uint64_t modifierIdentity = 0;
            bool inertial = false;
            bool smooth = false;
            bool horizontal = false;
            bool consumed = false;
            bool interactive = false;
            bool valid = false;
            bool budgetBreak = false;
            bool changed = false;
            bool pending = false;
            bool reversed = false;
            bool peer = false;
        };

        static bool active() noexcept;
        static std::uint64_t currentInputSequence() noexcept;
        static Sample lastConsumed() noexcept;
        static void record(Sample sample) noexcept;
        static std::filesystem::path toggle();
    };
}
