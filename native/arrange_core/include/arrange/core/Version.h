#pragma once

namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 7u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.4.0";
    const char* version() noexcept;
}
