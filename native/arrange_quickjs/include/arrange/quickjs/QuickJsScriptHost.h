#pragma once

#include <memory>
#include <optional>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
#include <arrange/core/EventSlot.h>
#include <arrange/core/MutationTransaction.h>
#include <arrange/core/Scroll.h>
#include "ScriptHost.h"

namespace arrange::quickjs {
#if ARRANGE_WITH_QUICKJS_NG

    enum class QuickJsDiagnosticLevel {
        Trace,
        Debug,
        Info,
        Warn,
        Error,
    };

    enum class QuickJsDiagnosticCategory {
        App,
        HostLive,
        HostDist,
        HostHmr,
        RuntimeScript,
        RuntimeTransaction,
        PipelineFrame,
        PipelineLayout,
        PipelinePaint,
        InputPointer,
        InputKey,
        InputIme,
        InputScroll,
        ResourcePackage,
        ResourceImage,
        ResourceIcon,
        Diagnostics,
    };

    struct QuickJsDiagnosticEventInput {
        QuickJsDiagnosticLevel level = QuickJsDiagnosticLevel::Info;
        QuickJsDiagnosticCategory category = QuickJsDiagnosticCategory::RuntimeScript;
        std::string code;
        std::string message;
        std::string detail;
        std::string source;
        std::string pathOrUrl;
        bool toast = false;
        bool coalesceToast = true;
    };

    enum class QuickJsDiagnosticActionKind {
        RequestReload,
        TriggerFakeError,
        SetLogLevel,
        SetCategoryEnabled,
        SetToastsEnabled,
    };

    struct QuickJsDiagnosticAction {
        QuickJsDiagnosticActionKind kind = QuickJsDiagnosticActionKind::RequestReload;
        QuickJsDiagnosticLevel level = QuickJsDiagnosticLevel::Info;
        QuickJsDiagnosticCategory category = QuickJsDiagnosticCategory::Diagnostics;
        std::string message;
        std::string path;
        double timestamp = 0.0;
        bool enabled = false;
    };

    struct ReloadRequest {
        std::string path;
        double timestamp = 0.0;
    };

    class QuickJsScriptHost final : public ScriptHost {
    public:
        QuickJsScriptHost();
        ~QuickJsScriptHost() override;

        ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) override;
        CallbackInvokeResult invokeEventSlot(const arrange::core::EventSlotId& slot, const CallbackInvokeOptions& options = {});
        CallbackInvokeResult invokeEventSlot(const arrange::core::EventSlotId& slot, const arrange::core::ScrollResult& scroll);

        bool hasPendingTransactions() const noexcept { return pendingTransactions_.hasPending(); }
        const std::optional<arrange::core::MutationTransaction>& pendingTransactions() const noexcept { return pendingTransactions_.pending(); }
        std::optional<arrange::core::MutationTransaction> takePendingTransaction() noexcept;
        void clearPendingTransactions() noexcept;
        void setFrameTimeMillis(double nowMillis) noexcept;
        bool hasPendingAnimationFrame() const noexcept;
        CallbackInvokeResult pumpAnimationFrame(double nowMillis);
        bool reloadRequested() const noexcept { return reloadRequested_; }
        const ReloadRequest& reloadRequest() const noexcept { return reloadRequest_; }
        std::vector<QuickJsDiagnosticEventInput> takeDiagnosticEvents();
        std::vector<QuickJsDiagnosticAction> takeDiagnosticActions();
        std::size_t eventSlotCount() const noexcept;
        void flushRetiredEventSlots();

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
        arrange::core::MutationTransactionQueue pendingTransactions_;
        bool reloadRequested_ = false;
        ReloadRequest reloadRequest_;
    };

#endif
} // namespace arrange::quickjs

