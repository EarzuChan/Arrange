#include "QuickJsPainterResources.h"

#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsRuntimeContext.h"
#include "QuickJsValueReader.h"
#include <arrange/core/SlotUpdate.h>
#include <chrono>
#include <cmath>
#include <cstring>

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
    }

    QuickJsPainterResources::QuickJsPainterResources(JSContext* context, arrange::core::PainterLoader loader) : context_(context), loader_(std::move(loader)) {}

    QuickJsPainterResources::~QuickJsPainterResources() {
        for (auto& [_, resource] : resources_) JS_FreeValue(context_, resource.callback);
    }

    void QuickJsPainterResources::install(JSValueConst native) {
        JS_SetPropertyStr(context_, native, "acquirePainter", JS_NewCFunction(context_, acquire, "acquirePainter", 2));
        JS_SetPropertyStr(context_, native, "releasePainter", JS_NewCFunction(context_, release, "releasePainter", 1));
        JS_SetPropertyStr(context_, native, "createPixelBuffer", JS_NewCFunction(context_, createPixels, "createPixelBuffer", 2));
        JS_SetPropertyStr(context_, native, "commitPixelBuffer", JS_NewCFunction(context_, commitPixels, "commitPixelBuffer", 2));
    }

    JSValue QuickJsPainterResources::createPixels(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        std::int32_t width = 0, height = 0;
        if (argc != 2 || JS_ToInt32(context, &width, argv[0]) < 0 || JS_ToInt32(context, &height, argv[1]) < 0) return JS_ThrowTypeError(context, "createPixelBuffer 需要宽与高");
        if (width < 1 || height < 1 || width > 4096 || height > 4096 || static_cast<std::int64_t>(width) * height > 4 * 1024 * 1024) return JS_ThrowRangeError(context, "像素缓冲边长需要在 1 到 4096 之间，总像素不超过 4194304");
        auto& owner = resources(context);
        if (owner.resources_.size() >= 4096) return JS_ThrowRangeError(context, "Painter 活动资源超过 4096 项预算");
        Resource resource;
        resource.snapshot.identity = arrange::core::allocateRuntimeIdentity();
        resource.snapshot.generation = arrange::core::allocateRuntimeIdentity();
        auto content = std::make_shared<arrange::core::PixelBufferContent>();
        content->width = width;
        content->height = height;
        content->pixels.assign(static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0u);
        content->intrinsicSize = arrange::core::Size{static_cast<float>(width), static_cast<float>(height)};
        resource.snapshot.content = std::move(content);
        resource.snapshot.contentVersion = 1;
        const auto handle = resource.snapshot;
        owner.resources_.emplace(handle.identity, std::move(resource));
        const auto result = JS_NewObject(context);
        JS_SetPropertyStr(context, result, "identity", JS_NewBigUint64(context, handle.identity));
        JS_SetPropertyStr(context, result, "generation", JS_NewBigUint64(context, handle.generation));
        return result;
    }

    // 提交时整块复制像素，生成新内容与新版本；已发布帧继续持有旧内容
    JSValue QuickJsPainterResources::commitPixels(JSContext* context, JSValueConst, int argc, JSValueConst* argv) {
        if (argc != 2) return JS_ThrowTypeError(context, "commitPixelBuffer 需要句柄与像素");
        const auto handle = identity(context, argv[0]);
        if (!handle) return JS_EXCEPTION;
        auto& owner = resources(context);
        const auto found = owner.resources_.find(handle->first);
        const auto* current = found == owner.resources_.end() ? nullptr : dynamic_cast<const arrange::core::PixelBufferContent*>(found->second.snapshot.content.get());
        if (!current || found->second.snapshot.generation != handle->second) return JS_ThrowTypeError(context, "像素缓冲已释放或属于其他运行时代际");
        if (JS_GetTypedArrayType(argv[1]) != JS_TYPED_ARRAY_UINT32) return JS_ThrowTypeError(context, "像素缓冲数据需要 Uint32Array");
        std::size_t offset = 0, byteLength = 0, elementSize = 0;
        ScopedValue buffer(context, JS_GetTypedArrayBuffer(context, argv[1], &offset, &byteLength, &elementSize));
        if (JS_IsException(buffer.get())) return JS_EXCEPTION;
        std::size_t bufferSize = 0;
        const auto* bytes = JS_GetArrayBuffer(context, &bufferSize, buffer.get());
        const auto count = current->pixels.size();
        if (!bytes || offset + byteLength > bufferSize || byteLength != count * sizeof(std::uint32_t)) return JS_ThrowRangeError(context, "像素缓冲数据长度与尺寸不符");
        auto next = std::make_shared<arrange::core::PixelBufferContent>();
        next->width = current->width;
        next->height = current->height;
        next->intrinsicSize = current->intrinsicSize;
        next->pixels.resize(count);
        std::memcpy(next->pixels.data(), bytes + offset, byteLength);
        found->second.snapshot.content = std::move(next);
        ++found->second.snapshot.contentVersion;
        return JS_NewFloat64(context, static_cast<double>(found->second.snapshot.contentVersion));
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
        auto snapshot = found->second.snapshot;
        // filmstrip 视图：frames、frame 与方向随快照传入
        ScopedValue frames(context, JS_GetPropertyStr(context, value, "frames"));
        if (!JS_IsUndefined(frames.get())) {
            ScopedValue frame(context, JS_GetPropertyStr(context, value, "frame"));
            ScopedValue horizontal(context, JS_GetPropertyStr(context, value, "horizontal"));
            double count = 0, index = 0;
            if (JS_ToFloat64(context, &count, frames.get()) < 0 || JS_ToFloat64(context, &index, frame.get()) < 0 || !JS_IsBool(horizontal.get()) || count != std::floor(count) || index != std::floor(index) || count < 1 || count > 4096 || index < 0 || index >= count) {
                if (!JS_HasException(context)) JS_ThrowRangeError(context, "filmstrip 帧数需要在 1 到 4096 之间，帧下标不能越界");
                return std::nullopt;
            }
            snapshot.frames = static_cast<std::uint32_t>(count);
            snapshot.frame = static_cast<std::uint32_t>(index);
            snapshot.horizontal = JS_ToBool(context, horizontal.get()) != 0;
        }
        return snapshot;
    }
}

#endif
