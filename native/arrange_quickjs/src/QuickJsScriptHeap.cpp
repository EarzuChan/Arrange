#if ARRANGE_WITH_QUICKJS_NG

#include "QuickJsScriptHeap.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <limits>

namespace arrange::quickjs {
    namespace {
        struct alignas(std::max_align_t) AllocationHeader {
            std::size_t size;
        };

        constexpr std::size_t headerBytes = sizeof(AllocationHeader);

        AllocationHeader* headerOf(void* pointer) noexcept {
            return static_cast<AllocationHeader*>(pointer) - 1;
        }
    }

    ScriptHeap::~ScriptHeap() {
        reset();
    }

    void ScriptHeap::reset() noexcept {
        for (auto* chunk : chunks_) std::free(chunk);
        chunks_.clear();
        freeLists_ = {};
        cursor_ = limit_ = nullptr;
        stats_ = {};
    }

    void* ScriptHeap::takeBlock(std::size_t sizeClass) noexcept {
        if (auto* block = freeLists_[sizeClass]) {
            freeLists_[sizeClass] = block->next;
            return block;
        }
        const auto bytes = (sizeClass + 1) * granule;
        if (static_cast<std::size_t>(limit_ - cursor_) < bytes) {
            // 旧块剩余尾巴按最大可容纳档回收，不浪费
            while (cursor_ && static_cast<std::size_t>(limit_ - cursor_) >= granule) {
                const auto tail = static_cast<std::size_t>(limit_ - cursor_) / granule - 1;
                const auto take = std::min(tail, classCount - 1);
                auto* block = reinterpret_cast<FreeBlock*>(cursor_);
                block->next = freeLists_[take];
                freeLists_[take] = block;
                cursor_ += (take + 1) * granule;
            }
            if (chunks_.size() == chunks_.capacity()) {
                try {
                    chunks_.reserve(std::max<std::size_t>(16, chunks_.size() * 2));
                } catch (...) {
                    return nullptr;
                }
            }
            auto* chunk = static_cast<std::byte*>(std::malloc(chunkBytes));
            if (!chunk) return nullptr;
            ++stats_.systemAllocations;
            chunks_.push_back(chunk);
            cursor_ = chunk;
            limit_ = chunk + chunkBytes;
        }
        auto* block = cursor_;
        cursor_ += bytes;
        return block;
    }

    void* ScriptHeap::allocate(std::size_t size) noexcept {
        if (size > std::numeric_limits<std::size_t>::max() - headerBytes - granule) return nullptr;
        const auto total = headerBytes + size;
        AllocationHeader* header = nullptr;
        if (total <= classCount * granule) {
            header = static_cast<AllocationHeader*>(takeBlock((total - 1) / granule));
        } else {
            header = static_cast<AllocationHeader*>(std::malloc(total));
            if (header) ++stats_.systemAllocations;
        }
        if (!header) return nullptr;
        header->size = size;

        ++stats_.allocations;
        stats_.allocatedBytes += size;
        stats_.liveBytes += size;
        stats_.peakBytes = std::max(stats_.peakBytes, stats_.liveBytes);
        return header + 1;
    }

    void ScriptHeap::release(void* pointer) noexcept {
        if (!pointer) return;
        auto* header = headerOf(pointer);
        stats_.liveBytes -= header->size;
        const auto total = headerBytes + header->size;
        if (total > classCount * granule) {
            std::free(header);
            return;
        }
        const auto sizeClass = (total - 1) / granule;
        auto* block = reinterpret_cast<FreeBlock*>(header);
        block->next = freeLists_[sizeClass];
        freeLists_[sizeClass] = block;
    }

    void* ScriptHeap::resize(void* pointer, std::size_t size) noexcept {
        if (!pointer) return allocate(size);
        if (!size) {
            release(pointer);
            return nullptr;
        }
        if (size > std::numeric_limits<std::size_t>::max() - headerBytes - granule) return nullptr;

        auto* previous = headerOf(pointer);
        const auto previousSize = previous->size;
        const auto pooledLimit = classCount * granule;
        const auto previousTotal = headerBytes + previousSize;
        const auto total = headerBytes + size;
        AllocationHeader* header = nullptr;
        if (previousTotal > pooledLimit && total > pooledLimit) {
            header = static_cast<AllocationHeader*>(std::realloc(previous, total));
            if (!header) return nullptr;
            ++stats_.systemAllocations;
        } else if (previousTotal <= pooledLimit && total <= pooledLimit && (previousTotal - 1) / granule == (total - 1) / granule) {
            header = previous;
        } else {
            auto* moved = allocate(size);
            if (!moved) return nullptr;
            std::memcpy(moved, pointer, std::min(previousSize, size));
            release(pointer);
            // allocate 与 release 已各自记账，这里只按一次逻辑分配计
            return moved;
        }
        header->size = size;

        ++stats_.allocations;
        stats_.allocatedBytes += size;
        stats_.liveBytes = stats_.liveBytes - previousSize + size;
        stats_.peakBytes = std::max(stats_.peakBytes, stats_.liveBytes);
        return header + 1;
    }

    const JSMallocFunctions ScriptHeap::functions{
        [](void* opaque, std::size_t count, std::size_t size) -> void* {
            if (size && count > std::numeric_limits<std::size_t>::max() / size) return nullptr;
            auto* pointer = static_cast<ScriptHeap*>(opaque)->allocate(count * size);
            if (pointer) std::memset(pointer, 0, count * size);
            return pointer;
        },
        [](void* opaque, std::size_t size) -> void* { return static_cast<ScriptHeap*>(opaque)->allocate(size); },
        [](void* opaque, void* pointer) { static_cast<ScriptHeap*>(opaque)->release(pointer); },
        [](void* opaque, void* pointer, std::size_t size) -> void* { return static_cast<ScriptHeap*>(opaque)->resize(pointer, size); },
        [](const void* pointer) -> std::size_t { return pointer ? (static_cast<const AllocationHeader*>(pointer) - 1)->size : 0; },
    };
}

#endif
