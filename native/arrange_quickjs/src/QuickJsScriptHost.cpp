#include <arrange/quickjs/QuickJsScriptHost.h>

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsNativeApi.h"
#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <algorithm>
#include <filesystem>
#include <string_view>
#include <utility>
#include <vector>

namespace arrange::quickjs {
    namespace {
        struct DrainJobsResult {
            bool ok = true;
            std::string error;
        };
    }

    struct QuickJsScriptHost::Impl {
        QuickJsRuntimeContext runtime;

        ~Impl() { reset(); }

        void reset() {
            if (runtime.context != nullptr) {
                runtime.events.reset(nullptr);
                for (auto& [_, callback] : runtime.animationFrameCallbacks) JS_FreeValue(runtime.context, callback);
                runtime.animationFrameCallbacks.clear();
                JS_FreeContext(runtime.context);
                runtime.context = nullptr;
            }
            runtime.events.clearContext();
            if (runtime.runtime != nullptr) {
                JS_FreeRuntime(runtime.runtime);
                runtime.runtime = nullptr;
            }
            runtime.rootNodeId = 0;
            runtime.nextAnimationFrameHandle = 1;
            runtime.frameTimeMillis = 0.0;
            runtime.pendingTransactions = nullptr;
            runtime.nodeTypes.clear();
            runtime.childrenByNode.clear();
            runtime.parentByNode.clear();
            runtime.moduleLoader.clear();
            runtime.reloadRequested = false;
            runtime.reloadRequest = {};
            runtime.nativeError.clear();
            runtime.diagnosticEvents.clear();
            runtime.diagnosticActions.clear();
        }

        void initialise(QuickJsScriptHost* owner, const std::filesystem::path& entryPath) {
            reset();
            runtime.pendingTransactions = &owner->pendingTransactions_;
            runtime.moduleLoader.setModuleRoot(entryPath);
            runtime.runtime = JS_NewRuntime();
            JS_SetModuleLoaderFunc(runtime.runtime, &QuickJsModuleLoader::normalize, &QuickJsModuleLoader::load, &runtime.moduleLoader);
            runtime.context = JS_NewContext(runtime.runtime);
            runtime.events.reset(runtime.context);
            JS_SetContextOpaque(runtime.context, &runtime);
            QuickJsNativeApi::install(runtime.context, runtime);
        }

        DrainJobsResult drainJobs() {
            JSContext* jobContext = nullptr;
            int jobResult = 0;
            while ((jobResult = JS_ExecutePendingJob(runtime.runtime, &jobContext)) > 0) {}
            if (jobResult < 0) return {false, quickJsExceptionText(jobContext != nullptr ? jobContext : runtime.context)};
            return {};
        }
    };

    QuickJsScriptHost::QuickJsScriptHost() : impl_(std::make_unique<Impl>()) {}
    QuickJsScriptHost::~QuickJsScriptHost() = default;

    std::size_t QuickJsScriptHost::eventSlotCount() const noexcept {
        return impl_ ? impl_->runtime.events.size() : 0;
    }

    void QuickJsScriptHost::flushRetiredEventSlots() {
        if (impl_) impl_->runtime.events.flushRetired();
    }

    std::vector<QuickJsDiagnosticEventInput> QuickJsScriptHost::takeDiagnosticEvents() {
        if (!impl_) return {};
        auto events = std::move(impl_->runtime.diagnosticEvents);
        impl_->runtime.diagnosticEvents.clear();
        return events;
    }

    std::vector<QuickJsDiagnosticAction> QuickJsScriptHost::takeDiagnosticActions() {
        if (!impl_) return {};
        auto actions = std::move(impl_->runtime.diagnosticActions);
        impl_->runtime.diagnosticActions.clear();
        return actions;
    }

    std::optional<arrange::core::MutationTransaction> QuickJsScriptHost::takePendingTransaction() noexcept {
        return pendingTransactions_.take();
    }

    void QuickJsScriptHost::clearPendingTransactions() noexcept {
        pendingTransactions_.clear();
    }

    void QuickJsScriptHost::setFrameTimeMillis(double nowMillis) noexcept {
        if (impl_) impl_->runtime.frameTimeMillis = std::max(0.0, nowMillis);
    }

    bool QuickJsScriptHost::hasPendingAnimationFrame() const noexcept {
        return impl_ && !impl_->runtime.animationFrameCallbacks.empty();
    }

    CallbackInvokeResult QuickJsScriptHost::pumpAnimationFrame(double nowMillis) {
        if (impl_->runtime.context == nullptr) return {false, "QuickJS runtime is not initialised"};
        setFrameTimeMillis(nowMillis);
        pendingTransactions_.clear();
        if (impl_->runtime.animationFrameCallbacks.empty()) {
            const auto drained = impl_->drainJobs();
            return {drained.ok, drained.error};
        }

        std::vector<std::pair<std::uint32_t, JSValue>> callbacks;
        callbacks.reserve(impl_->runtime.animationFrameCallbacks.size());
        for (auto& [handle, callback] : impl_->runtime.animationFrameCallbacks) callbacks.emplace_back(handle, callback);
        impl_->runtime.animationFrameCallbacks.clear();

        ScopedValue timestamp(impl_->runtime.context, JS_NewFloat64(impl_->runtime.context, impl_->runtime.frameTimeMillis));
        JSValueConst argv[1] = {timestamp.get()};
        for (std::size_t i = 0; i < callbacks.size(); ++i) {
            JSValue callbackValue = callbacks[i].second;
            callbacks[i].second = JS_UNDEFINED;
            ScopedValue result(impl_->runtime.context, JS_Call(impl_->runtime.context, callbackValue, JS_UNDEFINED, 1, argv));
            JS_FreeValue(impl_->runtime.context, callbackValue);
            if (JS_IsException(result.get())) {
                for (std::size_t j = i + 1; j < callbacks.size(); ++j) JS_FreeValue(impl_->runtime.context, callbacks[j].second);
                return {false, quickJsExceptionText(impl_->runtime.context)};
            }
        }
        const auto drained = impl_->drainJobs();
        return {drained.ok, drained.error};
    }

