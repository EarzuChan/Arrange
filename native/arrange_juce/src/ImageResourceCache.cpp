#include <arrange/juce/ImageResourceCache.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/AppResolver.h>

#include <arrange/core/Paint.h>

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
        failures_.clear();
        lastError_.reset();
    }

    ImageResourceCache::PrepareResult ImageResourceCache::prepare(const std::vector<arrange::core::DrawOp>& ops) {
        PrepareResult aggregate;
        for (const auto& op : ops) {
            if (op.type != arrange::core::DrawOpType::DrawImage || op.resource.empty()) {
                continue;
            }
            const auto result = prepare(op.resource);
            aggregate.changed = aggregate.changed || result.changed;
            if (result.error) {
                aggregate.error = std::move(result.error);
                return aggregate;
            }
        }
        return aggregate;
    }

    ImageResourceCache::PrepareResult ImageResourceCache::prepare(const std::string& resource) {
        lastError_.reset();
        if (resource.empty()) return {};
        if (images_.find(resource) != images_.end()) return {};
        if (const auto failed = failures_.find(resource); failed != failures_.end()) {
            lastError_ = failed->second;
            return {false, failed->second};
        }

        const auto resolved = arrange::resolvePackageResource(packageDir_, resource);
        if (!resolved.ok) {
            lastError_ = makeErrorScreenModel(
                ErrorSource::Resource,
                resolved.error,
                "Check Image source paths and Vite public/assets output.",
                resolved.path.empty() ? resolved.packageDir : resolved.path);
            failures_.emplace(resource, *lastError_);
            return {true, *lastError_};
        }

        auto image = ::juce::ImageFileFormat::loadFrom(::juce::File(resolved.path.string()));
        if (!image.isValid()) {
            lastError_ = makeErrorScreenModel(
                ErrorSource::Resource,
                "Arrange image resource exists but cannot be decoded: " + resolved.path.string(),
                "Supported image formats are provided by JUCE ImageFileFormat.",
                resolved.path);
            failures_.emplace(resource, *lastError_);
            return {true, *lastError_};
        }

        images_.emplace(resource, image);
        return {true, std::nullopt};
    }

    ::juce::Image ImageResourceCache::find(const std::string& resource) const {
        const auto cached = images_.find(resource);
        if (cached != images_.end()) return cached->second;
        return {};
    }

} // namespace arrange::juce

#endif
