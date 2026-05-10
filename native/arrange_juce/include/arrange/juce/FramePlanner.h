#pragma once

namespace arrange::juce {
    struct FrameWorkState {
        bool hasQueuedEvents = false;
        bool wantsAnimation = false;
        bool hasPendingIntents = false;
        bool hasPendingTransactions = false;
    };

    struct EditorFramePlan {
        bool runEvents = false;
        bool runAnimation = false;
        bool drainComposition = false;
        bool applyMutations = false;
        bool runPipeline = false;
        bool hasTickWork = false;
        const char* reason = "idle";
    };

    class FramePlanner {
    public:
        void requestFramePipelineRun() noexcept;
        [[nodiscard]] bool framePipelineRunRequested() const noexcept;
        void clearFramePipelineRunRequest() noexcept;

        [[nodiscard]] EditorFramePlan planTick(FrameWorkState state) const noexcept;
        [[nodiscard]] bool hasPendingFrameWork(FrameWorkState state) const noexcept;
        [[nodiscard]] int desiredTimerFrequencyHz(FrameWorkState state) const noexcept;

        void reset() noexcept;

    private:
        bool framePipelineRunRequested_ = false;
    };
} // namespace arrange::juce

