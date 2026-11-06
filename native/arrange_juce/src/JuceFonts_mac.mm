#include <arrange/juce/JuceFonts.h>

#if ARRANGE_JUCE_WITH_JUCE && JUCE_MAC

#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>

#include <algorithm>
#include <cmath>
#include <set>

namespace arrange::juce {
    namespace {
        // CoreText 的 kCTFontWeightTrait 在 Apple 自带字体上取离散值，第三方字体是连续值：
        // 按 Apple 刻度分段线性插值，再取整到百位
        int weightFromTrait(double trait) {
            static constexpr std::pair<double, int> anchors[]{{-0.8, 100}, {-0.6, 200}, {-0.4, 300}, {0.0, 400}, {0.23, 500}, {0.3, 600}, {0.4, 700}, {0.56, 800}, {0.62, 900}};
            constexpr auto count = sizeof(anchors) / sizeof(anchors[0]);
            if (trait <= anchors[0].first) return anchors[0].second;
            if (trait >= anchors[count - 1].first) return anchors[count - 1].second;
            for (std::size_t index = 1; index < count; ++index) {
                if (trait > anchors[index].first) continue;
                const auto& low = anchors[index - 1];
                const auto& high = anchors[index];
                const auto weight = low.second + (trait - low.first) / (high.first - low.first) * (high.second - low.second);
                return static_cast<int>(std::lround(weight / 100.0)) * 100;
            }
            return arrange::core::defaultFontWeight;
        }

        std::string utf8(NSString* text) {
            return text ? std::string([text UTF8String]) : std::string{};
        }
    }

    SystemFontFamily enumerateSystemFontFamily(const std::string& family) {
        SystemFontFamily result;
        @autoreleasepool {
            NSString* name = [NSString stringWithUTF8String:family.c_str()];
            if (!name) return result;
            NSDictionary* query = @{(__bridge NSString*)kCTFontFamilyNameAttribute: name};
            CTFontDescriptorRef base = CTFontDescriptorCreateWithAttributes((__bridge CFDictionaryRef)query);
            if (!base) return result;
            CFArrayRef matches = CTFontDescriptorCreateMatchingFontDescriptors(base, nullptr);
            CFRelease(base);
            if (!matches) return result;
            std::set<std::string> seenPostScript;
            for (CFIndex index = 0; index < CFArrayGetCount(matches); ++index) {
                auto descriptor = static_cast<CTFontDescriptorRef>(const_cast<void*>(CFArrayGetValueAtIndex(matches, index)));
                CFStringRef postScript = static_cast<CFStringRef>(CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute));
                const auto postScriptName = utf8((__bridge NSString*)postScript);
                if (postScript) CFRelease(postScript);
                // 用户安装的字体可能在多个目录各有一份，按 PostScript 名去重
                if (!postScriptName.empty() && !seenPostScript.insert(postScriptName).second) continue;
                CFDictionaryRef traits = static_cast<CFDictionaryRef>(CTFontDescriptorCopyAttribute(descriptor, kCTFontTraitsAttribute));
                if (!traits) continue;
                double weightTrait = 0, widthTrait = 0;
                uint32_t symbolic = 0;
                if (auto number = static_cast<CFNumberRef>(CFDictionaryGetValue(traits, kCTFontWeightTrait))) CFNumberGetValue(number, kCFNumberDoubleType, &weightTrait);
                if (auto number = static_cast<CFNumberRef>(CFDictionaryGetValue(traits, kCTFontWidthTrait))) CFNumberGetValue(number, kCFNumberDoubleType, &widthTrait);
                if (auto number = static_cast<CFNumberRef>(CFDictionaryGetValue(traits, kCTFontSymbolicTrait))) CFNumberGetValue(number, kCFNumberSInt32Type, &symbolic);
                CFRelease(traits);
                // 非常规宽度的字面（Condensed、Expanded 等）不作为可选字面
                if (std::abs(widthTrait) > 0.001) continue;
                // 可变字体的命名实例排版与绘制错位，只支持静态字面
                CTFontRef font = CTFontCreateWithFontDescriptor(descriptor, 12.0, nullptr);
                bool variable = false;
                if (font) {
                    CFArrayRef axes = CTFontCopyVariationAxes(font);
                    variable = axes != nullptr && CFArrayGetCount(axes) > 0;
                    if (axes) CFRelease(axes);
                    CFRelease(font);
                }
                if (variable) continue;
                CFStringRef styleName = static_cast<CFStringRef>(CTFontDescriptorCopyAttribute(descriptor, kCTFontStyleNameAttribute));
                SystemFontFace face;
                face.styleName = utf8((__bridge NSString*)styleName);
                if (styleName) CFRelease(styleName);
                if (face.styleName.empty()) continue;
                face.info.weight = weightFromTrait(weightTrait);
                face.info.italic = (symbolic & kCTFontTraitItalic) != 0;
                if (result.name.empty()) {
                    CFStringRef familyName = static_cast<CFStringRef>(CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute));
                    result.name = utf8((__bridge NSString*)familyName);
                    if (familyName) CFRelease(familyName);
                }
                result.faces.push_back(std::move(face));
            }
            CFRelease(matches);
        }
        if (result.name.empty()) result.name = family;
        return result;
    }

    std::vector<std::string> platformDefaultFontFamilies() {
        return {"Helvetica Neue"};
    }
}

#endif
