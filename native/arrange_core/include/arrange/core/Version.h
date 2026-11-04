#pragma once

namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 10u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.7.0";
    const char* version() noexcept;
}
