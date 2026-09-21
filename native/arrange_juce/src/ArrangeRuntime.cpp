#include <arrange/juce/ArrangeRuntime.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ScriptEventDispatcher.h>

#include <utility>
#include <chrono>
#include <stdexcept>

namespace arrange::juce {
    ArrangeRuntime::ArrangeRuntime(arrange::core::SceneFramePipeline pipeline) : pipelineState_(std::move(pipeline)) {
        wake_->owner = this;
    }

    ArrangeRuntime::~ArrangeRuntime() {
        {
            std::lock_guard lock(wake_->mutex);
            wake_->owner = nullptr;
        }
        cancelPendingUpdate();
        rearrangeHost_.reset();
    }

    void ArrangeRuntime::handleAsyncUpdate() {
        if (inFrame_ || inSemantic_) {
            triggerAsyncUpdate();
            return;
        }
        const auto result = semanticCheckpoint(::juce::Time::getMillisecondCounterHiRes());
        if (!result.ok) semanticError_ = result.error;
        if (workAvailable_) workAvailable_();
    }

    RuntimeStepResult ArrangeRuntime::semanticCheckpoint(double nowMillis) {
        if (inFrame_ || inSemantic_) return {false, false, "Owner 任务不能重入"};
        if (semanticError_) return {false, false, *semanticError_};
        const ::juce::ScopedValueSetter<bool> guard(inSemantic_, true);
        auto result = dispatchQueuedEvents(nowMillis);
        if (!result.ok) {
            semanticError_ = result.error;
            return result;
        }
        const auto completed = rearrangeHost_.semanticCheckpoint(nowMillis);
        if (!completed.ok) {
            semanticError_ = completed.error;
            return {true, false, completed.error};
        }
        return result;
    }

    void ArrangeRuntime::postEvent(QueuedEvent event) {
        if (events_.size() >= 4096) {
            semanticError_ = "Owner 输入邮箱超过 4096 项，已停止接收并要求重新加载";
            triggerAsyncUpdate();
            return;
        }
        event.sequence = nextSequence_++;
        event.ownerGeneration = ownerGeneration_;
        event.publishedRevision = pipelineState_.publishedFrame().revision;
        event.timestampMillis = ::juce::Time::getMillisecondCounterHiRes();
        events_.push_back(std::move(event));
        triggerAsyncUpdate();
    }

    bool ArrangeRuntime::consumeReloadRequest() noexcept {
        return std::exchange(reloadRequested_, false);
    }

    void ArrangeRuntime::reset() {
        cancelPendingUpdate();
        ++ownerGeneration_;
        semanticError_.reset();
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
        const auto weak = std::weak_ptr<OwnerWake>(wake_);
        rearrangeHost_.setOwnerWake([weak] {
            if (const auto state = weak.lock()) {
                std::lock_guard lock(state->mutex);
                if (state->owner) state->owner->triggerAsyncUpdate();
            }
        });
        triggerAsyncUpdate();
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
        postEvent(std::move(event));
    }

    void ArrangeRuntime::enqueueScrollSnapshotEvent(const arrange::core::EventSlotId& slot, const arrange::core::ScrollResult& result) {
        if (!slot.valid()) return;
        QueuedEvent event;
        event.kind = QueuedEventKind::InvokeScrollSnapshot;
        event.slot = slot;
        event.scroll = result;
        postEvent(std::move(event));
    }

    void ArrangeRuntime::enqueueStringEvent(const arrange::core::EventSlotId& slot, std::string value) {
        if (!slot.valid()) return;
        QueuedEvent event;
        event.kind = QueuedEventKind::InvokeString;
        event.slot = slot;
        event.value = std::move(value);
        postEvent(std::move(event));
    }

    bool ArrangeRuntime::hasPendingEvents() const noexcept {
        return !events_.empty();
    }

