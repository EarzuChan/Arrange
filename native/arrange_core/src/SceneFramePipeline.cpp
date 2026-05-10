#include <arrange/core/SceneFramePipeline.h>

#include <exception>
#include <utility>

namespace arrange::core {
    SceneFramePipeline::SceneFramePipeline(LayoutEngine layoutEngine) : layout_(std::move(layoutEngine)) {}

    FramePlan SceneFramePipeline::planFrame(
        const NativeScene& scene,
        NodeId root,
        bool hasTransaction,
        bool framePipelineRequested) const {
        FramePlan plan;
        plan.applyMutations = hasTransaction;

        const auto invalidation = scene.invalidationSnapshot();
        const auto dirty = scene.dirtySnapshot();
        const auto hasScene = scene.contains(root);
        const auto hasDirty = dirty.nodeCount > 0 || !invalidation.empty();

        plan.fullFallback = invalidation.needsFullFallback;
        plan.fallbackReason = invalidation.fallbackReason;

        if (!hasScene && (hasTransaction || framePipelineRequested || hasDirty || plan.fullFallback)) {
            plan.publishFrame = true;
            plan.passivePaint = true;
            plan.reasons.push_back("root unavailable; publish empty frame");
            return plan;
        }

        plan.measure =
            invalidation.affects(DirtyFlag::Structure) ||
            invalidation.affects(DirtyFlag::Layout);
        plan.layout = plan.measure;
        plan.buildPaint = plan.measure ||
            invalidation.affects(DirtyFlag::Paint) ||
            invalidation.affects(DirtyFlag::Transform) ||
            invalidation.affects(DirtyFlag::Resource) ||
            plan.fullFallback;
        plan.buildHitTest = plan.measure ||
            invalidation.affects(DirtyFlag::HitTest) ||
            invalidation.affects(DirtyFlag::Transform);
        plan.buildDiagnostics = invalidation.affects(DirtyFlag::Accessibility);
        plan.publishFrame = plan.measure || plan.layout || plan.buildPaint || plan.buildHitTest || plan.buildDiagnostics || plan.fullFallback;
        plan.passivePaint = plan.buildPaint || plan.fullFallback;

        if (hasTransaction) plan.reasons.push_back("mutation transaction pending");
        if (framePipelineRequested) plan.reasons.push_back("frame pipeline requested");
        if (invalidation.affects(DirtyFlag::Layout)) plan.reasons.push_back("layout dirty");
        if (invalidation.affects(DirtyFlag::Paint)) plan.reasons.push_back("paint dirty");
        if (invalidation.affects(DirtyFlag::HitTest)) plan.reasons.push_back("hit-test dirty");
        if (invalidation.affects(DirtyFlag::Transform)) plan.reasons.push_back("transform dirty");
        if (invalidation.affects(DirtyFlag::Resource)) plan.reasons.push_back("resource dirty");
        if (invalidation.affects(DirtyFlag::EventSlot)) plan.reasons.push_back("event slot dirty");
        if (plan.fullFallback && !plan.fallbackReason.empty()) plan.reasons.push_back(plan.fallbackReason);
        return plan;
    }

