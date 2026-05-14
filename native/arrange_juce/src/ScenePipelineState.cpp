#include <arrange/juce/ScenePipelineState.h>

#include <algorithm>
#include <utility>

namespace arrange::juce {
    namespace {
        [[nodiscard]] bool hasArea(arrange::core::Rect rect) noexcept {
            return rect.width > 0.0f && rect.height > 0.0f;
        }

        [[nodiscard]] arrange::core::Rect unionRect(arrange::core::Rect left, arrange::core::Rect right) noexcept {
            const auto x1 = std::min(left.x, right.x);
            const auto y1 = std::min(left.y, right.y);
            const auto x2 = std::max(left.x + left.width, right.x + right.width);
            const auto y2 = std::max(left.y + left.height, right.y + right.height);
            return {x1, y1, x2 - x1, y2 - y1};
        }

        [[nodiscard]] arrange::core::Rect drawOpBounds(const arrange::core::DrawOp& op) noexcept {
            auto rect = op.rect;
            if (op.type == arrange::core::DrawOpType::DrawLine) {
                const auto x1 = std::min(op.rect.x, op.lineEnd.x);
                const auto y1 = std::min(op.rect.y, op.lineEnd.y);
                const auto x2 = std::max(op.rect.x, op.lineEnd.x);
                const auto y2 = std::max(op.rect.y, op.lineEnd.y);
                const auto stroke = std::max(1.0f, op.strokeWidth);
                rect = {
                    x1 - stroke,
                    y1 - stroke,
                    (x2 - x1) + stroke * 2.0f,
                    (y2 - y1) + stroke * 2.0f,
                };
            }
            return rect;
        }

        void includeOpBounds(const std::vector<arrange::core::DrawOp>& ops, bool& hasBounds, arrange::core::Rect& bounds) {
            for (const auto& op : ops) {
                const auto rect = drawOpBounds(op);
                if (!hasArea(rect)) continue;
                if (!hasBounds) {
                    bounds = rect;
                    hasBounds = true;
                }
                else {
                    bounds = unionRect(bounds, rect);
                }
            }
        }
    } // namespace

    ScenePipelineState::ScenePipelineState(arrange::core::SceneFramePipeline pipeline)
        : pipeline_(std::move(pipeline)) {}

