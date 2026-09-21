#include "QuickJsPainterResources.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"
#include <arrange/core/SlotUpdate.h>
#include <chrono>

namespace arrange::quickjs {
    namespace {
        QuickJsPainterResources& resources(JSContext* context) {
            return *static_cast<QuickJsRuntimeContext*>(JS_GetContextOpaque(context))->painters;
        }

        std::optional<std::pair<std::uint64_t, std::uint64_t>> identity(JSContext* context, JSValueConst value) {
            ScopedValue id(context, JS_GetPropertyStr(context, value, "identity"));
            ScopedValue generation(context, JS_GetPropertyStr(context, value, "generation"));
            std::uint64_t a = 0, b = 0;
            if (!JS_IsBigInt(id.get()) || !JS_IsBigInt(generation.get()) || JS_ToBigUint64(context, &a, id.get()) < 0 || JS_ToBigUint64(context, &b, generation.get()) < 0) {
                JS_ThrowTypeError(context, "Painter 身份与代际必须是 uint64 bigint");
                return std::nullopt;
            }
            ScopedValue canonicalId(context, JS_NewBigUint64(context, a));
            ScopedValue canonicalGeneration(context, JS_NewBigUint64(context, b));
            if (!JS_IsStrictEqual(context, id.get(), canonicalId.get()) || !JS_IsStrictEqual(context, generation.get(), canonicalGeneration.get())) {
                JS_ThrowRangeError(context, "Painter 身份超出 uint64 范围");
                return std::nullopt;
            }
            return std::pair{a, b};
        }
    }  // namespace

    QuickJsPainterResources::QuickJsPainterResources(JSContext* context, arrange::core::PainterLoader loader) : context_(context), loader_(std::move(loader)) {}

    QuickJsPainterResources::~QuickJsPainterResources() {
        for (auto& [_, resource] : resources_) JS_FreeValue(context_, resource.callback);
    }

    void QuickJsPainterResources::install(JSValueConst native) {
        JS_SetPropertyStr(context_, native, "acquirePainter", JS_NewCFunction(context_, acquire, "acquirePainter", 2));
        JS_SetPropertyStr(context_, native, "releasePainter", JS_NewCFunction(context_, release, "releasePainter", 1));
    }

    JSValue QuickJsPainterResources::acquire(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        if (argc != 2 || !JS_IsString(argv[0]) || !JS_IsFunction(context, argv[1])) return JS_ThrowTypeError(context, "acquirePainter 需要资源地址与完成回调");
        auto& owner = resources(context);
        if (owner.resources_.size() >= 4096) return JS_ThrowRangeError(context, "Painter 活动资源超过 4096 项预算");
        if (!owner.loader_) return JS_ThrowTypeError(context, "当前宿主未配置 Painter 资源加载器");
        QuickJsValueReader reader(context);
        const auto location = reader.toString(argv[0]);
        if (location.empty()) return JS_ThrowTypeError(context, "Painter 资源地址不能为空");
        Resource resource;
        resource.snapshot.identity = arrange::core::allocateRuntimeIdentity();
        resource.snapshot.generation = arrange::core::allocateRuntimeIdentity();
        try {
            resource.pending = owner.loader_(location, static_cast<QuickJsRuntimeContext*>(JS_GetContextOpaque(context))->wakeOwner);
        } catch (const std::exception& error) {
            return JS_ThrowInternalError(context, "Painter 请求失败：%s", error.what());
        }
        if (!resource.pending.valid()) return JS_ThrowInternalError(context, "Painter 加载器未返回有效请求");

        const auto handle = resource.snapshot;
        resource.callback = JS_DupValue(context, argv[1]);
        owner.resources_.emplace(handle.identity, std::move(resource));
        const auto result = JS_NewObject(context);
        JS_SetPropertyStr(context, result, "identity", JS_NewBigUint64(context, handle.identity));
        JS_SetPropertyStr(context, result, "generation", JS_NewBigUint64(context, handle.generation));
        return result;
    }

