#pragma once
namespace arrange::core {
    inline constexpr unsigned BridgeMagic = 0x0D000721u;
    inline constexpr unsigned BridgeVersion = 1u;
    const char* version() noexcept;
}
