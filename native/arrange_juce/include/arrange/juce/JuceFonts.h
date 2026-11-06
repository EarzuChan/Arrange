#pragma once

#include <arrange/core/Font.h>
#include <arrange/core/TextLayoutService.h>

#if ARRANGE_JUCE_WITH_JUCE
#include <juce_gui_basics/juce_gui_basics.h>
#endif

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace arrange::juce {
#if ARRANGE_JUCE_WITH_JUCE

    // 系统字体族里的一个静态字面：真实字重与斜体由平台原生接口读出，styleName 用于向 JUCE 取该字面
    struct SystemFontFace {
        arrange::core::FontFaceInfo info;
        std::string styleName;
    };

    struct SystemFontFamily {
        // 平台给出的族名，向 JUCE 取字面时使用
        std::string name;
        std::vector<SystemFontFace> faces;
    };

    // 平台枚举：Windows 为 DirectWrite，macOS 为 CoreText；不支持的平台返回空。
    // 排除模拟出来的字面、非常规宽度的字面和可变字体的命名实例，按字面去重
    [[nodiscard]] SystemFontFamily enumerateSystemFontFamily(const std::string& family);

    // 各平台的默认字体族（静态字面）；中日韩与 emoji 的缺字回落交给平台
    [[nodiscard]] std::vector<std::string> platformDefaultFontFamilies();

    struct ResolvedFont {
        ::juce::Typeface::Ptr typeface;
        // 选中字面低于请求时由 Arrange 自己绘制的伪造
        bool syntheticBold = false;
        bool syntheticItalic = false;
    };

    // 字面解析：自带字体与系统字体统一按 CSS 匹配，结果经 withTypeface 交给 JUCE，不依赖 JUCE 的名字匹配与合成。
    // 只在 UI 线程使用；字体环境代际变化时丢弃缓存
    // 由 JUCE 在 shutdown 时销毁：函数内静态对象会在进程退出时晚于 JUCE 内部的字体登记表销毁，释放字面时锁已销毁的互斥量（macOS）
    class JuceFontResolver final : public ::juce::DeletedAtShutdown {
       public:
        static JuceFontResolver& shared();

        ~JuceFontResolver() override;

        [[nodiscard]] ResolvedFont resolve(const arrange::core::TextStyle& style);

       private:
        JuceFontResolver() = default;

        struct BundledFace {
            ::juce::Typeface::Ptr typeface;
            arrange::core::FontFaceInfo info;
        };

        struct Entry {
            ResolvedFont resolved;
        };

        void syncGeneration();
        std::vector<BundledFace> bundledFaces(const std::shared_ptr<const arrange::core::FontFamilyDefinition>& family);
        ResolvedFont resolveFamily(const std::string& family, const arrange::core::TextStyle& style, bool& found);
        const SystemFontFamily& systemFamily(const std::string& family);

        std::uint64_t generation_ = 0;
        std::map<std::string, SystemFontFamily> systemFamilies_;
        std::map<const arrange::core::FontFamilyDefinition*, std::vector<BundledFace>> bundled_;
        std::map<std::string, ResolvedFont> resolved_;
        // 持有定义本体，避免缓存键指针悬空
        std::vector<std::shared_ptr<const arrange::core::FontFamilyDefinition>> keepAlive_;
    };

#endif
}
