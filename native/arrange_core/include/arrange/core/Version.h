#pragma once

namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 8u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.5.0";
    const char* version() noexcept;
}
