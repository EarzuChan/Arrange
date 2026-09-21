#include <arrange/juce/RearrangeHost.h>

#if ARRANGE_JUCE_WITH_JUCE

namespace arrange::juce {
    namespace {
        RearrangeInvokeResult fromScriptEventResult(ScriptEventInvokeResult result) {
            return {result.invoked, result.ok, std::move(result.error)};
        }
    }  // namespace

    void RearrangeHost::reset() noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        scriptHost_.reset();
#endif
    }

#if ARRANGE_WITH_QUICKJS_NG
    void RearrangeHost::setScriptHost(std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host) noexcept {
        scriptHost_ = std::move(host);
    }
#endif

    bool RearrangeHost::hasScriptHost() const noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        return static_cast<bool>(scriptHost_);
#else
        return false;
#endif
    }

    bool RearrangeHost::hasPendingDiagnostics() const noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        return scriptHost_ && scriptHost_->hasPendingDiagnostics();
#else
        return false;
#endif
    }

    bool RearrangeHost::hasPendingAnimationFrame() const noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        return scriptHost_ && scriptHost_->hasPendingAnimationFrame();
#else
        return false;
#endif
    }

    std::optional<arrange::core::MutationTransaction> RearrangeHost::takePendingTransaction() noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        if (!scriptHost_) return std::nullopt;
        return scriptHost_->takePendingTransaction();
#else
        return std::nullopt;
#endif
    }

    RearrangeInvokeResult RearrangeHost::pumpAnimationFrame(double nowMillis) {
#if ARRANGE_WITH_QUICKJS_NG
        if (!scriptHost_ || !scriptHost_->hasPendingAnimationFrame()) return {};
        const auto pumped = scriptHost_->pumpAnimationFrame(nowMillis);
        if (!pumped.ok) return {true, false, pumped.error};
        return {true, true, {}};
#else
        (void)nowMillis;
        return {};
#endif
    }

    RearrangeInvokeResult RearrangeHost::invoke(const arrange::core::EventSlotId& slot, double nowMillis) {
#if ARRANGE_WITH_QUICKJS_NG
        return fromScriptEventResult(eventDispatcher_.invoke(scriptHost_.get(), slot, nowMillis));
#else
        (void)slot;
        (void)nowMillis;
        return {};
#endif
    }

    RearrangeInvokeResult RearrangeHost::invokeString(const arrange::core::EventSlotId& slot, double nowMillis, const std::string& value) {
#if ARRANGE_WITH_QUICKJS_NG
        return fromScriptEventResult(eventDispatcher_.invokeString(scriptHost_.get(), slot, nowMillis, value));
#else
        (void)slot;
        (void)nowMillis;
        (void)value;
        return {};
#endif
    }

    RearrangeInvokeResult RearrangeHost::invokeScrollSnapshot(const arrange::core::EventSlotId& slot, double nowMillis, const arrange::core::ScrollResult& result) {
        return fromScriptEventResult(eventDispatcher_.invokeScroll(scriptHost_.get(), slot, nowMillis, result));
    }

    RearrangeInvokeResult RearrangeHost::completeRearrange(const std::shared_ptr<arrange::core::RearrangeSubmission>& submission, const std::string& error) {
#if ARRANGE_WITH_QUICKJS_NG
        if (scriptHost_) {
            const auto result = scriptHost_->completeRearrange(submission, error);
            return {true, result.ok, result.error};
        }
#endif
        return {false, true, {}};
    }

    void RearrangeHost::publishScene(const arrange::core::NativeScene& scene) {
#if ARRANGE_WITH_QUICKJS_NG
        if (scriptHost_) scriptHost_->publishScene(scene);
#endif
    }

#if ARRANGE_WITH_QUICKJS_NG
    std::vector<arrange::quickjs::QuickJsDiagnosticEventInput> RearrangeHost::takeDiagnosticEvents() {
        return scriptHost_ ? scriptHost_->takeDiagnosticEvents() : std::vector<arrange::quickjs::QuickJsDiagnosticEventInput>{};
    }

    std::vector<arrange::quickjs::QuickJsDiagnosticAction> RearrangeHost::takeDiagnosticActions() {
        return scriptHost_ ? scriptHost_->takeDiagnosticActions() : std::vector<arrange::quickjs::QuickJsDiagnosticAction>{};
    }
#endif
}  // namespace arrange::juce

#endif
