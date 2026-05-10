#pragma once

#include <arrange/core/Paint.h>
#include <arrange/juce/ErrorScreenModel.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    class ImageResourceCache final {
    public:
        struct PrepareResult {
            bool changed = false;
            std::optional<ErrorScreenModel> error;
        };

        void setPackageDir(std::filesystem::path packageDir);
        void clear();

        [[nodiscard]] PrepareResult prepare(const std::vector<arrange::core::DrawOp>& ops);
        [[nodiscard]] PrepareResult prepare(const std::string& resource);
        [[nodiscard]] ::juce::Image find(const std::string& resource) const;
        const std::optional<ErrorScreenModel>& lastError() const noexcept { return lastError_; }

    private:
        std::filesystem::path packageDir_;
        std::unordered_map<std::string, ::juce::Image> images_;
        std::unordered_map<std::string, ErrorScreenModel> failures_;
        std::optional<ErrorScreenModel> lastError_;
    };

#endif
} // namespace arrange::juce
