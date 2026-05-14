#include <arrange/juce/ImageResourceCache.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/AppResolver.h>

#include <fstream>
#include <sstream>
#include <utility>

namespace arrange::juce {
    namespace {
        std::string extensionLower(const std::filesystem::path& path) {
            auto ext = path.extension().string();
            for (auto& ch : ext) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
            return ext;
        }
    } // namespace

    void ImageResourceCache::setPackageDir(std::filesystem::path packageDir) {
        packageDir = std::filesystem::absolute(std::move(packageDir)).lexically_normal();
        if (packageDir_ == packageDir) return;
        packageDir_ = std::move(packageDir);
        clear();
    }

    void ImageResourceCache::clear() {
        images_.clear();
        icons_.clear();
        failures_.clear();
        lastError_.reset();
    }

    ImageResourceCache::PrepareResult ImageResourceCache::prepare(const std::vector<arrange::core::DrawOp>& ops) {
        PrepareResult aggregate;
        for (const auto& op : ops) {
            if ((op.type != arrange::core::DrawOpType::DrawImage && op.type != arrange::core::DrawOpType::DrawIcon) || op.resource.empty()) {
                continue;
            }
            const auto result = op.type == arrange::core::DrawOpType::DrawIcon ? prepareIcon(op.resource) : prepareImage(op.resource);
            aggregate.changed = aggregate.changed || result.changed;
            if (result.error) {
                aggregate.error = std::move(result.error);
                return aggregate;
            }
        }
        return aggregate;
    }

    ImageResourceCache::PrepareResult ImageResourceCache::prepare(const std::string& resource) {
        return prepareImage(resource);
    }

    ImageResourceCache::PrepareResult ImageResourceCache::prepareImage(const std::string& resource) {
        return prepareResource(resource, false);
    }

    ImageResourceCache::PrepareResult ImageResourceCache::prepareIcon(const std::string& resource) {
        return prepareResource(resource, true);
    }

    ImageResourceCache::PrepareResult ImageResourceCache::prepareResource(const std::string& resource, bool icon) {
        lastError_.reset();
        if (resource.empty()) return {};
        if (!icon && images_.find(resource) != images_.end()) return {};
        if (icon && icons_.find(resource) != icons_.end()) return {};
        if (const auto failed = failures_.find(resource); failed != failures_.end()) {
            lastError_ = failed->second;
            return {false, failed->second};
        }

        const auto resolved = arrange::resolvePackageResource(packageDir_, resource);
        if (!resolved.ok) {
            lastError_ = makeErrorScreenModel(
                ErrorSource::Resource,
                resolved.error,
                icon ? "Check Icon SVG source paths and Vite public/assets output." : "Check Image source paths and Vite public/assets output.",
                resolved.path.empty() ? resolved.packageDir : resolved.path);
            failures_.emplace(resource, *lastError_);
            return {true, *lastError_};
        }

        if (icon) {
            if (!isSvgPath(resolved.path)) {
                lastError_ = makeErrorScreenModel(
                    ErrorSource::Resource,
                    "Arrange icon resource must be an SVG file: " + resolved.path.string(),
                    "M1 Icon supports SVG resources only.",
                    resolved.path);
                failures_.emplace(resource, *lastError_);
                return {true, *lastError_};
            }
            auto drawable = loadSvg(resolved.path);
            if (!drawable) {
                lastError_ = makeErrorScreenModel(
                    ErrorSource::Resource,
                    "Arrange icon SVG exists but cannot be parsed: " + resolved.path.string(),
                    "Supported SVG subset is handled by JUCE Drawable.",
                    resolved.path);
                failures_.emplace(resource, *lastError_);
                return {true, *lastError_};
            }
            icons_.emplace(resource, std::move(drawable));
            return {true, std::nullopt};
        }

        auto image = loadImage(resolved.path);
        if (!image || !image->isValid()) {
            lastError_ = makeErrorScreenModel(
                ErrorSource::Resource,
                "Arrange image resource exists but cannot be decoded: " + resolved.path.string(),
                "Supported image formats are provided by JUCE ImageFileFormat.",
                resolved.path);
            failures_.emplace(resource, *lastError_);
            return {true, *lastError_};
        }

        images_.emplace(resource, *image);
        return {true, std::nullopt};
    }

    ::juce::Image ImageResourceCache::find(const std::string& resource) const {
        const auto cached = images_.find(resource);
        if (cached != images_.end()) return cached->second;
        return {};
    }

    std::optional<::juce::Drawable*> ImageResourceCache::findIcon(const std::string& resource) const {
        const auto cached = icons_.find(resource);
        if (cached == icons_.end()) return std::nullopt;
        return cached->second.get();
    }

    bool ImageResourceCache::isSvgPath(const std::filesystem::path& path) {
        return extensionLower(path) == ".svg";
    }

    std::optional<::juce::Image> ImageResourceCache::loadImage(const std::filesystem::path& path) {
        auto image = ::juce::ImageFileFormat::loadFrom(::juce::File(path.string()));
        if (!image.isValid()) return std::nullopt;
        return image;
    }

    std::unique_ptr<::juce::Drawable> ImageResourceCache::loadSvg(const std::filesystem::path& path) {
        const auto file = ::juce::File(path.string());
        std::unique_ptr<::juce::XmlElement> svg(::juce::XmlDocument::parse(file));
        if (!svg) return {};
        if (!svg->hasTagName("svg")) return {};
        return ::juce::Drawable::createFromSVG(*svg);
    }

} // namespace arrange::juce

#endif
