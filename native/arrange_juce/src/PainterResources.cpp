#include <arrange/juce/PainterResources.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/AppResolver.h>
#include <stdexcept>
#include <cmath>

namespace arrange::juce {
    namespace {
        float svgLength(const ::juce::String& value, float fallback) {
            const auto text = value.trim();
            if (text.isEmpty() || text.endsWithChar('%')) return fallback;
            auto result = text.getFloatValue();
            if (text.endsWithIgnoreCase("in")) result *= 96.0f;
            else if (text.endsWithIgnoreCase("cm")) result *= 96.0f / 2.54f;
            else if (text.endsWithIgnoreCase("mm")) result *= 96.0f / 25.4f;
            else if (text.endsWithIgnoreCase("pt")) result *= 96.0f / 72.0f;
            else if (text.endsWithIgnoreCase("pc")) result *= 16.0f;
            if (!std::isfinite(result) || result <= 0.0f) throw std::runtime_error("Painter SVG 视口尺寸必须是正有限数");
            return result;
        }
    }

    arrange::core::PainterLoader packagePainterLoader(std::filesystem::path packageDir) {
        return [packageDir = std::move(packageDir)](const std::string& resource) {
            // 工作线程只持有不可变地址和完成结果，不持有 QuickJS 上下文或 UI 树
            static ::juce::ThreadPool workers(2);
            auto result = std::make_shared<std::promise<arrange::core::PainterLoadResult>>();
            auto future = result->get_future();
            workers.addJob([result, packageDir, resource] {
                arrange::core::PainterLoadResult loaded;
                try {
                    const auto resolved = arrange::resolvePackageResource(packageDir, resource);
                    if (!resolved.ok) throw std::runtime_error(resolved.error);
                    auto content = std::make_shared<JucePainterContent>();
                    const ::juce::File file(resolved.path.string());
                    if (file.hasFileExtension("svg")) {
                        auto xml = ::juce::XmlDocument::parse(file);
                        if (!xml || !xml->hasTagName("svg")) throw std::runtime_error("Painter SVG 内容无法解析：" + resource);
                        const auto viewBox = ::juce::StringArray::fromTokens(xml->getStringAttribute("viewBox"), " ,\t\r\n", "");
                        const auto width = svgLength(xml->getStringAttribute("width"), viewBox.size() == 4 ? viewBox[2].getFloatValue() : 300.0f);
                        const auto height = svgLength(xml->getStringAttribute("height"), viewBox.size() == 4 ? viewBox[3].getFloatValue() : 150.0f);
                        if (!std::isfinite(width) || !std::isfinite(height) || width <= 0.0f || height <= 0.0f) throw std::runtime_error("Painter SVG 视口无效：" + resource);
                        xml->setAttribute("width", width);
                        xml->setAttribute("height", height);
                        content->vector = ::juce::Drawable::createFromSVG(*xml);
                        if (!content->vector) throw std::runtime_error("Painter SVG 未产生可绘制内容：" + resource);
                        content->vectorViewport = {0, 0, width, height};
                        content->intrinsicSize = arrange::core::Size{width, height};
                    } else {
                        content->image = ::juce::ImageFileFormat::loadFrom(file);
                        if (!content->image.isValid()) throw std::runtime_error("Painter 图片无法解码：" + resource);
                        content->intrinsicSize = arrange::core::Size{static_cast<float>(content->image.getWidth()), static_cast<float>(content->image.getHeight())};
                    }
                    loaded.content = std::move(content);
                } catch (const std::exception& error) {
                    loaded.error = error.what();
                }
                result->set_value(std::move(loaded));
            });
            return future;
        };
    }
}

#endif
