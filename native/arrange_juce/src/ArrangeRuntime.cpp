#include <arrange/juce/ArrangeRuntime.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ScriptEventBridge.h>

#include <utility>

namespace arrange::juce {
    ArrangeRuntime::ArrangeRuntime(arrange::core::SceneFramePipeline pipeline)
        : pipelineState_(std::move(pipeline)) {}

    void ArrangeRuntime::reset() {
        composition_.reset();
        pipelineState_.reset();
        frame_.reset();
        events_.clear();
    }

#if ARRANGE_WITH_QUICKJS_NG
    void ArrangeRuntime::setScriptHost(std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host) noexcept {
        composition_.setScriptHost(std::move(host));
    }
#endif

    void ArrangeRuntime::requestFramePipelineRun() noexcept {
        frame_.requestFramePipelineRun();
    }

    bool ArrangeRuntime::framePipelineRunRequested() const noexcept {
        return frame_.framePipelineRunRequested();
    }

    void ArrangeRuntime::enqueue(arrange::core::MutationTransaction transaction) {
        enqueueIntent(arrange::core::InputIntent::jsCommit(std::move(transaction)));
    }

    void ArrangeRuntime::enqueueIntent(arrange::core::InputIntent intent) {
        pipelineState_.enqueueIntent(std::move(intent));
        requestFramePipelineRun();
    }

    bool ArrangeRuntime::hasPendingIntents() const noexcept {
        return pipelineState_.hasPendingIntents();
    }

    bool ArrangeRuntime::hasPendingTransactions() const noexcept {
        return pipelineState_.hasPendingTransactions();
    }

    void ArrangeRuntime::clearPendingTransactions() noexcept {
        pipelineState_.clearPendingTransactions();
    }

    void ArrangeRuntime::enqueueEvent(const arrange::core::EventSlotId& slot) {
        if (!slot.valid()) return;
        QueuedEvent event;
        event.kind = QueuedEventKind::Invoke;
        event.slot = slot;
        events_.push_back(std::move(event));
    }

    void ArrangeRuntime::enqueueScrollSnapshotEvent(
        const arrange::core::EventSlotId& slot,
        const arrange::core::ScrollResult& result) {
        if (!slot.valid()) return;
        QueuedEvent event;
        event.kind = QueuedEventKind::InvokeScrollSnapshot;
        event.slot = slot;
        event.scroll = result;
        events_.push_back(std::move(event));
    }

    void ArrangeRuntime::enqueueStringEvent(const arrange::core::EventSlotId& slot, std::string value) {
        if (!slot.valid()) return;
        QueuedEvent event;
        event.kind = QueuedEventKind::InvokeString;
        event.slot = slot;
        event.value = std::move(value);
        events_.push_back(std::move(event));
    }

    void ArrangeRuntime::enqueueNodeStringEvent(
        const arrange::core::ArrangeNode& node,
        arrange::core::EventSlotKind kind,
        const char* camelCase,
        const char* kebabCase,
        std::string value) {
        const auto slot = ScriptEventBridge::eventSlotFromAnyProp(node, kind, camelCase, kebabCase);
        enqueueStringEvent(slot, std::move(value));
    }

    bool ArrangeRuntime::hasPendingEvents() const noexcept {
        return !events_.empty();
    }

    bool ArrangeRuntime::hasPendingAnimationFrame() const noexcept {
        return composition_.hasPendingAnimationFrame();
    }

    FrameWorkState ArrangeRuntime::frameWorkState() const noexcept {
        return {
            hasPendingEvents(),
            hasPendingAnimationFrame(),
            pipelineState_.hasPendingIntents(),
            pipelineState_.hasPendingTransactions(),
        };
    }

    bool ArrangeRuntime::hasPendingFrameWork() const noexcept {
        return frame_.hasPendingFrameWork(frameWorkState());
    }

    int ArrangeRuntime::desiredTimerFrequencyHz() const noexcept {
        return frame_.desiredTimerFrequencyHz(frameWorkState());
    }

    bool ArrangeRuntime::captureCompositionTransactions() {
        if (!composition_.hasScriptHost()) return false;
        auto transaction = composition_.takePendingTransaction();
        if (!transaction) return false;
        enqueue(std::move(*transaction));
        return true;
    }