    ScriptExecutionResult QuickJsScriptHost::executeModule(const std::filesystem::path& modulePath, std::string_view source) {
        pendingTransactions_.clear();
        reloadRequested_ = false;
        reloadRequest_ = {};
        const auto normalizedModulePath = std::filesystem::absolute(modulePath).lexically_normal();
        impl_->initialise(this, normalizedModulePath);
        ScopedValue result(impl_->runtime.context, JS_Eval(impl_->runtime.context, source.data(), source.size(), normalizedModulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE));
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(impl_->runtime.context)};
        if (!impl_->runtime.nativeError.empty()) return {false, impl_->runtime.nativeError};
        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
        if (!impl_->runtime.nativeError.empty()) return {false, impl_->runtime.nativeError};
        reloadRequested_ = impl_->runtime.reloadRequested;
        reloadRequest_ = impl_->runtime.reloadRequest;
        const auto& pending = pendingTransactions_.pending();
        if (!pending || !pending->hasTreeMutations()) return {false, "Arrange app did not mount. Expected createApp(App).mount() to commit native mutations."};
        return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::invokeEventSlot(const arrange::core::EventSlotId& slot, const CallbackInvokeOptions& options) {
        if (impl_->runtime.context == nullptr) return {false, "QuickJS runtime is not initialised"};
        if (!slot.valid()) return {false, "Arrange event slot is invalid"};
        const auto callbackValue = impl_->runtime.events.callback(slot);
        if (JS_IsUndefined(callbackValue)) return {false, "Arrange event slot is not registered in QuickJS"};

        ScopedValue callback(impl_->runtime.context, JS_DupValue(impl_->runtime.context, callbackValue));
        pendingTransactions_.clear();
        JSValueConst* argv = nullptr;
        int argc = 0;
        JSValue argument = JS_UNDEFINED;
        if (options.hasStringArgument) {
            argument = JS_NewStringLen(impl_->runtime.context, options.stringArgument.data(), options.stringArgument.size());
            argv = &argument;
            argc = 1;
        }
        ScopedValue result(impl_->runtime.context, JS_Call(impl_->runtime.context, callback.get(), JS_UNDEFINED, argc, argv));
        if (options.hasStringArgument) JS_FreeValue(impl_->runtime.context, argument);
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(impl_->runtime.context)};
        if (!impl_->runtime.nativeError.empty()) return {false, impl_->runtime.nativeError};
        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
        if (!impl_->runtime.nativeError.empty()) return {false, impl_->runtime.nativeError};
        return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::invokeEventSlot(const arrange::core::EventSlotId& slot, const arrange::core::ScrollResult& scroll) {
        if (impl_->runtime.context == nullptr) return {false, "QuickJS runtime is not initialised"};
        if (!slot.valid()) return {false, "Arrange event slot is invalid"};
        const auto callbackValue = impl_->runtime.events.callback(slot);
        if (JS_IsUndefined(callbackValue)) return {false, "Arrange event slot is not registered in QuickJS"};

        ScopedValue argument(impl_->runtime.context, JS_NewObject(impl_->runtime.context));
        JS_SetPropertyStr(impl_->runtime.context, argument.get(), "value", JS_NewFloat64(impl_->runtime.context, scroll.value));
        JS_SetPropertyStr(impl_->runtime.context, argument.get(), "maxValue", JS_NewFloat64(impl_->runtime.context, scroll.maxValue));
        JS_SetPropertyStr(impl_->runtime.context, argument.get(), "viewportSize", JS_NewFloat64(impl_->runtime.context, scroll.viewportSize));
        JS_SetPropertyStr(impl_->runtime.context, argument.get(), "contentSize", JS_NewFloat64(impl_->runtime.context, scroll.contentSize));
        JS_SetPropertyStr(impl_->runtime.context, argument.get(), "isScrollInProgress", JS_NewBool(impl_->runtime.context, false));
        ScopedValue callback(impl_->runtime.context, JS_DupValue(impl_->runtime.context, callbackValue));
        pendingTransactions_.clear();
        JSValueConst argv[1] = {argument.get()};
        ScopedValue result(impl_->runtime.context, JS_Call(impl_->runtime.context, callback.get(), JS_UNDEFINED, 1, argv));
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(impl_->runtime.context)};
        if (!impl_->runtime.nativeError.empty()) return {false, impl_->runtime.nativeError};
        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
        if (!impl_->runtime.nativeError.empty()) return {false, impl_->runtime.nativeError};
        return {true, {}};
    }
} // namespace arrange::quickjs

#endif
