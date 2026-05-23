#pragma once

#include <filesystem>
#include <string>
#include <utility>

namespace arrange {
    class App {
    public:
        App() = default;

        App& useDist(std::filesystem::path path = std::filesystem::path("ui")) {
            distEnabled_ = true;
            distPath_ = std::move(path);
            return *this;
        }

        App& useLive(std::string url = {}) {
            liveEnabled_ = true;
            liveUrl_ = std::move(url);
            return *this;
        }

        const std::filesystem::path& distPath() const noexcept { return distPath_; }
        const std::string& liveUrl() const noexcept { return liveUrl_; }
        bool hasDist() const noexcept { return distEnabled_; }
        bool hasLive() const noexcept { return liveEnabled_; }
        bool hasAnySource() const noexcept { return liveEnabled_ || distEnabled_; }

    private:
        std::filesystem::path distPath_;
        std::string liveUrl_;
        bool distEnabled_ = false;
        bool liveEnabled_ = false;
    };
} // namespace arrange