    SceneFramePipelineResult SceneFramePipeline::run(
        NativeScene& scene,
        NodeId root,
        Constraints constraints,
        const MutationTransaction* transaction,
        bool framePipelineRequested,
        PublishedFrame& publishedFrame) {
        SceneFramePipelineResult result;
        result.ran = true;
        result.phases.clear();
        auto retainedContent = std::move(publishedFrame.content);
        publishedFrame.changes = {};
        publishedFrame.dirty = {};
        publishedFrame.invalidation = {};
        publishedFrame.plan = {};
        publishedFrame.phases.clear();
        publishedFrame.error.reset();
        publishedFrame.content = std::move(retainedContent);

        if (transaction != nullptr) {
            try {
                scene.apply(*transaction);
                recordPhase(result.phases, FramePhase::ApplyMutations, true, "applied pending MutationTransaction");
            }
            catch (const std::exception& exception) {
                result.error = exception.what();
                publishedFrame.content.drawOps.clear();
                publishedFrame.content.overlayDrawOps.clear();
                publishedFrame.content.diagnosticsErrorDrawOps.clear();
                publishedFrame.content.diagnosticsBadgeDrawOps.clear();
                publishedFrame.content.diagnosticsToastDrawOps.clear();
                publishedFrame.changes.hasDiagnosticsRepaintBounds = false;
                result.invalidation = scene.takeInvalidation();
                result.plan = planFrame(scene, root, true, framePipelineRequested);
                publishedFrame.error = result.error;
                publishedFrame.dirty = scene.dirtySnapshot();
                publishedFrame.invalidation = result.invalidation;
                publishedFrame.plan = result.plan;
                publishedFrame.phases = result.phases;
                return result;
            }
        }
        else {
            recordPhase(result.phases, FramePhase::ApplyMutations, false, "no pending MutationTransaction");
        }

        auto& tree = scene.tree();
        result.plan = planFrame(scene, root, transaction != nullptr, framePipelineRequested);
        const auto dirty = scene.dirtySnapshot();
        result.invalidation = scene.takeInvalidation();

        if (!tree.contains(root)) {
            publishedFrame.content.drawOps.clear();
            publishedFrame.content.overlayDrawOps.clear();
            publishedFrame.dirty = dirty;
            publishedFrame.invalidation = result.invalidation;
            publishedFrame.plan = result.plan;
            publishedFrame.phases = result.phases;
            recordPhase(publishedFrame.phases, FramePhase::PublishFrame, true, "root unavailable; published empty frame");
            recordPhase(publishedFrame.phases, FramePhase::PassivePaint, result.plan.passivePaint, result.plan.passivePaint ? "passive paint requested for empty frame" : "no passive paint needed");
            scene.clearDirty();
            result.phases = publishedFrame.phases;
            return result;
        }

        if (result.plan.measure || result.plan.layout) {
            layout_.layout(tree, root, constraints);
            recordPhase(result.phases, FramePhase::Measure, true, "layout engine measured root subtree");
            recordPhase(result.phases, FramePhase::Layout, true, "layout engine placed root subtree");
        }
        else {
            recordPhase(result.phases, FramePhase::Measure, false, "no layout-affecting invalidation");
            recordPhase(result.phases, FramePhase::Layout, false, "no layout-affecting invalidation");
        }

        if (result.plan.buildPaint) {
            publishedFrame.content.drawOps = drawOpsBuilder_.collect(tree, root);
            recordPhase(result.phases, FramePhase::BuildPaint, true, "rebuilt DrawOps from dirty frame plan");
        }
        else {
            recordPhase(result.phases, FramePhase::BuildPaint, false, "no paint-affecting invalidation");
        }

        recordPhase(result.phases, FramePhase::BuildHitTest, result.plan.buildHitTest, result.plan.buildHitTest ? "hit-test model invalidated" : "hit-test model unchanged");
        recordPhase(result.phases, FramePhase::BuildDiagnostics, result.plan.buildDiagnostics, result.plan.buildDiagnostics ? "diagnostics invalidated" : "diagnostics unchanged");
        recordPhase(result.phases, FramePhase::PublishFrame, result.plan.publishFrame, result.plan.publishFrame ? "published frame for passive paint" : "no frame publication needed");
        recordPhase(result.phases, FramePhase::PassivePaint, result.plan.passivePaint, result.plan.passivePaint ? "passive paint consumes PublishedFrame" : "no passive paint needed");

        publishedFrame.dirty = dirty;
        publishedFrame.invalidation = result.invalidation;
        publishedFrame.plan = result.plan;
        publishedFrame.phases = result.phases;
        publishedFrame.error = result.error;
        scene.clearDirty();
        return result;
    }

    void SceneFramePipeline::recordPhase(std::vector<PhaseExecution>& phases, FramePhase phase, bool ran, std::string reason) {
        phases.push_back({phase, ran, std::move(reason)});
    }
} // namespace arrange::core


