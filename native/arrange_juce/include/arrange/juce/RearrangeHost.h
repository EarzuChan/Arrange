#pragma once

#include <arrange/core/EventSlot.h>
#include <arrange/core/NativeScene.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/LayoutNode.h>
#include <arrange/core/Scroll.h>
#include <arrange/juce/ScriptEventDispatcher.h>

#if ARRANGE_WITH_QUICKJS_NG
#include <arrange/quickjs/QuickJsScriptHost.h>
#endif

#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    struct RearrangeInvokeResult {
        bool invoked = false;
        bool ok = true;
        std::string error;
    };

    class RearrangeHost final {
       public:
        void reset() noexcept;

#if ARRANGE_WITH_QUICKJS_NG
        void setScriptHost(std::unique_ptr<arrange::quickjs::QuickJsScriptHost> host) noexcept;
        quickjs::CallbackInvokeResult applyHotUpdate(const quickjs::LiveModuleSnapshot& snapshot, const quickjs::HotMessage& message);
        std::vector<quickjs::HotMessage> takeHotMessages();
#endif

        [[nodiscard]] bool hasScriptHost() const noexcept;
        [[nodiscard]] bool hasPendingVisualWork() const noexcept;
        [[nodiscard]] bool hasPendingDiagnostics() const noexcept;
        [[nodiscard]] std::optional<arrange::core::MutationTransaction> takePendingTransaction() noexcept;

        void setOwnerWake(std::function<void()> wake);
        RearrangeInvokeResult semanticCheckpoint(double nowMillis);
        [[nodiscard]] RearrangeInvokeResult prepareVisualFrame(double nowMillis);
        RearrangeInvokeResult completeVisualFrame(bool success);
        [[nodiscard]] RearrangeInvokeResult invoke(const arrange::core::EventSlotId& slot, double nowMillis);
        [[nodiscard]] RearrangeInvokeResult invokeString(const arrange::core::EventSlotId& slot, double nowMillis, const std::string& value);

        [[nodiscard]] RearrangeInvokeResult invokeScrollSnapshot(const arrange::core::EventSlotId& slot, double nowMillis, const arrange::core::ScrollResult& result);

        void publishScene(const arrange::core::NativeScene& scene);
        RearrangeInvokeResult completeRearrange(const std::shared_ptr<arrange::core::RearrangeSubmission>& submission, const std::string& error = {});
#if ARRANGE_WITH_QUICKJS_NG
        [[nodiscard]] std::vector<arrange::quickjs::QuickJsDiagnosticEventInput> takeDiagnosticEvents();
        [[nodiscard]] std::vector<arrange::quickjs::QuickJsDiagnosticAction> takeDiagnosticActions();
#endif

       private:
        ScriptEventDispatcher eventDispatcher_;
#if ARRANGE_WITH_QUICKJS_NG
        std::unique_ptr<arrange::quickjs::QuickJsScriptHost> scriptHost_;
#endif
    };

#endif
}  // namespace arrange::juce
