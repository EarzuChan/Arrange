#pragma once

#include <arrange/quickjs/QuickJsScriptHost.h>

#include <quickjs.h>

#include <array>
#include <cstddef>
#include <vector>

namespace arrange::quickjs {
    // QuickJS 运行时私有堆：小块按尺寸档从大块切出并复用，大块直通系统堆
    // 帧内大量短命对象不再逐个进出系统堆；宿主若给堆操作挂了钩子（如兼容层逐次抓栈），代价只落在大块与新块上
    class ScriptHeap final {
       public:
        ScriptHeap() = default;
        ~ScriptHeap();
        ScriptHeap(const ScriptHeap&) = delete;
        ScriptHeap& operator=(const ScriptHeap&) = delete;

        // 运行时释放后调用：归还全部大块并清零统计
        void reset() noexcept;

        const ScriptMemoryStats& stats() const noexcept {
            return stats_;
        }

        static const JSMallocFunctions functions;

        void* allocate(std::size_t size) noexcept;
        void release(void* pointer) noexcept;
        void* resize(void* pointer, std::size_t size) noexcept;

       private:
        struct FreeBlock {
            FreeBlock* next;
        };

        static constexpr std::size_t granule = 16;
        static constexpr std::size_t classCount = 32;
        static constexpr std::size_t chunkBytes = 64 * 1024;

        void* takeBlock(std::size_t sizeClass) noexcept;

        std::array<FreeBlock*, classCount> freeLists_{};
        std::vector<void*> chunks_;
        std::byte* cursor_ = nullptr;
        std::byte* limit_ = nullptr;
        ScriptMemoryStats stats_;
    };
}
