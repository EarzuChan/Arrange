#pragma once

#include <memory>
#include <optional>
#include <cstddef>
#include <string>
#include <arrange/core/Bridge.h>
#include <arrange/core/EventSlot.h>
#include <arrange/core/MutationTransaction.h>
#include "ScriptHost.h"

namespace arrange::quickjs {
#if ARRANGE_WITH_QUICKJS_NG

    class QuickJsScriptHost final : public ScriptHost {
    public:
        QuickJsScriptHost();
        ~QuickJsScriptHost() override;

        ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) override;
        CallbackInvokeResult invokeEventSlot(const arrange::core::EventSlotId& slot, const CallbackInvokeOptions& options = {});

        bool hasPendingTransactions() const noexcept { return pendingTransactions_.hasPending(); }
        const std::optional<arrange::core::MutationTransaction>& pendingTransactions() const noexcept { return pendingTransactions_.pending(); }
        std::optional<arrange::core::MutationTransaction> takePendingTransaction() noexcept;
        void clearPendingTransactions() noexcept;
        void setFrameTimeMillis(double nowMillis) noexcept;
        bool hasPendingAnimationFrame() const noexcept;
        CallbackInvokeResult pumpAnimationFrame(double nowMillis);
        bool reloadRequested() const noexcept { return reloadRequested_; }
        const std::string& reloadPayloadJson() const noexcept { return reloadPayloadJson_; }
        std::size_t eventSlotCount() const noexcept;
        void flushRetiredEventSlots();

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
        arrange::core::MutationTransactionQueue pendingTransactions_;
        bool reloadRequested_ = false;
        std::string reloadPayloadJson_;
    };

#endif
} // namespace arrange::quickjs
