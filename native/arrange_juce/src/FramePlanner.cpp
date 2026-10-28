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
        plan.drainRearrange = plan.runEvents || plan.runAnimation;
        plan.applyMutations = state.hasPendingIntents || state.hasPendingTransactions;
        plan.runPipeline = framePipelineRunRequested_ || plan.applyMutations;
        plan.hasTickWork = plan.runEvents || plan.runAnimation || plan.runPipeline;
        return plan;
    }

    bool FramePlanner::hasPendingFrameWork(FrameWorkState state) const noexcept {
        const auto plan = planTick(state);
        return plan.hasTickWork;
    }

    void FramePlanner::reset() noexcept {
        framePipelineRunRequested_ = false;
    }
}
