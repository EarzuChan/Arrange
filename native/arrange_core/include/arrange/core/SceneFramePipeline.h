#pragma once

#include "Geometry.h"
#include "HitTest.h"
#include <memory>
#include "Invalidation.h"
#include "Layout.h"
#include "MutationTransaction.h"
#include "NativeScene.h"
#include "Paint.h"
#include "LayoutTree.h"

#include <optional>
#include <string>
#include <vector>

namespace arrange::core {
    enum class FramePhase {
        ApplyMutations,
        Measure,
        Layout,
        BuildPaint,
        BuildHitTest,
        BuildDiagnostics,
        PublishFrame,
        PassivePaint,
    };

    struct FramePlan {
        bool applyMutations = false;
        bool measure = false;
        bool layout = false;
        bool buildPaint = false;
        bool buildHitTest = false;
        bool buildDiagnostics = false;
        bool publishFrame = false;
        bool passivePaint = false;
        bool fullFallback = false;
        std::string fallbackReason;
        std::vector<std::string> reasons;
    };

    struct PhaseExecution {
        FramePhase phase = FramePhase::ApplyMutations;
        bool ran = false;
        std::string reason;
    };

    struct PublishedFrameContent {
        std::shared_ptr<const HitTestSnapshot> hitTest = std::make_shared<const HitTestSnapshot>();
        PlacedPaintFragment scenePaint;
        std::vector<DrawOp> overlayDrawOps;
        std::vector<DrawOp> diagnosticsErrorDrawOps;
        std::vector<DrawOp> diagnosticsBadgeDrawOps;
        std::vector<DrawOp> diagnosticsToastDrawOps;
        std::optional<NodeId> focusedInputNode;
        float focusedInputViewportX = 0.0f;
        std::optional<std::string> errorFrame;
    };

    struct FrameChangeSet {
        bool diagnosticsDrawOpsChanged = false;
        bool overlayDrawOpsChanged = false;
    };

    struct FrameExecutionCounters {
        std::uint64_t submissions = 0;
        std::uint64_t failedSubmissions = 0;
        std::uint64_t measures = 0;
        std::uint64_t placements = 0;
        std::uint64_t paintBuilds = 0;
        std::uint64_t hitBuilds = 0;
        std::uint64_t publications = 0;
        LayoutWorkCounters layoutWork;
        PaintWorkCounters paintWork;
        HitWorkCounters hitWork;
        std::uint64_t nativeAnimationSamples = 0;
        std::uint64_t candidateNodesCopied = 0;
        double measureMillis = 0;
        double placeMillis = 0;
        double paintBuildMillis = 0;
        double hitBuildMillis = 0;
        std::uint64_t fullLayouts = 0;
        std::string lastFullLayoutReason;
    };

    struct PublishedFrame {
        std::uint64_t revision = 0;
        PublishedFrameContent content;
        FrameChangeSet changes;
        DirtySnapshot dirty;
        InvalidationSnapshot invalidation;
        FramePlan plan;
        std::vector<PhaseExecution> phases;
        std::optional<std::string> error;
    };

    struct SceneFramePipelineResult {
        bool ran = false;
        std::optional<std::string> error;
        FramePlan plan;
        InvalidationSnapshot invalidation;
        std::vector<PhaseExecution> phases;
    };

    using FrameFinalizer = std::function<void(const NativeScene&, PublishedFrame&)>;

    class SceneFramePipeline {
    public:
        explicit SceneFramePipeline(LayoutEngine layoutEngine = LayoutEngine());

        [[nodiscard]] FramePlan planFrame(
            const NativeScene& scene,
            NodeId root,
            bool hasTransaction,
            bool framePipelineRequested) const;

        [[nodiscard]] SceneFramePipelineResult run(
            NativeScene& scene,
            NodeId root,
            Constraints constraints,
            const MutationTransaction* transaction,
            bool framePipelineRequested,
            PublishedFrame& publishedFrame,
            const FrameFinalizer& finalize = {}, double timeMillis = 0);

        // Diagnostics/interaction can publish against retained geometry without replaying JS.
        bool publishRetained(const NativeScene& scene, PublishedFrame& publishedFrame, const FrameFinalizer& finalize);

        const FrameExecutionCounters& counters() const noexcept { return counters_; }

    private:
        FrameExecutionCounters counters_;
        void finishCandidate(const PublishedFrame& previous, PublishedFrame& candidate);
        static void recordPhase(std::vector<PhaseExecution>& phases, FramePhase phase, bool ran, std::string reason);

        LayoutEngine layout_;
        DrawOpsBuilder drawOpsBuilder_;
    };
} // namespace arrange::core



