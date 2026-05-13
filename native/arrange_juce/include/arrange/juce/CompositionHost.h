#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/Node.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ScriptEventDispatcher.h>

#if ARRANGE_WITH_QUICKJS_NG
#include <arrange/quickjs/QuickJsScriptHost.h>
#endif

#include <memory>
#include <optional>
#include <string>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct CompositionInvokeResult {
        bool invoked = false;
        bool ok = true;
        std::string error;
    };

    class CompositionHost final {
    public:
        void reset() noexcept;

#if ARRANGE_WITH_QUICKJS_NG
        void setScriptHost(std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host) noexcept;
#endif

        [[nodiscard]] bool hasScriptHost() const noexcept;
        [[nodiscard]] bool hasPendingAnimationFrame() const noexcept;
        [[nodiscard]] std::optional<arrange::core::MutationTransaction> takePendingTransaction() noexcept;

        [[nodiscard]] CompositionInvokeResult pumpAnimationFrame(double nowMillis);
        [[nodiscard]] CompositionInvokeResult invoke(const arrange::core::EventSlotId& slot, double nowMillis);
        [[nodiscard]] CompositionInvokeResult invokeString(
            const arrange::core::EventSlotId& slot,
            double nowMillis,
            const std::string& value);
        [[nodiscard]] CompositionInvokeResult invokeNodeStringEvent(
            const arrange::core::ArrangeNode& node,
            arrange::core::EventSlotKind kind,
            double nowMillis,
            const std::string& value);
        [[nodiscard]] CompositionInvokeResult invokeScrollSnapshot(
            const arrange::core::EventSlotId& slot,
            double nowMillis,
            const arrange::core::ScrollResult& result);

        void flushRetiredEventSlots();

    private:
        ScriptEventDispatcher eventDispatcher_;
#if ARRANGE_WITH_QUICKJS_NG
        std::unique_ptr<arrange::quickjs::QuickJsScriptHost> scriptHost_;
#endif
    };

#endif
} // namespace arrange::juce
