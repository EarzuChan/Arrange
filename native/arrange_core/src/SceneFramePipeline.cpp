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

        if (!hasScene && (hasTransaction || framePipelineRequested || hasDirty || plan.fullFallback)) {
            plan.publishFrame = true;
            plan.passivePaint = true;
            return plan;
        }

        plan.measure = invalidation.affects(DirtyFlag::Structure) || invalidation.affects(DirtyFlag::Layout);
        plan.measure = plan.measure || plan.fullFallback;
        plan.layout = plan.measure || invalidation.affects(DirtyFlag::Placement);
        plan.buildPaint = plan.layout || invalidation.affects(DirtyFlag::Paint) || invalidation.affects(DirtyFlag::Transform) || invalidation.affects(DirtyFlag::Resource) || plan.fullFallback;
        plan.buildHitTest = plan.layout || invalidation.affects(DirtyFlag::HitTest) || invalidation.affects(DirtyFlag::Transform);
        plan.buildDiagnostics = invalidation.affects(DirtyFlag::Diagnostics);
        plan.publishFrame = plan.measure || plan.layout || plan.buildPaint || plan.buildHitTest || plan.buildDiagnostics || invalidation.affects(DirtyFlag::EventSlot) || invalidation.affects(DirtyFlag::Focus) || plan.fullFallback;
        plan.passivePaint = plan.buildPaint || plan.fullFallback;

        return plan;
    }

    SceneFramePipelineResult SceneFramePipeline::run(NativeScene& scene, NodeId root, Constraints constraints, const MutationTransaction* transaction, bool framePipelineRequested, PublishedFrame& publishedFrame, const FrameFinalizer& finalize, double timeMillis, const FramePreparation& prepare) {
        SceneFramePipelineResult result;
        (void)layout_.takeScrollUpdates();
        result.ran = true;
        // 所有构建原地写入 scene，写入日志保存首次写入前的原值；任一阶段失败都回滚到上次成功 scene/PublishedFrame
        scene.beginJournal();
        auto candidateFrame = publishedFrame;
        candidateFrame.changes = {};
        candidateFrame.error.reset();
        candidateFrame.content.viewport = {constraints.maxWidth, constraints.maxHeight};
        if (transaction) ++counters_.submissions;
        result.rearrange = transaction ? transaction->rearrange : nullptr;
        layout_.setMaterializer(prepare.materialize ? LayoutMaterializer{[&](NodeId id, const std::vector<int>& indices) {
            auto continuation = prepare.materialize(id, indices);
            if (result.rearrange && continuation.rearrange != result.rearrange) throw std::runtime_error("Layout 子组合必须继续同一候选事务");
            if (!result.rearrange) result.rearrange = continuation.rearrange;
            scene.validateLayoutMaterialization(id, continuation);
            scene.applyUncommitted(continuation);
        }}
                                                    : LayoutMaterializer{});
        try {
            if (transaction) scene.applyUncommitted(*transaction);
            result.phases.record(FramePhase::ApplyMutations, transaction != nullptr);
            auto& tree = scene.tree();
            if (prepare.interaction) prepare.interaction(tree);
            tree.advanceAnimations(timeMillis);
            if (tree.contains(root) && tree.node(root).measurementValid && tree.node(root).measuredConstraints != constraints) tree.invalidateViewport();
            result.plan = planFrame(scene, root, transaction != nullptr, framePipelineRequested);
            candidateFrame.dirty = scene.dirtySnapshot();
            result.invalidation = scene.takeInvalidation();
            if (result.plan.fullFallback) tree.invalidateScene(DirtyFlag::Layout);
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
                    if (work.measureCacheHits == 0) ++counters_.fullLayouts;
                }
                result.phases.record(FramePhase::Measure, result.plan.measure);
                if (result.plan.layout) {
                    const auto started = std::chrono::steady_clock::now();
                    layout_.resetCounters();
                    layout_.place(tree, root);
                    ++counters_.placements;
                    counters_.placeMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                    counters_.layoutWork.placedNodes += layout_.counters().placedNodes;
                    counters_.layoutWork.placeCacheHits += layout_.counters().placeCacheHits;
                }
                result.phases.record(FramePhase::Layout, result.plan.layout);
                if (result.plan.buildPaint) {
                    if (prepare.draw) prepare.draw(scene);
                    const auto started = std::chrono::steady_clock::now();
                    candidateFrame.content.scenePaint = drawOpsBuilder_.build(tree, root, counters_.paintWork);
                    ++counters_.paintBuilds;
                    counters_.paintBuildMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                }
                result.phases.record(FramePhase::BuildPaint, result.plan.buildPaint);
            }
            if (result.plan.buildHitTest || !tree.contains(root)) {
                const auto started = std::chrono::steady_clock::now();
                candidateFrame.content.hitTest = std::make_shared<const HitTestSnapshot>(buildCachedHitTestSnapshot(tree, root, counters_.hitWork));
                ++counters_.hitBuilds;
                counters_.hitBuildMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
                result.phases.record(FramePhase::BuildHitTest, true);
            } else
                result.phases.record(FramePhase::BuildHitTest, false);
            if (finalize) finalize(scene, candidateFrame);
            candidateFrame.plan = result.plan;
            finishCandidate(publishedFrame, candidateFrame);
            result.plan = candidateFrame.plan;
            result.phases.record(FramePhase::BuildDiagnostics, result.plan.buildDiagnostics);
            result.phases.record(FramePhase::PublishFrame, result.plan.publishFrame);
            result.phases.record(FramePhase::PassivePaint, result.plan.passivePaint);
            candidateFrame.invalidation = result.invalidation;
            candidateFrame.plan = result.plan;
            candidateFrame.phases = result.phases;
            if (result.plan.publishFrame) ++counters_.publications;
            counters_.candidateNodesCopied += scene.tree().journaledNodes();
            scene.commitJournal();
            scene.clearDirty();
            publishedFrame = std::move(candidateFrame);
            result.scrollUpdates = layout_.takeScrollUpdates();
        } catch (const std::exception& exception) {
            ++counters_.failedSubmissions;
            counters_.candidateNodesCopied += scene.tree().journaledNodes();
            scene.rollbackJournal();
            result.error = exception.what();
            // 错误通过结果交给宿主诊断；不覆盖先前已发布的图像或输入几何
        } catch (...) {
            scene.rollbackJournal();
            layout_.setMaterializer({});
            throw;
        }
        layout_.setMaterializer({});
        return result;
    }

    void SceneFramePipeline::finishCandidate(const PublishedFrame& previous, PublishedFrame& candidate) {
        const auto& before = previous.content;
        const auto& after = candidate.content;
        candidate.changes.overlayDrawOpsChanged = before.overlayDrawOps != after.overlayDrawOps || before.focusedInputNode != after.focusedInputNode || before.focusedInputModifier != after.focusedInputModifier || before.focusedInputViewportX != after.focusedInputViewportX;
        candidate.changes.diagnosticsDrawOpsChanged = before.diagnosticsErrorDrawOps != after.diagnosticsErrorDrawOps || before.diagnosticsBadgeDrawOps != after.diagnosticsBadgeDrawOps || before.diagnosticsToastDrawOps != after.diagnosticsToastDrawOps || before.errorFrame != after.errorFrame;
        // 叠加层变化即使场景未重建也要发布并重绘
        if (candidate.changes.overlayDrawOpsChanged || candidate.changes.diagnosticsDrawOpsChanged) {
            candidate.plan.publishFrame = true;
            candidate.plan.passivePaint = true;
        }
        if (candidate.plan.passivePaint) {
            RepaintDamage damage;
            // 首帧、显式整块回退、视口变化、错误屏与诊断叠加层变化都整块重绘
            if (previous.revision == 0 || candidate.plan.fullFallback || before.viewport != after.viewport || candidate.changes.diagnosticsDrawOpsChanged) damage.markFull();
            damage.compareScene(before.scenePaint, after.scenePaint);
            // 编辑命令在 TextField 叶项原位重放，范围取新旧聚焦叶项
            if (candidate.changes.overlayDrawOpsChanged) {
                damage.addInputField(before.scenePaint, before.focusedInputModifier);
                damage.addInputField(after.scenePaint, after.focusedInputModifier);
            }
            candidate.changes.repaint = damage.finish(after.viewport);
        }
        candidate.revision = previous.revision + (candidate.plan.publishFrame ? 1 : 0);
    }

    bool SceneFramePipeline::publishRetained(const NativeScene& scene, PublishedFrame& publishedFrame, const FrameFinalizer& finalize) {
        auto candidate = publishedFrame;
        candidate.changes = {};
        candidate.plan = {};
        candidate.phases = {};
        candidate.dirty = {};
        candidate.invalidation = {};
        finalize(scene, candidate);
        finishCandidate(publishedFrame, candidate);
        if (!candidate.plan.publishFrame) return false;
        candidate.phases.record(FramePhase::BuildDiagnostics, true);
        candidate.phases.record(FramePhase::PublishFrame, true);
        publishedFrame = std::move(candidate);
        ++counters_.publications;
        return true;
    }
}
