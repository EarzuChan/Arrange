#pragma once

namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 11u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.9.0";
    const char* version() noexcept;
}
