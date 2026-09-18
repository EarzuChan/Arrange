#include "AllocationProbe.h"

#include <cstdlib>
#include <new>

namespace {
    thread_local bool recording = false;
    thread_local arrange::test::AllocationStats allocations;

    void record(std::size_t size) noexcept {
        if (!recording) return;
        ++allocations.count;
        allocations.bytes += size;
    }
}

namespace arrange::test {
    void beginAllocationProbe() noexcept {
        allocations = {};
        recording = true;
    }

    AllocationStats endAllocationProbe() noexcept {
        recording = false;
        return allocations;
    }
}

// 仅链接验收程序，统计当前 UI 线程实际经过 C++ new 的分配
void* operator new(std::size_t size) {
    if (void* pointer = std::malloc(size ? size : 1)) {
        record(size);
        return pointer;
    }
    throw std::bad_alloc();
}

void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* pointer) noexcept { std::free(pointer); }
void operator delete[](void* pointer) noexcept { std::free(pointer); }
void operator delete(void* pointer, std::size_t) noexcept { std::free(pointer); }
void operator delete[](void* pointer, std::size_t) noexcept { std::free(pointer); }
