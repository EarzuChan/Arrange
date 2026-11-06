#include <arrange/juce/JuceFonts.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <algorithm>

#if JUCE_WINDOWS
#include <dwrite.h>
#include <wrl/client.h>
#pragma comment(lib, "dwrite.lib")
#endif

namespace arrange::juce {
#if JUCE_WINDOWS
    namespace {
        std::string readLocalized(IDWriteLocalizedStrings* strings) {
            if (!strings || strings->GetCount() == 0) return {};
            UINT32 index = 0;
            BOOL exists = FALSE;
            if (FAILED(strings->FindLocaleName(L"en-us", &index, &exists)) || !exists) index = 0;
            UINT32 length = 0;
            if (FAILED(strings->GetStringLength(index, &length))) return {};
            std::wstring text(length + 1, L'\0');
            if (FAILED(strings->GetString(index, text.data(), length + 1))) return {};
            text.resize(length);
            return ::juce::String(text.c_str()).toStdString();
        }

        Microsoft::WRL::ComPtr<IDWriteFactory> dwriteFactory() {
            static Microsoft::WRL::ComPtr<IDWriteFactory> factory = [] {
                Microsoft::WRL::ComPtr<IDWriteFactory> created;
                DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<IUnknown**>(created.ReleaseAndGetAddressOf()));
                return created;
            }();
            return factory;
        }
    }

    SystemFontFamily enumerateSystemFontFamily(const std::string& family) {
        SystemFontFamily result;
        const auto factory = dwriteFactory();
        if (!factory) return result;
        Microsoft::WRL::ComPtr<IDWriteFontCollection> collection;
        if (FAILED(factory->GetSystemFontCollection(collection.ReleaseAndGetAddressOf(), FALSE))) return result;
        UINT32 familyIndex = 0;
        BOOL exists = FALSE;
        const auto wide = ::juce::String::fromUTF8(family.c_str());
        if (FAILED(collection->FindFamilyName(wide.toWideCharPointer(), &familyIndex, &exists)) || !exists) return result;
        Microsoft::WRL::ComPtr<IDWriteFontFamily> fontFamily;
        if (FAILED(collection->GetFontFamily(familyIndex, fontFamily.ReleaseAndGetAddressOf()))) return result;
        Microsoft::WRL::ComPtr<IDWriteLocalizedStrings> familyNames;
        if (SUCCEEDED(fontFamily->GetFamilyNames(familyNames.ReleaseAndGetAddressOf()))) result.name = readLocalized(familyNames.Get());
        if (result.name.empty()) result.name = family;
        for (UINT32 index = 0; index < fontFamily->GetFontCount(); ++index) {
            Microsoft::WRL::ComPtr<IDWriteFont> font;
            if (FAILED(fontFamily->GetFont(index, font.ReleaseAndGetAddressOf()))) continue;
            // 模拟出来的字面与非常规宽度的字面（如 Arial Narrow）不作为可选字面
            if (font->GetSimulations() != DWRITE_FONT_SIMULATIONS_NONE || font->GetStretch() != DWRITE_FONT_STRETCH_NORMAL) continue;
            Microsoft::WRL::ComPtr<IDWriteLocalizedStrings> faceNames;
            if (FAILED(font->GetFaceNames(faceNames.ReleaseAndGetAddressOf()))) continue;
            SystemFontFace face;
            face.styleName = readLocalized(faceNames.Get());
            face.info.weight = arrange::core::clampFontWeight(static_cast<int>(font->GetWeight()));
            face.info.italic = font->GetStyle() != DWRITE_FONT_STYLE_NORMAL;
            if (face.styleName.empty()) continue;
            const auto duplicate = std::any_of(result.faces.begin(), result.faces.end(), [&](const auto& other) { return other.info == face.info && other.styleName == face.styleName; });
            if (!duplicate) result.faces.push_back(std::move(face));
        }
        return result;
    }

    std::vector<std::string> platformDefaultFontFamilies() {
        return {"Segoe UI"};
    }
#elif JUCE_MAC
    // 实现在 JuceFonts_mac.mm
#else
    SystemFontFamily enumerateSystemFontFamily(const std::string&) {
        return {};
    }

    std::vector<std::string> platformDefaultFontFamilies() {
        return {};
    }
