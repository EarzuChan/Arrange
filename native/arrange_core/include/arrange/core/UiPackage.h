#pragma once

#include <cstddef>
#include <functional>
#include <future>
#include <string>
#include <string_view>

namespace arrange::core {
    enum class UiEntryKind { Module, Asset };
    enum class UiScriptFormat { Js, Bytecode };

    class UiPackage {
       public:
        virtual ~UiPackage() = default;
        virtual UiScriptFormat scriptFormat() const noexcept = 0;
        virtual std::string_view entry() const noexcept = 0;
        virtual std::string read(std::string_view path, UiEntryKind kind, std::size_t limit) const = 0;
    };

    inline constexpr std::size_t UiEntryLimit = 64 * 1024 * 1024;
    using AssetLoader = std::function<std::future<std::string>(std::string, std::function<void()>)>;
}