    void ScenePipelineState::reset() {
        scene_.reset();
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

    arrange::core::SceneFramePipelineResult ScenePipelineState::run(
        arrange::core::NodeId root,
        arrange::core::Constraints constraints,
        bool framePipelineRequested) {
        for (auto& intent : pendingIntents_.take()) {
            if (intent.transaction) pendingTransactions_.push(std::move(*intent.transaction));
            if (intent.kind == arrange::core::InputIntentKind::DiagnosticsEvent) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Accessibility,
                    arrange::core::InvalidationSource::Diagnostics,
                    "diagnostics",
                    intent.reason.empty() ? "diagnostics event" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::AnimationFrame) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::EventSlot,
                    arrange::core::InvalidationSource::InputIntent,
                    "animationFrame",
                    intent.reason.empty() ? "animation frame callback" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::Pointer) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::HitTest,
                    arrange::core::InvalidationSource::InputIntent,
                    intent.target ? "pointer:target" : "pointer",
                    intent.reason.empty() ? "pointer input" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::Wheel) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Layout,
                    arrange::core::InvalidationSource::InputIntent,
                    intent.eventSlot ? "wheel:eventSlot" : "wheel",
                    intent.reason.empty() ? "wheel scroll input" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::Key) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Focus,
                    arrange::core::InvalidationSource::InputIntent,
                    intent.target ? "key:target" : "key",
                    intent.reason.empty() ? "key input" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::TextInput) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Paint,
                    arrange::core::InvalidationSource::InputIntent,
                    intent.target ? "textInput:target" : "textInput",
                    intent.reason.empty() ? "text input" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::ImeComposition) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Paint,
                    arrange::core::InvalidationSource::InputIntent,
                    intent.target ? "ime:target" : "ime",
                    intent.reason.empty() ? "ime composition" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::PackageLoad ||
                     intent.kind == arrange::core::InputIntentKind::Reload ||
                     intent.kind == arrange::core::InputIntentKind::HmrReload) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Structure,
                    arrange::core::InvalidationSource::InputIntent,
                    "package",
                    intent.reason.empty() ? "package intent" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::Resize) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Layout,
                    arrange::core::InvalidationSource::Resize,
                    "viewport",
                    intent.reason.empty() ? "viewport resize" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::ResourceReady) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Resource,
                    arrange::core::InvalidationSource::Resource,
                    "resource",
                    intent.reason.empty() ? "resource ready" : intent.reason);
            }
            else if (intent.kind == arrange::core::InputIntentKind::ResourceFailed) {
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Resource,
                    arrange::core::InvalidationSource::Resource,
                    "resource",
                    intent.reason.empty() ? "resource failed" : intent.reason);
                scene_.tree().recordSceneInvalidation(
                    arrange::core::DirtyFlag::Accessibility,
                    arrange::core::InvalidationSource::Diagnostics,
                    "diagnostics",
                    intent.reason.empty() ? "resource failed" : intent.reason);
            }
            if (intent.needsFullFallback) {
                scene_.tree().requestFullFallback(intent.reason.empty() ? "input intent requested full fallback" : intent.reason);
            }
        }

        const auto hasPending = pendingTransactions_.hasPending();
        if (!hasPending && !framePipelineRequested && scene_.invalidationSnapshot().empty()) return {};

        auto transaction = hasPending
                               ? pendingTransactions_.take()
                               : std::optional<arrange::core::MutationTransaction>{};
        auto result = pipeline_.run(scene_, root, constraints, transaction ? &*transaction : nullptr, framePipelineRequested, publishedFrame_);
        if (result.error) {
            return result;
        }
        return result;
    }

    void ScenePipelineState::setOverlayDrawOps(
        std::vector<arrange::core::DrawOp> ops,
        std::optional<arrange::core::NodeId> focusedInputNode,
        float focusedInputViewportX) {
        arrange::core::Rect repaintBounds;
        auto hasRepaintBounds = false;
        includeOpBounds(publishedFrame_.content.overlayDrawOps, hasRepaintBounds, repaintBounds);
        includeOpBounds(ops, hasRepaintBounds, repaintBounds);
        publishedFrame_.content.overlayDrawOps = std::move(ops);
        publishedFrame_.content.focusedInputNode = focusedInputNode;
        publishedFrame_.content.focusedInputViewportX = focusedInputViewportX;
        publishedFrame_.changes.overlayDrawOpsChanged = true;
        publishedFrame_.changes.hasOverlayRepaintBounds = hasRepaintBounds;
        publishedFrame_.changes.overlayRepaintBounds = repaintBounds;
    }

    void ScenePipelineState::setDiagnosticsDrawOps(
        std::vector<arrange::core::DrawOp> errorOps,
        std::vector<arrange::core::DrawOp> badgeOps,
        std::vector<arrange::core::DrawOp> toastOps) {
        arrange::core::Rect repaintBounds;
        auto hasRepaintBounds = false;
        includeOpBounds(publishedFrame_.content.diagnosticsErrorDrawOps, hasRepaintBounds, repaintBounds);
        includeOpBounds(publishedFrame_.content.diagnosticsBadgeDrawOps, hasRepaintBounds, repaintBounds);
        includeOpBounds(publishedFrame_.content.diagnosticsToastDrawOps, hasRepaintBounds, repaintBounds);
        includeOpBounds(errorOps, hasRepaintBounds, repaintBounds);
        includeOpBounds(badgeOps, hasRepaintBounds, repaintBounds);
        includeOpBounds(toastOps, hasRepaintBounds, repaintBounds);

        publishedFrame_.content.diagnosticsErrorDrawOps = std::move(errorOps);
        publishedFrame_.content.diagnosticsBadgeDrawOps = std::move(badgeOps);
        publishedFrame_.content.diagnosticsToastDrawOps = std::move(toastOps);
        publishedFrame_.changes.diagnosticsDrawOpsChanged = true;
        publishedFrame_.changes.hasDiagnosticsRepaintBounds = hasRepaintBounds;
        publishedFrame_.changes.diagnosticsRepaintBounds = repaintBounds;
    }
} // namespace arrange::juce
