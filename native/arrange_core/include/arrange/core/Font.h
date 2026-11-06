#pragma once

#include "Painter.h"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace arrange::core {
    // 字重沿用 CSS 的 1 至 1000 数值，常规体 400
    inline constexpr int minFontWeight = 1;
    inline constexpr int maxFontWeight = 1000;
    inline constexpr int defaultFontWeight = 400;
    // 缺失字重时伪造粗体的下限，与 CSS font-synthesis 一致
    inline constexpr int syntheticBoldThreshold = 600;
    // 伪斜体的错切系数与伪粗体的描边宽度（em）
    inline constexpr float syntheticItalicSkew = 0.2f;
    inline constexpr float syntheticBoldStroke = 0.04f;

    [[nodiscard]] inline int clampFontWeight(int weight) noexcept {
        return weight < minFontWeight ? minFontWeight : weight > maxFontWeight ? maxFontWeight : weight;
    }

    // 一个静态字面的真实字重与斜体，系统字体由平台读出，自带字体读 OS/2
    struct FontFaceInfo {
        int weight = defaultFontWeight;
        bool italic = false;
        bool operator==(const FontFaceInfo&) const = default;
    };

    struct FontFaceChoice {
        bool found = false;
        std::size_t index = 0;
        bool syntheticBold = false;
        bool syntheticItalic = false;
        bool operator==(const FontFaceChoice&) const = default;
    };

    // 按 CSS 字体匹配算法选字面：先定字形，再按字重的搜索次序取最近者，缺失时按开关决定是否伪造
    [[nodiscard]] FontFaceChoice selectFontFace(std::span<const FontFaceInfo> faces, int weight, bool italic, bool synthesis);

    // 直接解析 sfnt 字节里的 OS/2 表（字重、fsSelection），没有 OS/2 时用 head.macStyle；不是 sfnt 返回空
    [[nodiscard]] std::optional<FontFaceInfo> readFontFaceInfo(std::span<const std::uint8_t> bytes);

    using FontBytes = std::shared_ptr<const std::vector<std::uint8_t>>;

    // 资源获取层解码出的字体字节与 OS/2 读数；由 defineFontFamily 取用
    struct FontContent final : PainterContent {
        FontBytes bytes;
        FontFaceInfo info;
    };

    // 自带字体的一个字面：字重与字形的覆盖项优先于 OS/2 读数
    struct FontFaceSource {
        FontBytes bytes;
        std::optional<int> weight;
        std::optional<bool> italic;
        bool operator==(const FontFaceSource&) const = default;
    };

    struct FontFamilyDefinition {
        std::string name;
        std::vector<FontFaceSource> faces;
    };

    // 字体注册表：持有自带字体族，任何变化都推进字体环境代际；Text、Input 与含文字的绘制片段按代际重排
    class FontRegistry {
       public:
        static FontRegistry& shared();

        // 同名族整体替换；owner 用于运行时销毁时撤销自己登记的族
        void define(const void* owner, FontFamilyDefinition family);
        void removeOwned(const void* owner);
        void remove(const void* owner, std::string_view name);
        [[nodiscard]] std::shared_ptr<const FontFamilyDefinition> find(std::string_view name) const;
        [[nodiscard]] std::uint64_t generation() const noexcept {
            return generation_.load(std::memory_order_acquire);
        }

        // 声明预加载的字体到齐之前，首帧不发布；计数由登记方成对增减
        void beginPreload() noexcept {
            preloads_.fetch_add(1, std::memory_order_acq_rel);
        }
        void endPreload() noexcept {
            preloads_.fetch_sub(1, std::memory_order_acq_rel);
        }
        [[nodiscard]] std::uint32_t pendingPreloads() const noexcept {
            return preloads_.load(std::memory_order_acquire);
        }

        // 默认字体变化、系统字体安装等平台侧变化
        void notifyChanged() noexcept {
            generation_.fetch_add(1, std::memory_order_acq_rel);
        }

       private:
        struct Entry {
            const void* owner = nullptr;
            std::shared_ptr<const FontFamilyDefinition> family;
        };
        mutable std::mutex mutex_;
        std::map<std::string, Entry> families_;
        std::atomic<std::uint64_t> generation_{1};
        std::atomic<std::uint32_t> preloads_{0};
    };

    inline constexpr char fontFamilySeparator = static_cast<char>(10);

    // 字体族表在数值流等一维编码里以换行分隔，空串为空表
    [[nodiscard]] std::vector<std::string> splitFontFamilies(std::string_view joined);
    [[nodiscard]] std::string joinFontFamilies(const std::vector<std::string>& families);

    // 族名比较不分大小写（仅 ASCII）
    [[nodiscard]] std::string foldFontFamilyName(std::string_view name);
}