#endif

    namespace {
        JuceFontResolver* sharedResolver = nullptr;
    }

    JuceFontResolver& JuceFontResolver::shared() {
        if (!sharedResolver) sharedResolver = new JuceFontResolver();
        return *sharedResolver;
    }

    JuceFontResolver::~JuceFontResolver() {
        if (sharedResolver == this) sharedResolver = nullptr;
    }

    void JuceFontResolver::syncGeneration() {
        const auto generation = arrange::core::FontRegistry::shared().generation();
        if (generation == generation_) return;
        generation_ = generation;
        systemFamilies_.clear();
        bundled_.clear();
        resolved_.clear();
        keepAlive_.clear();
        // 自带字体对象全部释放后还要清空 JUCE 的字体缓存，登记才会注销（macOS 登记在 JUCE 自己的表里）
        ::juce::Typeface::clearTypefaceCache();
    }

    const SystemFontFamily& JuceFontResolver::systemFamily(const std::string& family) {
        const auto key = arrange::core::foldFontFamilyName(family);
        const auto found = systemFamilies_.find(key);
        if (found != systemFamilies_.end()) return found->second;
        return systemFamilies_.emplace(key, enumerateSystemFontFamily(family)).first->second;
    }

    std::vector<JuceFontResolver::BundledFace> JuceFontResolver::bundledFaces(const std::shared_ptr<const arrange::core::FontFamilyDefinition>& family) {
        const auto found = bundled_.find(family.get());
        if (found != bundled_.end()) return found->second;
        keepAlive_.push_back(family);
        std::vector<BundledFace> faces;
        for (const auto& source : family->faces) {
            if (!source.bytes || source.bytes->empty()) continue;
            BundledFace face;
            face.typeface = ::juce::Typeface::createSystemTypefaceFor(::juce::Span<const std::byte>(reinterpret_cast<const std::byte*>(source.bytes->data()), source.bytes->size()));
            if (!face.typeface) continue;
            // 覆盖项优先，否则直接读字节里的 OS/2，两个平台一致
            const auto parsed = arrange::core::readFontFaceInfo({source.bytes->data(), source.bytes->size()}).value_or(arrange::core::FontFaceInfo{});
            face.info.weight = source.weight.value_or(parsed.weight);
            face.info.italic = source.italic.value_or(parsed.italic);
            faces.push_back(std::move(face));
        }
        return bundled_.emplace(family.get(), std::move(faces)).first->second;
    }

    ResolvedFont JuceFontResolver::resolveFamily(const std::string& family, const arrange::core::TextStyle& style, bool& found) {
        found = false;
        ResolvedFont result;
        if (const auto definition = arrange::core::FontRegistry::shared().find(family)) {
            const auto faces = bundledFaces(definition);
            std::vector<arrange::core::FontFaceInfo> infos;
            for (const auto& face : faces) infos.push_back(face.info);
            const auto choice = arrange::core::selectFontFace(infos, style.fontWeight, style.italic, style.fontSynthesis);
            if (choice.found) {
                found = true;
                result.typeface = faces[choice.index].typeface;
                result.syntheticBold = choice.syntheticBold;
                result.syntheticItalic = choice.syntheticItalic;
            }
            return result;
        }
        const auto& system = systemFamily(family);
        std::vector<arrange::core::FontFaceInfo> infos;
        for (const auto& face : system.faces) infos.push_back(face.info);
        const auto choice = arrange::core::selectFontFace(infos, style.fontWeight, style.italic, style.fontSynthesis);
        if (!choice.found) return result;
        // 以平台给出的族名与样式名取字面；取不到就当作该族不可用
        auto typeface = ::juce::Typeface::createSystemTypefaceFor(::juce::Font(::juce::FontOptions(::juce::String::fromUTF8(system.name.c_str()), ::juce::String::fromUTF8(system.faces[choice.index].styleName.c_str()), 12.0f)));
        if (!typeface) return result;
        found = true;
        result.typeface = std::move(typeface);
        result.syntheticBold = choice.syntheticBold;
        result.syntheticItalic = choice.syntheticItalic;
        return result;
    }

    ResolvedFont JuceFontResolver::resolve(const arrange::core::TextStyle& style) {
        syncGeneration();
        std::string key = arrange::core::joinFontFamilies(style.fontFamily);
        key += '\x1f' + std::to_string(style.fontWeight) + (style.italic ? 'i' : 'n') + (style.fontSynthesis ? 's' : 'x');
        if (const auto cached = resolved_.find(key); cached != resolved_.end()) return cached->second;

        std::vector<std::string> candidates = style.fontFamily;
        for (const auto& family : platformDefaultFontFamilies()) candidates.push_back(family);
        ResolvedFont result;
        bool found = false;
        for (const auto& family : candidates) {
            result = resolveFamily(family, style, found);
            if (found) break;
        }
        if (!found) {
            // 没有可用字面（含不识别平台）时用 JUCE 默认无衬线体，并按请求伪造
            result = {};
            result.typeface = ::juce::Font(::juce::FontOptions()).getTypefacePtr();
            result.syntheticBold = style.fontSynthesis && style.fontWeight >= arrange::core::syntheticBoldThreshold;
            result.syntheticItalic = style.fontSynthesis && style.italic;
        }
        resolved_.emplace(key, result);
        return result;
    }
}

#endif
