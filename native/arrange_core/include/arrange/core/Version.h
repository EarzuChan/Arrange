#pragma once

namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 6u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.0.0-m.3.0";
    const char* version() noexcept;
}
