#include <arrange/core/SceneFramePipeline.h>

#include <exception>
#include <chrono>
#include <utility>

namespace arrange::core {
    SceneFramePipeline::SceneFramePipeline(LayoutEngine layoutEngine) : layout_(std::move(layoutEngine)), drawOpsBuilder_(layout_.textLayoutService()) {}

    FramePlan SceneFramePipeline::planFrame(const NativeScene& scene, NodeId root, bool hasTransaction, bool framePipelineRequested) const {
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

        plan.measure = invalidation.affects(DirtyFlag::Structure) || invalidation.affects(DirtyFlag::Layout);
        plan.measure = plan.measure || plan.fullFallback;
        plan.layout = plan.measure || invalidation.affects(DirtyFlag::Placement);
        plan.buildPaint = plan.layout || invalidation.affects(DirtyFlag::Paint) || invalidation.affects(DirtyFlag::Transform) || invalidation.affects(DirtyFlag::Resource) || plan.fullFallback;
        plan.buildHitTest = plan.layout || invalidation.affects(DirtyFlag::HitTest) || invalidation.affects(DirtyFlag::Transform);
        plan.buildDiagnostics = invalidation.affects(DirtyFlag::Accessibility);
        plan.publishFrame = plan.measure || plan.layout || plan.buildPaint || plan.buildHitTest || plan.buildDiagnostics || invalidation.affects(DirtyFlag::EventSlot) || invalidation.affects(DirtyFlag::Focus) || plan.fullFallback;
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

    SceneFramePipelineResult SceneFramePipeline::run(NativeScene& scene, NodeId root, Constraints constraints, const MutationTransaction* transaction, bool framePipelineRequested, PublishedFrame& publishedFrame, const FrameFinalizer& finalize, double timeMillis) {
        SceneFramePipelineResult result;
        (void)layout_.takeScrollUpdates();
        result.ran = true;
        // 所有构建写入候选状态。任一阶段失败都保留上次成功 scene/PublishedFrame
        auto candidateScene = scene;
        counters_.candidateNodesCopied += scene.tree().size();
        auto candidateFrame = publishedFrame;
        candidateFrame.changes = {};
        candidateFrame.error.reset();
        if (transaction) ++counters_.submissions;
        try {
            if (transaction) candidateScene.applyUncommitted(*transaction);
            recordPhase(result.phases, FramePhase::ApplyMutations, transaction != nullptr, transaction ? "applied structural and typed input submission" : "no submission");
            auto& tree = candidateScene.tree();
            tree.advanceAnimations(timeMillis);
            if (tree.contains(root) && tree.node(root).measurementValid && tree.node(root).measuredConstraints != constraints) tree.recordSceneInvalidation(DirtyFlag::Layout, InvalidationSource::Resize, "constraints", "root constraints changed");
            result.plan = planFrame(candidateScene, root, transaction != nullptr, framePipelineRequested);
            candidateFrame.dirty = candidateScene.dirtySnapshot();
            result.invalidation = candidateScene.takeInvalidation();
            if (result.plan.fullFallback) tree.recordSceneInvalidation(DirtyFlag::Layout, InvalidationSource::NativeState, "fallback", result.plan.fallbackReason);
            if (!tree.contains(root)) {
                candidateFrame.content.scenePaint = {};
                candidateFrame.content.overlayDrawOps.clear();
                candidateFrame.content.focusedInputNode.reset();
                candidateFrame.content.focusedInputModifier = {};
            } else {
                if (result.plan.measure) {
                    const auto started = std::chrono::steady_clock::now();
                    layout_.resetCounters();
                    layout_.measure(tree, root, constraints);
                    ++counters_.measures;
                    counters_.measureMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                    const auto work = layout_.counters();
                    counters_.nativeAnimationSamples += work.animationSamples;
                    counters_.layoutWork.measuredNodes += work.measuredNodes;
                    counters_.layoutWork.measureCacheHits += work.measureCacheHits;
                    if (work.measureCacheHits == 0) {
                        ++counters_.fullLayouts;
                        counters_.lastFullLayoutReason = result.plan.fullFallback ? result.plan.fallbackReason : "all reachable measurement inputs invalid or uncached";
                    }
                }
                recordPhase(result.phases, FramePhase::Measure, result.plan.measure, result.plan.measure ? "measured root subtree" : "retained measured sizes");
                if (result.plan.layout) {
                    const auto started = std::chrono::steady_clock::now();
                    layout_.resetCounters();
                    layout_.place(tree, root);
                    ++counters_.placements;
                    counters_.placeMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                    counters_.layoutWork.placedNodes += layout_.counters().placedNodes;
                    counters_.layoutWork.placeCacheHits += layout_.counters().placeCacheHits;
                }
                recordPhase(result.phases, FramePhase::Layout, result.plan.layout, result.plan.layout ? "placed root subtree" : "retained placement");
                if (result.plan.buildPaint) {
                    const auto started = std::chrono::steady_clock::now();
                    candidateFrame.content.scenePaint = drawOpsBuilder_.build(tree, root, counters_.paintWork);
                    ++counters_.paintBuilds;
                    counters_.paintBuildMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                }
                recordPhase(result.phases, FramePhase::BuildPaint, result.plan.buildPaint, result.plan.buildPaint ? "构建共享绘制片段" : "复用已发布绘制片段");
            }
            if (result.plan.buildHitTest || !tree.contains(root)) {
                const auto started = std::chrono::steady_clock::now();
                candidateFrame.content.hitTest = std::make_shared<const HitTestSnapshot>(buildCachedHitTestSnapshot(tree, root, counters_.hitWork));
                ++counters_.hitBuilds;
                counters_.hitBuildMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                recordPhase(result.phases, FramePhase::BuildHitTest, true, "built immutable hit regions and constraints");
            } else
                recordPhase(result.phases, FramePhase::BuildHitTest, false, "retained hit snapshot");
            if (finalize) finalize(candidateScene, candidateFrame);
            candidateFrame.plan = result.plan;
            finishCandidate(publishedFrame, candidateFrame);
            result.plan = candidateFrame.plan;
            recordPhase(result.phases, FramePhase::BuildDiagnostics, result.plan.buildDiagnostics, result.plan.buildDiagnostics ? "diagnostics invalidated" : "diagnostics unchanged");
            recordPhase(result.phases, FramePhase::PublishFrame, result.plan.publishFrame, result.plan.publishFrame ? "published consistent scene and frame" : "no visual publication needed");
            recordPhase(result.phases, FramePhase::PassivePaint, result.plan.passivePaint, "paint only consumes published content");
            candidateFrame.invalidation = result.invalidation;
            candidateFrame.plan = result.plan;
            candidateFrame.phases = result.phases;
            if (result.plan.publishFrame) ++counters_.publications;
            candidateScene.clearDirty();
            scene = std::move(candidateScene);
            publishedFrame = std::move(candidateFrame);
            result.scrollUpdates = layout_.takeScrollUpdates();
        } catch (const std::exception& exception) {
            ++counters_.failedSubmissions;
            result.error = exception.what();
            // 错误通过结果交给宿主诊断；不覆盖先前已发布的图像或输入几何
        }
        return result;
    }

    void SceneFramePipeline::finishCandidate(const PublishedFrame& previous, PublishedFrame& candidate) {
        const auto& before = previous.content;
        const auto& after = candidate.content;
        candidate.changes.overlayDrawOpsChanged = before.overlayDrawOps != after.overlayDrawOps || before.focusedInputNode != after.focusedInputNode || before.focusedInputModifier != after.focusedInputModifier || before.focusedInputViewportX != after.focusedInputViewportX;
        candidate.changes.diagnosticsDrawOpsChanged = before.diagnosticsErrorDrawOps != after.diagnosticsErrorDrawOps || before.diagnosticsBadgeDrawOps != after.diagnosticsBadgeDrawOps || before.diagnosticsToastDrawOps != after.diagnosticsToastDrawOps || before.errorFrame != after.errorFrame;
        // Transformed overlays require the same full viewport repaint as transformed scene ops.
        // Local untransformed rectangles cannot safely bound them.
        if (candidate.changes.overlayDrawOpsChanged || candidate.changes.diagnosticsDrawOpsChanged) {
            candidate.plan.publishFrame = true;
            candidate.plan.passivePaint = true;
        }
        candidate.revision = previous.revision + (candidate.plan.publishFrame ? 1 : 0);
    }

    bool SceneFramePipeline::publishRetained(const NativeScene& scene, PublishedFrame& publishedFrame, const FrameFinalizer& finalize) {
        auto candidate = publishedFrame;
        candidate.changes = {};
        candidate.plan = {};
        candidate.phases.clear();
        candidate.dirty = {};
        candidate.invalidation = {};
        finalize(scene, candidate);
        finishCandidate(publishedFrame, candidate);
        if (!candidate.plan.publishFrame) return false;
        recordPhase(candidate.phases, FramePhase::BuildDiagnostics, true, "finalized retained scene content");
        recordPhase(candidate.phases, FramePhase::PublishFrame, true, "published retained scene with finalized attachments");
        publishedFrame = std::move(candidate);
        ++counters_.publications;
        return true;
    }

    void SceneFramePipeline::recordPhase(std::vector<PhaseExecution>& phases, FramePhase phase, bool ran, std::string reason) {
        phases.push_back({phase, ran, std::move(reason)});
    }
}  // namespace arrange::core