    RuntimeStepResult ArrangeRuntime::pumpAnimationFrame(double nowMillis) {
        if (!composition_.hasPendingAnimationFrame()) return {};
        enqueueIntent(arrange::core::InputIntent::animationFrame("runtime animation frame"));
        const auto pumped = composition_.pumpAnimationFrame(nowMillis);
        if (!pumped.ok) return {true, false, pumped.error};
        return {captureCompositionTransactions(), true, {}};
    }

    RuntimeStepResult ArrangeRuntime::dispatchQueuedEvents(double nowMillis) {
        RuntimeStepResult result;

        while (!events_.empty()) {
            auto event = std::move(events_.front());
            events_.pop_front();

            CompositionInvokeResult invoked;
            switch (event.kind) {
                case QueuedEventKind::Invoke:
                    invoked = composition_.invoke(event.slot, nowMillis);
                    break;
                case QueuedEventKind::InvokeString:
                    invoked = composition_.invokeString(event.slot, nowMillis, event.value);
                    break;
                case QueuedEventKind::InvokeScrollSnapshot:
                    invoked = composition_.invokeScrollSnapshot(event.slot, nowMillis, event.scroll);
                    break;
            }

            if (!invoked.ok) return {true, false, invoked.error};
            if (invoked.invoked) {
                result.changed = true;
                result.changed = captureCompositionTransactions() || result.changed;
            }
        }

        return result;
    }

    RuntimePipelineRunResult ArrangeRuntime::runPipeline(
        arrange::core::NodeId root,
        arrange::core::Constraints constraints) {
        (void)captureCompositionTransactions();
        const auto hasPending = pipelineState_.hasPendingTransactions() || pipelineState_.hasPendingIntents();
        if (!hasPending && !frame_.framePipelineRunRequested()) return {};

        const auto result = pipelineState_.run(root, constraints, frame_.framePipelineRunRequested());
        if (result.error) {
            pipelineState_.clearPendingTransactions();
            frame_.clearFramePipelineRunRequest();
            return {true, *result.error};
        }

        composition_.flushRetiredEventSlots();
        frame_.clearFramePipelineRunRequest();
        return {true, std::nullopt};
    }

    RuntimeFramePumpResult ArrangeRuntime::pumpFrame(
        arrange::core::NodeId root,
        arrange::core::Constraints constraints,
        double nowMillis) {
        RuntimeFramePumpResult result;
        auto plan = frame_.planTick(frameWorkState());

        if (plan.runEvents) {
            const auto events = dispatchQueuedEvents(nowMillis);
            if (!events.ok) {
                result.changed = true;
                result.ok = false;
                result.errorPhase = RuntimeFrameErrorPhase::Event;
                result.error = events.error;
                return result;
            }
            result.changed = result.changed || events.changed;
            plan = frame_.planTick(frameWorkState());
        }

        if (plan.runAnimation) {
            const auto animation = pumpAnimationFrame(nowMillis);
            if (!animation.ok) {
                result.changed = true;
                result.ok = false;
                result.errorPhase = RuntimeFrameErrorPhase::Animation;
                result.error = animation.error;
                return result;
            }
            result.changed = result.changed || animation.changed;
            plan = frame_.planTick(frameWorkState());
        }

        if (!plan.runPipeline) {
            return result;
        }

        const auto pipeline = runPipeline(root, constraints);
        if (pipeline.error) {
            result.changed = true;
            result.pipelineRan = true;
            result.ok = false;
            result.errorPhase = RuntimeFrameErrorPhase::Pipeline;
            result.error = *pipeline.error;
            return result;
        }

        result.changed = result.changed || pipeline.changed;
        result.pipelineRan = pipeline.changed;
        return result;
    }

    void ArrangeRuntime::publishOverlayDrawOps(
        std::vector<arrange::core::DrawOp> ops,
        std::optional<arrange::core::NodeId> focusedInputNode,
        float focusedInputViewportX) {
        pipelineState_.setOverlayDrawOps(std::move(ops), focusedInputNode, focusedInputViewportX);
    }

    void ArrangeRuntime::publishDiagnosticsDrawOps(
        std::vector<arrange::core::DrawOp> errorOps,
        std::vector<arrange::core::DrawOp> badgeOps,
        std::vector<arrange::core::DrawOp> toastOps) {
        pipelineState_.setDiagnosticsDrawOps(std::move(errorOps), std::move(badgeOps), std::move(toastOps));
    }

} // namespace arrange::juce

#endif
