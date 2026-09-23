#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/Geometry.h>
#include <arrange/core/InputIntent.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/NativeScene.h>
#include <arrange/core/LayoutNode.h>
#include <arrange/core/Paint.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/RearrangeHost.h>
#include <arrange/juce/FramePlanner.h>
#include <arrange/juce/ScenePipelineState.h>

#if ARRANGE_WITH_QUICKJS_NG
#include <arrange/quickjs/QuickJsScriptHost.h>
#endif

#include <juce_events/juce_events.h>
#include <mutex>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct RuntimeStepResult {
        bool changed = false;
        bool ok = true;
        std::string error;
    };

    struct RuntimePipelineRunResult {
        bool changed = false;
        std::optional<std::string> error;
    };

    enum class RuntimeFrameErrorPhase {
        None,
        Event,
        Animation,
        Pipeline,
    };

    struct RuntimeFramePumpResult {
        bool changed = false;
        bool pipelineRan = false;
        bool ok = true;
        RuntimeFrameErrorPhase errorPhase = RuntimeFrameErrorPhase::None;
        std::string error;
    };

    class ArrangeRuntime final : private ::juce::AsyncUpdater {
       public:
        explicit ArrangeRuntime(arrange::core::SceneFramePipeline pipeline = arrange::core::SceneFramePipeline());

        ~ArrangeRuntime();
        void reset();
        RuntimeStepResult semanticCheckpoint(double nowMillis);

        void setWorkAvailable(std::function<void()> callback) {
            workAvailable_ = std::move(callback);
        }

        void requestReload() noexcept {
            reloadRequested_ = true;
        }

        [[nodiscard]] bool consumeReloadRequest() noexcept;

        void suspend() noexcept {
            suspended_ = true;
        }

#if ARRANGE_WITH_QUICKJS_NG
        void setScriptHost(std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host) noexcept;
        quickjs::CallbackInvokeResult applyHotUpdate(const quickjs::LiveModuleSnapshot& snapshot, const quickjs::HotMessage& message);
        std::vector<quickjs::HotMessage> takeHotMessages();
#endif

        void requestFramePipelineRun() noexcept;
        [[nodiscard]] bool framePipelineRunRequested() const noexcept;

        void enqueue(arrange::core::MutationTransaction transaction);
        void enqueueIntent(arrange::core::InputIntent intent);
        [[nodiscard]] bool hasPendingIntents() const noexcept;
        [[nodiscard]] bool hasPendingTransactions() const noexcept;
        void clearPendingTransactions() noexcept;

        void enqueueEvent(const arrange::core::EventSlotId& slot);
        void enqueueScrollSnapshotEvent(const arrange::core::EventSlotId& slot, const arrange::core::ScrollResult& result);
        void enqueueStringEvent(const arrange::core::EventSlotId& slot, std::string value);

        [[nodiscard]] bool hasPendingEvents() const noexcept;

        [[nodiscard]] bool hasPendingVisualWork() const noexcept;
        [[nodiscard]] bool hasPendingFrameWork() const noexcept;

        [[nodiscard]] RuntimeFramePumpResult pumpFrame(arrange::core::NodeId root, arrange::core::Constraints constraints, double nowMillis, const arrange::core::FrameFinalizer& finalize = {});

        [[nodiscard]] arrange::core::NativeScene& scene() noexcept {
            return pipelineState_.scene();
        }

        [[nodiscard]] const arrange::core::NativeScene& scene() const noexcept {
            return pipelineState_.scene();
        }

        [[nodiscard]] const arrange::core::PublishedFrame& publishedFrame() const noexcept {
            return pipelineState_.publishedFrame();
        }

        const arrange::core::FrameExecutionCounters& frameCounters() const noexcept {
            return pipelineState_.counters();
        }

        bool publishRetained(const arrange::core::FrameFinalizer& finalize) {
            return pipelineState_.publishRetained(finalize);
        }
#if ARRANGE_WITH_QUICKJS_NG
        [[nodiscard]] std::vector<arrange::quickjs::QuickJsToastRequest> takeDiagnosticToasts();
        [[nodiscard]] std::vector<arrange::quickjs::QuickJsDiagnosticAction> takeDiagnosticActions();
#endif

       private:
        enum class QueuedEventKind {
            Invoke,
            InvokeString,
            InvokeScrollSnapshot,
        };

        struct QueuedEvent {
            std::uint64_t sequence = 0;
            std::uint64_t ownerGeneration = 0;
            std::uint64_t publishedRevision = 0;
            double timestampMillis = 0;
            QueuedEventKind kind = QueuedEventKind::Invoke;
            arrange::core::EventSlotId slot;
            std::string value;
            arrange::core::ScrollResult scroll;
        };

        [[nodiscard]] FrameWorkState frameWorkState() const noexcept;
        [[nodiscard]] bool captureRearrangeTransactions();
        [[nodiscard]] RuntimeStepResult dispatchQueuedEvents(double nowMillis);
        [[nodiscard]] RuntimeStepResult prepareVisualFrame(double nowMillis);
        [[nodiscard]] RuntimePipelineRunResult runPipeline(arrange::core::NodeId root, arrange::core::Constraints constraints, double nowMillis, const arrange::core::FrameFinalizer& finalize);

        struct OwnerWake {
            std::mutex mutex;
            ArrangeRuntime* owner = nullptr;
        };

        void handleAsyncUpdate() override;
        void postEvent(QueuedEvent event);
        std::shared_ptr<OwnerWake> wake_ = std::make_shared<OwnerWake>();
        std::function<void()> workAvailable_;
        std::uint64_t ownerGeneration_ = 1;
        std::uint64_t nextSequence_ = 1;
        bool inFrame_ = false;
        bool inSemantic_ = false;
        std::optional<std::string> semanticError_;
        bool suspended_ = false;
        bool reloadRequested_ = false;
        RearrangeHost rearrangeHost_;
        ScenePipelineState pipelineState_;
        FramePlanner frame_;
        std::deque<QueuedEvent> events_;
    };

#endif
}  // namespace arrange::juce
