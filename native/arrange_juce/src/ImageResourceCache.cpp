#include <arrange/juce/ImageResourceCache.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/AppResolver.h>

#include <utility>

namespace arrange::juce {
    void ImageResourceCache::setPackageDir(std::filesystem::path packageDir) {
        packageDir = std::filesystem::absolute(std::move(packageDir)).lexically_normal();
        if (packageDir_ == packageDir) return;
        packageDir_ = std::move(packageDir);
        clear();
    }

    void ImageResourceCache::clear() {
        images_.clear();
        lastError_.reset();
    }

    ::juce::Image ImageResourceCache::load(const std::string& resource) {
        lastError_.reset();
        const auto cached = images_.find(resource);
        if (cached != images_.end()) return cached->second;

        const auto resolved = arrange::resolvePackageResource(packageDir_, resource);
        if (!resolved.ok) {
            lastError_ = makeErrorScreenModel(
                ErrorSource::Resource,
                resolved.error,
                "Check Image source paths and Vite public/assets output.",
                resolved.path.empty() ? resolved.packageDir : resolved.path);
            return {};
        }

        auto image = ::juce::ImageFileFormat::loadFrom(::juce::File(resolved.path.string()));
        if (!image.isValid()) {
            lastError_ = makeErrorScreenModel(
                ErrorSource::Resource,
                "Arrange image resource exists but cannot be decoded: " + resolved.path.string(),
                "Supported image formats are provided by JUCE ImageFileFormat.",
                resolved.path);
            return {};
        }

        images_.emplace(resource, image);
        return image;
    }
} // namespace arrange::juce

#endif
