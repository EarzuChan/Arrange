#pragma once

#include <arrange/core/Geometry.h>
#include <arrange/core/InputIntent.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/NativeScene.h>
#include <arrange/core/Paint.h>
#include <arrange/core/SceneFramePipeline.h>

#include <optional>
#include <vector>

namespace arrange::juce {
    class ScenePipelineState {
    public:
        explicit ScenePipelineState(arrange::core::SceneFramePipeline pipeline = arrange::core::SceneFramePipeline());

        void reset();
        void enqueue(arrange::core::MutationTransaction transaction);
        void enqueueIntent(arrange::core::InputIntent intent);
        [[nodiscard]] bool hasPendingIntents() const noexcept;
        [[nodiscard]] bool hasPendingTransactions() const noexcept;
        void clearPendingTransactions() noexcept;

        [[nodiscard]] arrange::core::SceneFramePipelineResult run(
            arrange::core::NodeId root,
            arrange::core::Constraints constraints,
            bool framePipelineRequested,
            const arrange::core::FrameFinalizer& finalize = {});

        [[nodiscard]] arrange::core::NativeScene& scene() noexcept { return scene_; }
        [[nodiscard]] const arrange::core::NativeScene& scene() const noexcept { return scene_; }
        [[nodiscard]] const arrange::core::PublishedFrame& publishedFrame() const noexcept { return publishedFrame_; }
        const arrange::core::FrameExecutionCounters& counters() const noexcept { return pipeline_.counters(); }
        bool publishRetained(const arrange::core::FrameFinalizer& finalize) {
            return pipeline_.publishRetained(scene_, publishedFrame_, finalize);
        }

    private:
        arrange::core::NativeScene scene_;
        arrange::core::SceneFramePipeline pipeline_;
        arrange::core::InputIntentQueue pendingIntents_;
        arrange::core::MutationTransactionQueue pendingTransactions_;
        std::optional<arrange::core::MutationTransaction> failedTransaction_;
        arrange::core::PublishedFrame publishedFrame_;
    };
} // namespace arrange::juce

