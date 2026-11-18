#pragma once

#include <filesystem>
#include <string>
#include <string_view>

namespace arrange::quickjs {
    inline std::string resolvePackageModule(std::string_view from, std::string_view specifier) {
        if (from.empty() || !(specifier.starts_with("./") || specifier.starts_with("../")) || specifier.find_first_of("\\:?#") != std::string_view::npos) return {};
        const auto source = std::filesystem::path(std::u8string(from.begin(), from.end()));
        const auto relative = std::filesystem::path(std::u8string(specifier.begin(), specifier.end()));
        const auto name = (source.parent_path() / relative).lexically_normal().generic_u8string();
        if (name.starts_with(u8"../") || name == u8"..") return {};
        return {name.begin(), name.end()};
    }
}
