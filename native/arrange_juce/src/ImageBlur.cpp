#include <arrange/juce/BitmapCache.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace arrange::juce {
    namespace {
        // 三次盒式模糊逼近给定标准差的高斯核，返回各次的半径
        std::array<int, 3> boxRadii(float sigma) {
            constexpr int passes = 3;
            const auto ideal = std::sqrt(12.0f * sigma * sigma / passes + 1.0f);
            auto lower = static_cast<int>(std::floor(ideal));
            if (lower % 2 == 0) --lower;
            const auto upper = lower + 2;
            const auto ideal_m = (12.0f * sigma * sigma - passes * lower * lower - 4.0f * passes * lower - 3.0f * passes) / (-4.0f * lower - 4.0f);
            const auto m = static_cast<int>(std::lround(ideal_m));
            std::array<int, 3> result{};
            for (int index = 0; index < passes; ++index) result[static_cast<std::size_t>(index)] = ((index < m ? lower : upper) - 1) / 2;
            return result;
        }

        // 一维盒式模糊：从 source 读 count 个像素（步长 stride），写入 target；越界视为透明
        void boxLine(const std::uint32_t* source, std::uint32_t* target, int count, int stride, int radius) {
            const auto window = 2 * radius + 1;
            // 定点倒数，避免逐像素除法
            const auto scale = static_cast<std::uint32_t>(((1u << 24) + static_cast<std::uint32_t>(window) / 2u) / static_cast<std::uint32_t>(window));
            std::uint32_t a = 0, r = 0, g = 0, b = 0;
            const auto add = [&](std::uint32_t pixel, int sign) {
                const auto s = static_cast<std::uint32_t>(sign);
                a += s * (pixel >> 24);
                r += s * ((pixel >> 16) & 0xffu);
                g += s * ((pixel >> 8) & 0xffu);
                b += s * (pixel & 0xffu);
            };
            for (int index = 0; index < std::min(radius, count); ++index) add(source[index * stride], 1);
            for (int index = 0; index < count; ++index) {
                if (index + radius < count) add(source[(index + radius) * stride], 1);
                if (index - radius - 1 >= 0) add(source[(index - radius - 1) * stride], -1);
                const auto channel = [&](std::uint32_t sum) {
                    return std::min<std::uint32_t>(255u, static_cast<std::uint32_t>((static_cast<std::uint64_t>(sum) * scale + (1u << 23)) >> 24));
                };
                target[index * stride] = channel(a) << 24 | channel(r) << 16 | channel(g) << 8 | channel(b);
            }
        }
    }

    void gaussianBlur(::juce::Image& image, float sigma) {
        if (!image.isValid() || !(sigma > 0.25f)) return;
        if (image.getFormat() != ::juce::Image::ARGB) image = image.convertedToFormat(::juce::Image::ARGB);
        const auto width = image.getWidth(), height = image.getHeight();
        std::vector<std::uint32_t> pixels(static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
        std::vector<std::uint32_t> scratch(pixels.size());
        {
            const ::juce::Image::BitmapData data(image, ::juce::Image::BitmapData::readOnly);
            for (int y = 0; y < height; ++y)
                for (int x = 0; x < width; ++x) pixels[static_cast<std::size_t>(y * width + x)] = reinterpret_cast<const ::juce::PixelARGB*>(data.getPixelPointer(x, y))->getNativeARGB();
        }
        for (const auto radius : boxRadii(sigma)) {
            if (radius <= 0) continue;
            for (int y = 0; y < height; ++y) boxLine(pixels.data() + y * width, scratch.data() + y * width, width, 1, radius);
            for (int x = 0; x < width; ++x) boxLine(scratch.data() + x, pixels.data() + x, height, width, radius);
        }
        const ::juce::Image::BitmapData data(image, ::juce::Image::BitmapData::writeOnly);
        for (int y = 0; y < height; ++y)
            for (int x = 0; x < width; ++x) {
                const auto value = pixels[static_cast<std::size_t>(y * width + x)];
                reinterpret_cast<::juce::PixelARGB*>(data.getPixelPointer(x, y))->setARGB(static_cast<::juce::uint8>(value >> 24), static_cast<::juce::uint8>(value >> 16), static_cast<::juce::uint8>(value >> 8), static_cast<::juce::uint8>(value));
            }
    }
}

#endif
