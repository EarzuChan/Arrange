#include <arrange/juce/FramePlanner.h>

namespace arrange::juce {
    void FramePlanner::requestFramePipelineRun() noexcept {
        framePipelineRunRequested_ = true;
    }

    bool FramePlanner::framePipelineRunRequested() const noexcept {
        return framePipelineRunRequested_;
    }

    void FramePlanner::clearFramePipelineRunRequest() noexcept {
        framePipelineRunRequested_ = false;
    }

    EditorFramePlan FramePlanner::planTick(FrameWorkState state) const noexcept {
        EditorFramePlan plan;
        plan.runEvents = state.hasQueuedEvents;
        plan.runAnimation = state.wantsAnimation;
        plan.drainComposition = plan.runEvents || plan.runAnimation;
        plan.applyMutations = state.hasPendingIntents || state.hasPendingTransactions;
        plan.runPipeline = framePipelineRunRequested_ || plan.applyMutations;
        plan.hasTickWork = plan.runEvents || plan.runAnimation || plan.runPipeline;
        if (plan.runEvents) plan.reason = "queued input events";
        else if (plan.runAnimation) plan.reason = "animation frame";
        else if (state.hasPendingIntents) plan.reason = "pending InputIntent";
        else if (state.hasPendingTransactions) plan.reason = "pending MutationTransaction";
        else if (framePipelineRunRequested_) plan.reason = "explicit frame pipeline request";
        return plan;
    }

    bool FramePlanner::hasPendingFrameWork(FrameWorkState state) const noexcept {
        const auto plan = planTick(state);
        return plan.hasTickWork;
    }

    int FramePlanner::desiredTimerFrequencyHz(FrameWorkState state) const noexcept {
        const auto plan = planTick(state);
        return plan.hasTickWork ? 60 : 20;
    }

    void FramePlanner::reset() noexcept {
        framePipelineRunRequested_ = false;
    }
} // namespace arrange::juce

