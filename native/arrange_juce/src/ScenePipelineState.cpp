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

    arrange::core::SceneFramePipelineResult ScenePipelineState::run(arrange::core::NodeId root, arrange::core::Constraints constraints, bool framePipelineRequested, const arrange::core::FrameFinalizer& finalize) {
        for (auto& intent : pendingIntents_.take()) {
            if (intent.transaction && (!intent.transaction->rearrange || !intent.transaction->rearrange->cancelled)) pendingTransactions_.push(std::move(*intent.transaction));
            if (intent.kind == arrange::core::InputIntentKind::DiagnosticsEvent) {
                scene_.tree().recordSceneInvalidation(arrange::core::DirtyFlag::Accessibility, arrange::core::InvalidationSource::Diagnostics, "diagnostics", intent.reason.empty() ? "diagnostics event" : intent.reason);
            } else if (intent.kind == arrange::core::InputIntentKind::Resize) {
                scene_.tree().recordSceneInvalidation(arrange::core::DirtyFlag::Layout, arrange::core::InvalidationSource::Resize, "viewport", intent.reason.empty() ? "viewport resize" : intent.reason);
            } else if (intent.kind == arrange::core::InputIntentKind::ResourceReady) {
                scene_.tree().recordSceneInvalidation(arrange::core::DirtyFlag::Resource, arrange::core::InvalidationSource::Resource, "resource", intent.reason.empty() ? "resource ready" : intent.reason);
            } else if (intent.kind == arrange::core::InputIntentKind::ResourceFailed) {
                scene_.tree().recordSceneInvalidation(arrange::core::DirtyFlag::Resource, arrange::core::InvalidationSource::Resource, "resource", intent.reason.empty() ? "resource failed" : intent.reason);
                scene_.tree().recordSceneInvalidation(arrange::core::DirtyFlag::Accessibility, arrange::core::InvalidationSource::Diagnostics, "diagnostics", intent.reason.empty() ? "resource failed" : intent.reason);
            }
            if (intent.needsFullFallback) {
                scene_.tree().requestFullFallback(intent.reason.empty() ? "input intent requested full fallback" : intent.reason);
            }
        }

        const auto hasPending = pendingTransactions_.hasPending();
        if (!hasPending && !framePipelineRequested && scene_.invalidationSnapshot().empty()) return {};

        auto transaction = hasPending ? pendingTransactions_.take() : std::optional<arrange::core::MutationTransaction>{};
        if (transaction && transaction->rearrange && transaction->rearrange->cancelled) transaction.reset();
        // 失败候选由提交回执撤销，已提交的 JS 账本与 scene 都保持不变
        auto result = pipeline_.run(scene_, root, constraints, transaction ? &*transaction : nullptr, framePipelineRequested, publishedFrame_, finalize, frameTimeMillis_);
        if (transaction) result.rearrange = transaction->rearrange;
        return result;
    }

}  // namespace arrange::juce
