#pragma once

#include <memory>
#include <optional>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
#include <arrange/core/EventSlot.h>
#include <arrange/core/NativeScene.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/Scroll.h>
#include <arrange/core/Painter.h>
#include <arrange/core/FocusTypes.h>
#include <arrange/core/Interop.h>
#include <arrange/Log.h>
#include "ScriptHost.h"
#include "LiveModule.h"

namespace arrange::quickjs {
#if ARRANGE_WITH_QUICKJS_NG

    struct QuickJsToastRequest {
        arrange::LogLevel level = arrange::LogLevel::Info;
        std::string tag;
        std::string title;
        std::string content;
        bool coalesce = true;
    };

    enum class QuickJsDiagnosticActionKind {
        RequestReload,
        TriggerFakeError,
        SetToastsEnabled,
    };

    struct QuickJsDiagnosticAction {
        QuickJsDiagnosticActionKind kind = QuickJsDiagnosticActionKind::RequestReload;
        std::string message;
        std::string path;
        double timestamp = 0.0;
        bool enabled = false;
    };

    struct ScriptMemoryStats {
        std::uint64_t allocations = 0;
        std::uint64_t allocatedBytes = 0;
        std::size_t liveBytes = 0;
        std::size_t peakBytes = 0;
    };

    // 超时是终止整个脚本任务的保护边界，不是帧率目标或可恢复时间片
    struct ScriptExecutionLimits {
        int semanticMillis = 100;
        int visualMillis = 1000;
        int moduleMillis = 1000;
    };

    class QuickJsScriptHost final : public ScriptHost {
       public:
        explicit QuickJsScriptHost(ScriptExecutionLimits limits = {});
        ~QuickJsScriptHost() override;
        void setPainterLoader(arrange::core::PainterLoader loader);
        // 宿主寿命须长于本脚本宿主；须在加载脚本前设置
        void setInteropHost(arrange::core::InteropHost* host);

        ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) override;
        ScriptExecutionResult executeLiveModules(const LiveModuleSnapshot& snapshot);
        CallbackInvokeResult applyHotUpdate(const LiveModuleSnapshot& snapshot, const HotMessage& message);
        std::vector<HotMessage> takeHotMessages();
        std::vector<arrange::core::FocusCommand> takeFocusCommands();
        bool hasPendingFocusCommands() const noexcept;
        CallbackInvokeResult invokeEventSlot(const arrange::core::EventSlotId& slot, const CallbackInvokeOptions& options = {});
        CallbackInvokeResult invokeEventSlot(const arrange::core::EventSlotId& slot, const arrange::core::ScrollResult& scroll);

        bool hasPendingTransactions() const noexcept {
            return pendingTransactions_.hasPending();
        }

        const std::optional<arrange::core::MutationTransaction>& pendingTransactions() const noexcept {
            return pendingTransactions_.pending();
        }

        std::optional<arrange::core::MutationTransaction> takePendingTransaction() noexcept;
        void clearPendingTransactions() noexcept;
        void setFrameTimeMillis(double nowMillis) noexcept;
        void setOwnerWake(std::function<void()> wake);
        // visualFrame 表示本检查点属于 VBlank 视觉帧；只在视觉帧交付按帧拉取的互操作数据
        CallbackInvokeResult semanticCheckpoint(double nowMillis, bool visualFrame = false);
        bool hasPendingSemanticWork() const noexcept;
        bool hasPendingVisualWork() const noexcept;
        CallbackInvokeResult prepareVisualFrame(double nowMillis);
        CallbackInvokeResult prepareDrawModifiers(arrange::core::NativeScene& candidateScene);
        CallbackInvokeResult materializeLayout(arrange::core::NodeId id, const std::vector<int>& indices);
        CallbackInvokeResult completeVisualFrame(bool success);
        bool hasPendingDiagnostics() const noexcept;
        std::vector<QuickJsToastRequest> takeDiagnosticToasts();
        std::vector<QuickJsDiagnosticAction> takeDiagnosticActions();
        std::size_t eventSlotCount() const noexcept;
        std::size_t bindingCount() const noexcept;
        std::size_t modifierInstanceCount() const noexcept;
        std::uint64_t rejectedBindingUpdates() const noexcept;
        ScriptMemoryStats memoryStats() const noexcept;
        void publishScene(const arrange::core::NativeScene& scene);
        CallbackInvokeResult completeRearrange(const std::shared_ptr<arrange::core::RearrangeSubmission>& submission, const std::string& error = {});

       private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
        arrange::core::MutationTransactionQueue pendingTransactions_;
    };

#endif
}
