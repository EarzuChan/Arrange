#include <arrange/juce/ScenePipelineState.h>

#include <algorithm>
#include <utility>

namespace arrange::juce {
    ScenePipelineState::ScenePipelineState(arrange::core::SceneFramePipeline pipeline) : pipeline_(std::move(pipeline)) {}

    void ScenePipelineState::reset() {
        scene_.reset();
        frameTimeMillis_ = 0;
        pendingIntents_.clear();
        pendingTransactions_.clear();
        publishedFrame_ = {};
    }

    void ScenePipelineState::enqueue(arrange::core::MutationTransaction transaction) {
        enqueueIntent(arrange::core::InputIntent::jsCommit(std::move(transaction)));
    }

    void ScenePipelineState::enqueueIntent(arrange::core::InputIntent intent) {
        pendingIntents_.push(std::move(intent));
    }

    bool ScenePipelineState::hasPendingIntents() const noexcept {
        return pendingIntents_.size() > 0;
    }

    bool ScenePipelineState::hasPendingTransactions() const noexcept {
        return pendingTransactions_.hasPending();
    }

    void ScenePipelineState::clearPendingTransactions() noexcept {
        pendingTransactions_.clear();
    }

    arrange::core::SceneFramePipelineResult ScenePipelineState::run(arrange::core::NodeId root, arrange::core::Constraints constraints, bool framePipelineRequested, const arrange::core::FrameFinalizer& finalize, const arrange::core::FramePreparation& preparation) {
        for (auto& intent : pendingIntents_.take()) {
            if (intent.transaction && (!intent.transaction->rearrange || !intent.transaction->rearrange->cancelled)) pendingTransactions_.push(std::move(*intent.transaction));
            auto& tree = scene_.tree();
            if (intent.kind == arrange::core::InputIntentKind::DiagnosticsEvent)
                tree.invalidateScene(arrange::core::DirtyFlag::Diagnostics);
            else if (intent.kind == arrange::core::InputIntentKind::Resize)
                tree.invalidateViewport();
            else if (intent.kind == arrange::core::InputIntentKind::ResourceReady)
                tree.invalidateScene(arrange::core::DirtyFlag::Resource);
            else if (intent.kind == arrange::core::InputIntentKind::ResourceFailed) {
                tree.invalidateScene(arrange::core::DirtyFlag::Resource);
                tree.invalidateScene(arrange::core::DirtyFlag::Diagnostics);
            }
            if (intent.needsFullFallback) tree.requestFullFallback();
        }

        const auto hasPending = pendingTransactions_.hasPending();
        if (!hasPending && !framePipelineRequested && scene_.invalidationSnapshot().empty()) return {};

        auto transaction = hasPending ? pendingTransactions_.take() : std::optional<arrange::core::MutationTransaction>{};
        if (transaction && transaction->rearrange && transaction->rearrange->cancelled) transaction.reset();
        // 失败候选由提交回执撤销，已提交的 JS 账本与 scene 都保持不变
        auto result = pipeline_.run(scene_, root, constraints, transaction ? &*transaction : nullptr, framePipelineRequested, publishedFrame_, finalize, frameTimeMillis_, preparation);

        return result;
    }

}
