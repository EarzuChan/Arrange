#include <arrange/quickjs/QuickJsScriptHost.h>

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsNativeApi.h"
#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <filesystem>
#include <string_view>
#include <utility>
#include <vector>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace arrange::quickjs {
    namespace {
        std::size_t scriptStackBudget() {
#if defined(_WIN32)
            ULONG_PTR lower = 0;
            ULONG_PTR upper = 0;
            GetCurrentThreadStackLimits(&lower, &upper);
            const auto current = reinterpret_cast<ULONG_PTR>(&lower);
            constexpr std::size_t hostReserve = 256 * 1024;
            if (current <= lower || current - lower <= hostReserve) throw std::runtime_error("Owner 线程没有足够的脚本栈空间");

            return (std::min)(std::size_t{2 * 1024 * 1024}, static_cast<std::size_t>(current - lower - hostReserve));
#else
            return 512 * 1024;
#endif
        }

        struct DrainJobsResult {
            bool ok = true;
            std::string error;
        };

        struct alignas(std::max_align_t) AllocationHeader {
            std::size_t size;
        };

        void* allocateScriptMemory(void* opaque, std::size_t size) {
            if (size > std::numeric_limits<std::size_t>::max() - sizeof(AllocationHeader)) return nullptr;
            auto* header = static_cast<AllocationHeader*>(std::malloc(sizeof(AllocationHeader) + size));
            if (!header) return nullptr;
            header->size = size;

            auto& stats = *static_cast<ScriptMemoryStats*>(opaque);
            ++stats.allocations;
            stats.allocatedBytes += size;
            stats.liveBytes += size;
            stats.peakBytes = std::max(stats.peakBytes, stats.liveBytes);
            return header + 1;
        }

        void freeScriptMemory(void* opaque, void* pointer) {
            if (!pointer) return;
            auto* header = static_cast<AllocationHeader*>(pointer) - 1;
            static_cast<ScriptMemoryStats*>(opaque)->liveBytes -= header->size;
            std::free(header);
        }

        void* resizeScriptMemory(void* opaque, void* pointer, std::size_t size) {
            if (!pointer) return allocateScriptMemory(opaque, size);
            if (!size) {
                freeScriptMemory(opaque, pointer);
                return nullptr;
            }
            if (size > std::numeric_limits<std::size_t>::max() - sizeof(AllocationHeader)) return nullptr;

            auto* previous = static_cast<AllocationHeader*>(pointer) - 1;
            const auto previousSize = previous->size;
            auto* header = static_cast<AllocationHeader*>(std::realloc(previous, sizeof(AllocationHeader) + size));
            if (!header) return nullptr;
            header->size = size;

            auto& stats = *static_cast<ScriptMemoryStats*>(opaque);
            ++stats.allocations;
            stats.allocatedBytes += size;
            stats.liveBytes = stats.liveBytes - previousSize + size;
            stats.peakBytes = std::max(stats.peakBytes, stats.liveBytes);
            return header + 1;
        }

        const JSMallocFunctions kScriptAllocator{
            [](void* opaque, std::size_t count, std::size_t size) -> void* {
                if (size && count > std::numeric_limits<std::size_t>::max() / size) return nullptr;
                auto* pointer = allocateScriptMemory(opaque, count * size);
                if (pointer) std::memset(pointer, 0, count * size);
                return pointer;
            },
            allocateScriptMemory,
            freeScriptMemory,
            resizeScriptMemory,
            [](const void* pointer) -> std::size_t { return pointer ? (static_cast<const AllocationHeader*>(pointer) - 1)->size : 0; },
        };
    }  // namespace

    struct QuickJsScriptHost::Impl {
        ScriptMemoryStats memory;
        QuickJsRuntimeContext runtime;

        ~Impl() {
            reset();
        }

        void reset() {
            if (runtime.context != nullptr) {
                runtime.painters.reset();
                JS_FreeValue(runtime.context, runtime.rearrangeCompletion);
                runtime.rearrangeCompletion = JS_UNDEFINED;
                if (runtime.rearrangeSubmission) runtime.rearrangeSubmission->cancelled = true;
                runtime.rearrangeSubmission.reset();
                runtime.rearrangeCheckpoint.reset();
                runtime.events.reset(nullptr);
                for (auto& [promise, reason] : runtime.unhandledRejections) {
                    JS_FreeValue(runtime.context, promise);
                    JS_FreeValue(runtime.context, reason);
                }
                runtime.unhandledRejections.clear();
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
            memory = {};
            runtime.rootNodeId = 0;
            runtime.nextAnimationFrameHandle = 1;
            runtime.frameTimeMillis = 0.0;
            runtime.publishedModifiers.clear();
            runtime.modifierInputs.clear();
            runtime.rejectedBindingUpdates = 0;
            runtime.remainingFrameJobs = QuickJsRuntimeContext::maxJobsPerFrame;
            runtime.pendingTransactions = nullptr;
            runtime.nodeTypes.clear();
            runtime.nodeGenerations.clear();
            runtime.hostBindings.clear();
            runtime.bindings.clear();
            runtime.modifierBindings.clear();
            runtime.childrenByNode.clear();
            runtime.parentByNode.clear();
            runtime.moduleLoader.clear();
            runtime.diagnosticEvents.clear();
            runtime.diagnosticActions.clear();
        }

        void initialise(QuickJsScriptHost* owner, const std::filesystem::path& entryPath) {
            reset();
            runtime.pendingTransactions = &owner->pendingTransactions_;
            runtime.moduleLoader.setModuleRoot(entryPath);
            runtime.runtime = JS_NewRuntime2(&kScriptAllocator, &memory);
            // 给宿主输入、布局与异常处理保留栈空间，先由引擎报告脚本栈溢出
            if (!runtime.runtime) throw std::bad_alloc();
            JS_SetMaxStackSize(runtime.runtime, scriptStackBudget());
            JS_SetModuleLoaderFunc(runtime.runtime, &QuickJsModuleLoader::normalize, &QuickJsModuleLoader::load, &runtime.moduleLoader);
            runtime.context = JS_NewContext(runtime.runtime);
            if (!runtime.context) throw std::bad_alloc();
            JS_SetHostPromiseRejectionTracker(
                runtime.runtime,
                [](JSContext* context, JSValueConst promise, JSValueConst reason, bool handled, void* opaque) {
                    auto& state = *static_cast<QuickJsRuntimeContext*>(opaque);
                    if (handled) {
                        std::erase_if(state.unhandledRejections, [&](const auto& entry) {
                            if (!JS_IsStrictEqual(context, promise, entry.first)) return false;
                            JS_FreeValue(context, entry.first);
                            JS_FreeValue(context, entry.second);
                            return true;
                        });
                    } else
                        state.unhandledRejections.emplace_back(JS_DupValue(context, promise), JS_DupValue(context, reason));
                },
                &runtime);
            runtime.events.reset(runtime.context);
            JS_SetContextOpaque(runtime.context, &runtime);
            runtime.painters = std::make_unique<QuickJsPainterResources>(runtime.context, runtime.painterLoader);
            QuickJsNativeApi::install(runtime.context, runtime);
        }

        DrainJobsResult drainJobs() {
            JSContext* jobContext = nullptr;
            while (JS_IsJobPending(runtime.runtime)) {
                if (runtime.remainingFrameJobs == 0) return {false, "Arrange JavaScript work did not stabilize within the frame job limit"};
                --runtime.remainingFrameJobs;
                if (JS_ExecutePendingJob(runtime.runtime, &jobContext) < 0) return {false, quickJsExceptionText(jobContext != nullptr ? jobContext : runtime.context)};
            }
            if (!runtime.unhandledRejections.empty()) {
                JS_Throw(runtime.context, JS_DupValue(runtime.context, runtime.unhandledRejections.front().second));
                return {false, quickJsExceptionText(runtime.context)};
            }
            return {};
        }
    };

    QuickJsScriptHost::QuickJsScriptHost() : impl_(std::make_unique<Impl>()) {}

    QuickJsScriptHost::~QuickJsScriptHost() = default;

    void QuickJsScriptHost::setPainterLoader(arrange::core::PainterLoader loader) {
        impl_->runtime.painterLoader = std::move(loader);
    }

    std::size_t QuickJsScriptHost::eventSlotCount() const noexcept {
        return impl_ ? impl_->runtime.events.size() : 0;
    }

    std::size_t QuickJsScriptHost::bindingCount() const noexcept {
        return impl_ ? impl_->runtime.bindings.size() : 0;
    }

    std::size_t QuickJsScriptHost::modifierInstanceCount() const noexcept {
        return impl_ ? impl_->runtime.publishedModifiers.size() : 0;
    }

    std::uint64_t QuickJsScriptHost::rejectedBindingUpdates() const noexcept {
        return impl_ ? impl_->runtime.rejectedBindingUpdates : 0;
    }

    ScriptMemoryStats QuickJsScriptHost::memoryStats() const noexcept {
        return impl_ ? impl_->memory : ScriptMemoryStats{};
    }

    CallbackInvokeResult QuickJsScriptHost::completeRearrange(const std::shared_ptr<arrange::core::RearrangeSubmission>& submission, const std::string& error) {
        if (!impl_) return {true, {}};
        auto& state = impl_->runtime;
        if (!submission || submission->cancelled || submission != state.rearrangeSubmission || JS_IsUndefined(state.rearrangeCompletion)) return {true, {}};
        const auto callback = state.rearrangeCompletion;
        state.rearrangeCompletion = JS_UNDEFINED;
        if (error.empty())
            state.commitRearrange();
        else
            state.abortRearrange();

        auto argument = error.empty() ? JS_UNDEFINED : JS_NewStringLen(state.context, error.data(), error.size());
        ScopedValue result(state.context, JS_Call(state.context, callback, JS_UNDEFINED, 1, &argument));
        JS_FreeValue(state.context, argument);
        JS_FreeValue(state.context, callback);
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(state.context)};
        const auto drained = impl_->drainJobs();
        return {drained.ok, drained.error};
    }

    void QuickJsScriptHost::publishScene(const arrange::core::NativeScene& scene) {
        if (!impl_) return;
        auto& state = impl_->runtime;
        state.events.publish(scene.activeEventSlots());
        state.publishedModifiers.clear();
        state.modifierInputs.clear();
        for (const auto& [id, generation] : state.nodeGenerations) {
            if (!scene.contains(id) || scene.node(id).generation != generation) continue;
            std::size_t position = 0;
            for (const auto& instance : scene.node(id).modifier.elements()) {
                const QuickJsRuntimeContext::PublishedModifier input{{id, generation}, instance.handle, instance.descriptor, position++};
                state.publishedModifiers.emplace(instance.handle.identity, input);
                state.modifierInputs[id].push_back(input);
            }
        }
        std::erase_if(state.bindings, [&](const auto& entry) {
            const auto* target = std::get_if<arrange::core::ModifierInputTarget>(&entry.second.target);
            if (!target) return false;
            const auto found = state.publishedModifiers.find(target->modifier.identity);
            return found == state.publishedModifiers.end() || found->second.handle != target->modifier;
        });
    }

    bool QuickJsScriptHost::hasPendingDiagnostics() const noexcept {
        return !impl_->runtime.diagnosticEvents.empty() || !impl_->runtime.diagnosticActions.empty();
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
        if (!impl_) return;
        auto& runtime = impl_->runtime;
        const auto timestamp = std::max(0.0, nowMillis);
        if (timestamp != runtime.frameTimeMillis) runtime.remainingFrameJobs = QuickJsRuntimeContext::maxJobsPerFrame;
        runtime.frameTimeMillis = timestamp;
    }

    bool QuickJsScriptHost::hasPendingAnimationFrame() const noexcept {
        return impl_ && (!impl_->runtime.animationFrameCallbacks.empty() || (impl_->runtime.painters && impl_->runtime.painters->hasPending()));
    }

    CallbackInvokeResult QuickJsScriptHost::pumpAnimationFrame(double nowMillis) {
        if (impl_->runtime.context == nullptr) return {false, "QuickJS runtime is not initialised"};
        setFrameTimeMillis(nowMillis);
        if (impl_->runtime.painters && !impl_->runtime.painters->pump()) return {false, quickJsExceptionText(impl_->runtime.context)};
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
        const auto normalizedModulePath = std::filesystem::absolute(modulePath).lexically_normal();
        impl_->initialise(this, normalizedModulePath);
        ScopedValue result(impl_->runtime.context, JS_Eval(impl_->runtime.context, source.data(), source.size(), normalizedModulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE));
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(impl_->runtime.context)};
        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
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
        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
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
        JSValueConst argv[1] = {argument.get()};
        ScopedValue result(impl_->runtime.context, JS_Call(impl_->runtime.context, callback.get(), JS_UNDEFINED, 1, argv));
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(impl_->runtime.context)};
        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
        return {true, {}};
    }
}  // namespace arrange::quickjs

#endif
