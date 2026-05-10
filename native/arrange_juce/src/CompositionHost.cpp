#include <arrange/juce/CompositionHost.h>

#if ARRANGE_JUCE_WITH_JUCE

namespace arrange::juce {
    namespace {
        CompositionInvokeResult fromScriptEventResult(ScriptEventInvokeResult result) {
            return {result.invoked, result.ok, std::move(result.error)};
        }
    } // namespace

    void CompositionHost::reset() noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        scriptHost_.reset();
#endif
    }

#if ARRANGE_WITH_QUICKJS_NG
    void CompositionHost::setScriptHost(std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host) noexcept {
        scriptHost_ = std::move(host);
    }
#endif

    bool CompositionHost::hasScriptHost() const noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        return static_cast<bool>(scriptHost_);
#else
        return false;
#endif
    }

    bool CompositionHost::hasPendingAnimationFrame() const noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        return scriptHost_ && scriptHost_->hasPendingAnimationFrame();
#else
        return false;
#endif
    }

    std::optional<arrange::core::MutationTransaction> CompositionHost::takePendingTransaction() noexcept {
#if ARRANGE_WITH_QUICKJS_NG
        if (!scriptHost_) return std::nullopt;
        return scriptHost_->takePendingTransaction();
#else
        return std::nullopt;
#endif
    }

    CompositionInvokeResult CompositionHost::pumpAnimationFrame(double nowMillis) {
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

    CompositionInvokeResult CompositionHost::invoke(const arrange::core::EventSlotId& slot, double nowMillis) {
#if ARRANGE_WITH_QUICKJS_NG
        return fromScriptEventResult(eventBridge_.invoke(scriptHost_.get(), slot, nowMillis));
#else
        (void)slot;
        (void)nowMillis;
        return {};
#endif
    }

    CompositionInvokeResult CompositionHost::invokeString(
        const arrange::core::EventSlotId& slot,
        double nowMillis,
        const std::string& value) {
#if ARRANGE_WITH_QUICKJS_NG
        return fromScriptEventResult(eventBridge_.invokeString(scriptHost_.get(), slot, nowMillis, value));
#else
        (void)slot;
        (void)nowMillis;
        (void)value;
        return {};
#endif
    }

    CompositionInvokeResult CompositionHost::invokeNodeStringEvent(
        const arrange::core::ArrangeNode& node,
        arrange::core::EventSlotKind kind,
        const char* camelCase,
        const char* kebabCase,
        double nowMillis,
        const std::string& value) {
        const auto slot = ScriptEventBridge::eventSlotFromAnyProp(node, kind, camelCase, kebabCase);
        return invokeString(slot, nowMillis, value);
    }

    CompositionInvokeResult CompositionHost::invokeScrollSnapshot(
        const arrange::core::EventSlotId& slot,
        double nowMillis,
        const arrange::core::ScrollResult& result) {
        return invokeString(slot, nowMillis, ScriptEventBridge::scrollSnapshotJson(result));
    }

    void CompositionHost::flushRetiredEventSlots() {
#if ARRANGE_WITH_QUICKJS_NG
        if (scriptHost_) scriptHost_->flushRetiredEventSlots();
#endif
    }
} // namespace arrange::juce

#endif
