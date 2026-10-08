#pragma once

#include <cstddef>
#include <cstdint>

namespace arrange::test {
    struct AllocationStats {
        std::uint64_t count = 0;
        std::uint64_t bytes = 0;
    };

    void beginAllocationProbe() noexcept;
    AllocationStats endAllocationProbe() noexcept;
}
