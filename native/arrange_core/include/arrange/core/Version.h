#pragma once

namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 9u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.6.0";
    const char* version() noexcept;
}