    JSValue QuickJsPainterResources::release(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        if (argc != 1) return JS_ThrowTypeError(context, "releasePainter 需要 Painter 身份");
        const auto handle = identity(context, argv[0]);
        if (!handle) return JS_EXCEPTION;
        auto& owner = resources(context);
        const auto found = owner.resources_.find(handle->first);
        if (found != owner.resources_.end() && found->second.snapshot.generation == handle->second) {
            JS_FreeValue(context, found->second.callback);
            owner.resources_.erase(found);
        }
        return JS_UNDEFINED;
    }

    bool QuickJsPainterResources::hasPending() const {
        for (const auto& [_, resource] : resources_)
            if (resource.pending.valid()) return true;
        return false;
    }

    bool QuickJsPainterResources::pump() {
        // 先收集身份，回调可以释放自身或发起其他请求，不能持有会失效的迭代器
        std::vector<std::uint64_t> ready;
        for (auto& [id, resource] : resources_) {
            if (resource.pending.valid() && resource.pending.wait_for(std::chrono::seconds(0)) == std::future_status::ready) ready.push_back(id);
        }
        for (const auto id : ready) {
            const auto found = resources_.find(id);
            if (found == resources_.end()) continue;
            auto& resource = found->second;
            arrange::core::PainterLoadResult loaded;
            try {
                loaded = resource.pending.get();
            } catch (const std::exception& error) {
                loaded.error = error.what();
            }
            if (!loaded.content && loaded.error.empty()) loaded.error = "Painter 加载器未返回绘制内容";
            if (loaded.error.empty()) resource.snapshot.content = std::move(loaded.content);
            ++resource.snapshot.contentVersion;
            ScopedValue completion(context_, JS_NewObject(context_));
            JS_SetPropertyStr(context_, completion.get(), "contentVersion", JS_NewFloat64(context_, static_cast<double>(resource.snapshot.contentVersion)));
            if (!loaded.error.empty()) JS_SetPropertyStr(context_, completion.get(), "error", JS_NewString(context_, loaded.error.c_str()));
            if (resource.snapshot.content && resource.snapshot.content->intrinsicSize) {
                const auto size = *resource.snapshot.content->intrinsicSize;
                JS_SetPropertyStr(context_, completion.get(), "width", JS_NewFloat64(context_, size.width));
                JS_SetPropertyStr(context_, completion.get(), "height", JS_NewFloat64(context_, size.height));
            }
            ScopedValue callback(context_, resource.callback);
            resource.callback = JS_UNDEFINED;
            JSValueConst args[]{completion.get()};
            ScopedValue result(context_, JS_Call(context_, callback.get(), JS_UNDEFINED, 1, args));
            if (JS_IsException(result.get())) return false;
        }
        return true;
    }

    std::optional<arrange::core::PainterSnapshot> QuickJsPainterResources::read(JSContext* context, JSValueConst value) {
        const auto handle = identity(context, value);
        if (!handle) return std::nullopt;
        if (handle->first == 0 && handle->second == 0) return arrange::core::PainterSnapshot{};
        auto& owner = resources(context);
        const auto found = owner.resources_.find(handle->first);
        if (found == owner.resources_.end() || found->second.snapshot.generation != handle->second) {
            JS_ThrowTypeError(context, "Painter 已退休或属于其他运行时代际");
            return std::nullopt;
        }
        ScopedValue version(context, JS_GetPropertyStr(context, value, "contentVersion"));
        double requested = 0;
        if (!JS_IsNumber(version.get()) || JS_ToFloat64(context, &requested, version.get()) < 0 || requested != static_cast<double>(found->second.snapshot.contentVersion)) {
            JS_ThrowTypeError(context, "Painter 内容版本已过期");
            return std::nullopt;
        }
        return found->second.snapshot;
    }
}  // namespace arrange::quickjs

#endif
