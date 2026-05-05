#pragma once

#include <memory>
#include <optional>
#include <cstddef>
#include <string>
#include <arrange/core/Bridge.h>
#include "ScriptHost.h"

namespace arrange::quickjs {
#if ARRANGE_WITH_QUICKJS_NG

    class QuickJsScriptHost final : public ScriptHost {
    public:
        QuickJsScriptHost();
        ~QuickJsScriptHost() override;

        ScriptExecutionResult executeModule(const std::filesystem::path& modulePath, std::string_view source) override;
        CallbackInvokeResult invokeCallback(std::uint32_t callbackHandle, const CallbackInvokeOptions& options = {}) override;

        const std::optional<arrange::core::BridgeBatch>& mountedBatch() const noexcept { return mountedBatch_; }
        void setFrameTimeMillis(double nowMillis) noexcept;
        bool hasPendingAnimationFrame() const noexcept;
        CallbackInvokeResult pumpAnimationFrame(double nowMillis);
        bool reloadRequested() const noexcept { return reloadRequested_; }
        const std::string& reloadPayloadJson() const noexcept { return reloadPayloadJson_; }
        std::size_t callbackCount() const noexcept;

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
        std::optional<arrange::core::BridgeBatch> mountedBatch_;
        bool reloadRequested_ = false;
        std::string reloadPayloadJson_;
    };

#endif
} // namespace arrange::quickjs