    bool ArrangeRuntime::hasPendingVisualWork() const noexcept {
        return rearrangeHost_.hasPendingVisualWork() || pipelineState_.scene().tree().activeAnimationCount() > 0;
    }

    FrameWorkState ArrangeRuntime::frameWorkState() const noexcept {
        return {
            hasPendingEvents(),
            hasPendingVisualWork(),
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

    RuntimeStepResult ArrangeRuntime::prepareVisualFrame(double nowMillis) {
        if (!rearrangeHost_.hasPendingVisualWork()) return {};
        enqueueIntent(arrange::core::InputIntent::animationFrame("统一视觉帧"));
        const auto pumped = rearrangeHost_.prepareVisualFrame(nowMillis);
        if (!pumped.ok) return {true, false, pumped.error};
        return {captureRearrangeTransactions(), true, {}};
    }

    RuntimeStepResult ArrangeRuntime::dispatchQueuedEvents(double nowMillis) {
        RuntimeStepResult result;

        const auto cutoff = nextSequence_ - 1;
        const auto started = std::chrono::steady_clock::now();
        std::size_t processed = 0;
        while (!events_.empty() && events_.front().sequence <= cutoff) {
            if (processed++ >= 256 || std::chrono::steady_clock::now() - started > std::chrono::milliseconds(8)) {
                triggerAsyncUpdate();
                break;
            }
            auto event = std::move(events_.front());
            events_.pop_front();
            if (event.ownerGeneration != ownerGeneration_ || !pipelineState_.scene().hasEventSlot(event.slot)) continue;

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
            (void)rearrangeHost_.completeVisualFrame(false);
            (void)captureRearrangeTransactions();
            return {true, completed.ok ? *result.error : *result.error + "\n撤销回调失败：" + completed.error};
        }

        rearrangeHost_.publishScene(pipelineState_.scene());
        // 布局反馈属于本次成功发布，必须在后续输入及挂载回调前交付
        // 反馈引出的视觉提交留在队列中，不在当前帧重入流水线
        for (const auto& snapshot : result.scrollUpdates) {
            if (!snapshot.eventSlot.valid()) continue;
            const auto feedback = rearrangeHost_.invokeScrollSnapshot(snapshot.eventSlot, nowMillis, snapshot);
            if (!feedback.ok) {
                (void)rearrangeHost_.completeRearrange(result.rearrange, feedback.error);
                (void)rearrangeHost_.completeVisualFrame(false);
                return {true, feedback.error};
            }
        }
        const auto completed = rearrangeHost_.completeRearrange(result.rearrange);
        (void)captureRearrangeTransactions();
        const auto frameCompleted = rearrangeHost_.completeVisualFrame(completed.ok);
        if (!completed.ok) return {true, completed.error};
        if (!frameCompleted.ok) return {true, frameCompleted.error};
        return {true, std::nullopt};
    }

    RuntimeFramePumpResult ArrangeRuntime::pumpFrame(arrange::core::NodeId root, arrange::core::Constraints constraints, double nowMillis, const arrange::core::FrameFinalizer& finalize) {
        RuntimeFramePumpResult result;
        if (suspended_) return result;
        if (inFrame_ || inSemantic_) return {false, false, false, RuntimeFrameErrorPhase::Event, "Owner 视觉帧不能重入"};
        const auto semantic = semanticCheckpoint(nowMillis);
        if (!semantic.ok) return {true, false, false, RuntimeFrameErrorPhase::Event, semantic.error};
        const ::juce::ScopedValueSetter<bool> frameGuard(inFrame_, true);
        pipelineState_.setFrameTime(nowMillis);
        if (pipelineState_.scene().tree().activeAnimationCount() > 0) requestFramePipelineRun();
        auto plan = frame_.planTick(frameWorkState());

        if (plan.runAnimation) {
            const auto animation = prepareVisualFrame(nowMillis);
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
            const auto completed = rearrangeHost_.completeVisualFrame(true);
            result.ok = completed.ok;
            result.error = completed.error;
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
