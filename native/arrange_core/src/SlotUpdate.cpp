#include <arrange/core/SlotUpdate.h>

#include <atomic>

namespace arrange::core {
    std::uint64_t allocateRuntimeIdentity() {
        static std::atomic<std::uint64_t> next{1};
        return next.fetch_add(1, std::memory_order_relaxed);
    }
}  // namespace arrange::core
