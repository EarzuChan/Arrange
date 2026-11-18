#pragma once

namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 12u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.12.1";
    const char* version() noexcept;
}
