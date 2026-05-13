#pragma once

#include "Geometry.h"
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
        std::vector<DrawOp> drawOps;
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
        bool hasDiagnosticsRepaintBounds = false;
        Rect diagnosticsRepaintBounds;
        bool overlayDrawOpsChanged = false;
        bool hasOverlayRepaintBounds = false;
        Rect overlayRepaintBounds;
    };

    struct PublishedFrame {
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
            PublishedFrame& publishedFrame);

    private:
        static void recordPhase(std::vector<PhaseExecution>& phases, FramePhase phase, bool ran, std::string reason);

        LayoutEngine layout_;
        DrawOpsBuilder drawOpsBuilder_;
    };
} // namespace arrange::core



