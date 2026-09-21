#include <arrange/quickjs/QuickJsScriptHost.h>

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsNativeApi.h"
#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"

#include <algorithm>
#include <chrono>
#include <thread>
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
        explicit Impl(ScriptExecutionLimits value) : limits(value) {
            if (limits.semanticMillis <= 0 || limits.visualMillis <= 0 || limits.moduleMillis <= 0) throw std::invalid_argument("脚本任务预算必须为正数");
        }

        const ScriptExecutionLimits limits;
        ScriptMemoryStats memory;
        QuickJsRuntimeContext runtime;

        ~Impl() {
            reset();
        }

        void reset() {
            if (runtime.context != nullptr) {
                TaskBudget budget(*this);
                if (JS_IsFunction(runtime.context, runtime.disposeApp)) {
                    ScopedValue callback(runtime.context, JS_DupValue(runtime.context, runtime.disposeApp));
                    ScopedValue disposed(runtime.context, JS_Call(runtime.context, callback.get(), JS_UNDEFINED, 0, nullptr));
                    if (JS_IsException(disposed.get())) (void)quickJsExceptionText(runtime.context);
                }
                JS_FreeValue(runtime.context, runtime.prepareFrame);
                JS_FreeValue(runtime.context, runtime.completeFrame);
                JS_FreeValue(runtime.context, runtime.disposeApp);
                runtime.prepareFrame = runtime.completeFrame = runtime.disposeApp = JS_UNDEFINED;
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
            runtime.frameRequested = false;
            runtime.framePrepared = false;
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
            JS_SetInterruptHandler(
                runtime.runtime,
                [](JSRuntime*, void* opaque) {
                    const auto& owner = *static_cast<Impl*>(opaque);
                    return owner.taskDepth && std::chrono::steady_clock::now() >= owner.deadline ? 1 : 0;
                },
                this);
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

        struct TaskBudget {
            Impl& owner;

            explicit TaskBudget(Impl& value, int milliseconds = 0) : owner(value) {
                if (owner.ownerThread != std::this_thread::get_id()) throw std::runtime_error("QuickJS 只能由创建它的 UI Owner 线程执行");
                if (owner.taskDepth++ == 0) {
                    owner.deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(milliseconds ? milliseconds : owner.limits.semanticMillis);
                    owner.runtime.remainingFrameJobs = QuickJsRuntimeContext::maxJobsPerFrame;
                }
            }

            ~TaskBudget() {
                --owner.taskDepth;
            }
        };

        const std::thread::id ownerThread = std::this_thread::get_id();
        unsigned taskDepth = 0;
        std::chrono::steady_clock::time_point deadline;

        DrainJobsResult drainJobs() {
            JSContext* jobContext = nullptr;
            while (JS_IsJobPending(runtime.runtime)) {
                if (runtime.remainingFrameJobs == 0) return {false, "JavaScript 语义任务超过检查点数量预算"};
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

    QuickJsScriptHost::QuickJsScriptHost(ScriptExecutionLimits limits) : impl_(std::make_unique<Impl>(limits)) {}

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
        Impl::TaskBudget budget(*impl_);
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

    void QuickJsScriptHost::setOwnerWake(std::function<void()> wake) {
        impl_->runtime.wakeOwner = std::move(wake);
    }

    CallbackInvokeResult QuickJsScriptHost::semanticCheckpoint(double nowMillis) {
        Impl::TaskBudget budget(*impl_);
        auto& state = impl_->runtime;
        if (!state.context) return {true, {}};
        if (state.framePrepared) return {false, "语义检查点不能重入视觉提交"};
        setFrameTimeMillis(nowMillis);
        state.remainingFrameJobs = QuickJsRuntimeContext::maxJobsPerFrame;
        if (state.painters && !state.painters->pump()) return {false, quickJsExceptionText(state.context)};
        const auto drained = impl_->drainJobs();
        return {drained.ok, drained.error};
    }

    bool QuickJsScriptHost::hasPendingSemanticWork() const noexcept {
        return impl_ && impl_->runtime.context && (JS_IsJobPending(impl_->runtime.runtime) || (impl_->runtime.painters && impl_->runtime.painters->hasPending()));
    }

    bool QuickJsScriptHost::hasPendingVisualWork() const noexcept {
        return impl_ && impl_->runtime.frameRequested;
    }

    CallbackInvokeResult QuickJsScriptHost::prepareVisualFrame(double nowMillis) {
        Impl::TaskBudget budget(*impl_, impl_->limits.visualMillis);
        auto& state = impl_->runtime;
        if (!state.context) return {false, "QuickJS 运行时尚未初始化"};
        if (state.framePrepared) return {false, "视觉帧不能重入"};
        setFrameTimeMillis(nowMillis);
        if (!state.frameRequested || JS_IsUndefined(state.prepareFrame)) return {true, {}};

        state.frameRequested = false;
        state.framePrepared = true;
        ScopedValue timestamp(state.context, JS_NewFloat64(state.context, state.frameTimeMillis));
        JSValueConst argv[] = {timestamp.get()};
        ScopedValue result(state.context, JS_Call(state.context, state.prepareFrame, JS_UNDEFINED, 1, argv));
        if (JS_IsException(result.get())) {
            const auto error = quickJsExceptionText(state.context);
            state.abortRearrange();
            (void)completeVisualFrame(false);
            return {false, error};
        }
        return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::completeVisualFrame(bool success) {
        Impl::TaskBudget budget(*impl_);
        auto& state = impl_->runtime;
        if (!state.framePrepared) return {true, {}};
        state.framePrepared = false;
        ScopedValue argument(state.context, JS_NewBool(state.context, success));
        JSValueConst argv[] = {argument.get()};
        ScopedValue result(state.context, JS_Call(state.context, state.completeFrame, JS_UNDEFINED, 1, argv));
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(state.context)};
        const auto drained = impl_->drainJobs();
        return {drained.ok, drained.error};
    }

    ScriptExecutionResult QuickJsScriptHost::executeModule(const std::filesystem::path& modulePath, std::string_view source) {
        pendingTransactions_.clear();
        const auto normalizedModulePath = std::filesystem::absolute(modulePath).lexically_normal();
        impl_->initialise(this, normalizedModulePath);
        Impl::TaskBudget budget(*impl_, impl_->limits.moduleMillis);
        ScopedValue result(impl_->runtime.context, JS_Eval(impl_->runtime.context, source.data(), source.size(), normalizedModulePath.generic_string().c_str(), JS_EVAL_TYPE_MODULE));
        if (JS_IsException(result.get())) return {false, quickJsExceptionText(impl_->runtime.context)};
        const auto drained = impl_->drainJobs();
        if (!drained.ok) return {false, drained.error};
        const auto& pending = pendingTransactions_.pending();
        if ((!pending || !pending->hasTreeMutations()) && JS_IsUndefined(impl_->runtime.prepareFrame)) return {false, "应用未挂载：需要 createApp(App).mount() 安装帧驱动"};
        return {true, {}};
    }

    CallbackInvokeResult QuickJsScriptHost::invokeEventSlot(const arrange::core::EventSlotId& slot, const CallbackInvokeOptions& options) {
        Impl::TaskBudget budget(*impl_);
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
        Impl::TaskBudget budget(*impl_);
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
