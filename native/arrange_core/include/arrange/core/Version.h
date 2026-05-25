#pragma once
namespace arrange::core {
    inline constexpr unsigned RuntimeVersion = 1u;
    inline constexpr unsigned ProtocolVersion = RuntimeVersion;
    inline constexpr const char* PackageVersion = "0.0.0-m.2.0";
    const char* version() noexcept;
}
