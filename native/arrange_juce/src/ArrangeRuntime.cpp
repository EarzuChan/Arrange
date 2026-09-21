#include <arrange/juce/ArrangeRuntime.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ScriptEventDispatcher.h>

#include <utility>

namespace arrange::juce {
    ArrangeRuntime::ArrangeRuntime(arrange::core::SceneFramePipeline pipeline) : pipelineState_(std::move(pipeline)) {}

    bool ArrangeRuntime::consumeReloadRequest() noexcept {
        return std::exchange(reloadRequested_, false);
    }

    void ArrangeRuntime::reset() {
        suspended_ = false;
        reloadRequested_ = false;
        rearrangeHost_.reset();
        pipelineState_.reset();
        frame_.reset();
        events_.clear();
    }

#if ARRANGE_WITH_QUICKJS_NG
    void ArrangeRuntime::setScriptHost(std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host) noexcept {
        rearrangeHost_.setScriptHost(std::move(host));
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

    void ArrangeRuntime::enqueueScrollSnapshotEvent(const arrange::core::EventSlotId& slot, const arrange::core::ScrollResult& result) {
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

    bool ArrangeRuntime::hasPendingEvents() const noexcept {
        return !events_.empty();
    }

    bool ArrangeRuntime::hasPendingAnimationFrame() const noexcept {
        return rearrangeHost_.hasPendingAnimationFrame() || pipelineState_.scene().tree().activeAnimationCount() > 0;
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
        return reloadRequested_ || rearrangeHost_.hasPendingDiagnostics() || (!suspended_ && frame_.hasPendingFrameWork(frameWorkState()));
    }

    bool ArrangeRuntime::captureRearrangeTransactions() {
        if (!rearrangeHost_.hasScriptHost()) return false;
        auto transaction = rearrangeHost_.takePendingTransaction();
        if (!transaction) return false;
        enqueue(std::move(*transaction));
        return true;
    }

    RuntimeStepResult ArrangeRuntime::pumpAnimationFrame(double nowMillis) {
        if (!rearrangeHost_.hasPendingAnimationFrame()) return {};
        enqueueIntent(arrange::core::InputIntent::animationFrame("runtime animation frame"));
        const auto pumped = rearrangeHost_.pumpAnimationFrame(nowMillis);
        if (!pumped.ok) return {true, false, pumped.error};
        return {captureRearrangeTransactions(), true, {}};
    }

    RuntimeStepResult ArrangeRuntime::dispatchQueuedEvents(double nowMillis) {
        RuntimeStepResult result;

        while (!events_.empty()) {
            auto event = std::move(events_.front());
            events_.pop_front();
            if (!pipelineState_.scene().hasEventSlot(event.slot)) continue;

            RearrangeInvokeResult invoked;
            switch (event.kind) {
                case QueuedEventKind::Invoke:
                    invoked = rearrangeHost_.invoke(event.slot, nowMillis);
                    break;
                case QueuedEventKind::InvokeString:
                    invoked = rearrangeHost_.invokeString(event.slot, nowMillis, event.value);
                    break;
                case QueuedEventKind::InvokeScrollSnapshot:
                    invoked = rearrangeHost_.invokeScrollSnapshot(event.slot, nowMillis, event.scroll);
                    break;
            }

            if (!invoked.ok) return {true, false, invoked.error};
            if (invoked.invoked) {
                result.changed = true;
                result.changed = captureRearrangeTransactions() || result.changed;
            }
        }

        return result;
    }

    RuntimePipelineRunResult ArrangeRuntime::runPipeline(arrange::core::NodeId root, arrange::core::Constraints constraints, double nowMillis, const arrange::core::FrameFinalizer& finalize) {
        (void)captureRearrangeTransactions();
        const auto hasPending = pipelineState_.hasPendingTransactions() || pipelineState_.hasPendingIntents();
        if (!hasPending && !frame_.framePipelineRunRequested()) return {};

        const auto result = pipelineState_.run(root, constraints, frame_.framePipelineRunRequested(), finalize);
        frame_.clearFramePipelineRunRequest();
        if (result.error) {
            const auto completed = rearrangeHost_.completeRearrange(result.rearrange, *result.error);
            (void)captureRearrangeTransactions();
            return {true, completed.ok ? *result.error : *result.error + "\n撤销回调失败：" + completed.error};
        }

        rearrangeHost_.publishScene(pipelineState_.scene());
        // 布局反馈属于本次成功发布，必须在后续输入及挂载回调前交付
        // 反馈引出的视觉提交留在队列中，不在当前帧重入流水线
        for (const auto& snapshot : result.scrollUpdates) {
            if (!snapshot.eventSlot.valid()) continue;
            const auto feedback = rearrangeHost_.invokeScrollSnapshot(snapshot.eventSlot, nowMillis, snapshot);
            if (!feedback.ok) return {true, feedback.error};
        }
        const auto completed = rearrangeHost_.completeRearrange(result.rearrange);
        (void)captureRearrangeTransactions();
        if (!completed.ok) return {true, completed.error};
        return {true, std::nullopt};
    }

    RuntimeFramePumpResult ArrangeRuntime::pumpFrame(arrange::core::NodeId root, arrange::core::Constraints constraints, double nowMillis, const arrange::core::FrameFinalizer& finalize) {
        RuntimeFramePumpResult result;
        if (suspended_) return result;
        pipelineState_.setFrameTime(nowMillis);
        if (pipelineState_.scene().tree().activeAnimationCount() > 0) requestFramePipelineRun();
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

        const auto pipeline = runPipeline(root, constraints, nowMillis, finalize);
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

#if ARRANGE_WITH_QUICKJS_NG
    std::vector<arrange::quickjs::QuickJsDiagnosticEventInput> ArrangeRuntime::takeDiagnosticEvents() {
        return rearrangeHost_.takeDiagnosticEvents();
    }

    std::vector<arrange::quickjs::QuickJsDiagnosticAction> ArrangeRuntime::takeDiagnosticActions() {
        return rearrangeHost_.takeDiagnosticActions();
    }
#endif

}  // namespace arrange::juce

#endif
