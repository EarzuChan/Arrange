#pragma once

#include <arrange/core/UiPackage.h>
#include <filesystem>
#include <memory>

namespace arrange::juce {
    std::shared_ptr<const core::UiPackage> mountUiPackage(const std::filesystem::path& path);
    std::string packageAssetName(std::string_view reference);
}
