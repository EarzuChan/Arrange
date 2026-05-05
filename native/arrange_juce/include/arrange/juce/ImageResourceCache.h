#pragma once

#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ImageResourceCache final {
    public:
        void setPackageDir(std::filesystem::path packageDir);
        void clear();

        ::juce::Image load(const std::string& resource);
        const std::optional<ErrorScreenModel>& lastError() const noexcept { return lastError_; }

    private:
        std::filesystem::path packageDir_;
        std::unordered_map<std::string, ::juce::Image> images_;
        std::optional<ErrorScreenModel> lastError_;
    };

#endif
} // namespace arrange::juce
