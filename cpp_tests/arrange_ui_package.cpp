#include <arrange/juce/AppResolver.h>
#include <arrange/juce/PainterResources.h>
#include <arrange/juce/RuntimePackageLoader.h>
#include <arrange/juce/UiPackage.h>
#include <arrange/core/Font.h>
#include <chrono>
#include <iostream>
#include <thread>

int main(int argc, char** argv) {
    if (argc == 3) {
        try {
            const auto package = arrange::juce::mountUiPackage(std::filesystem::u8path(argv[1]));
            (void)package->read("中文 %.json", arrange::core::UiEntryKind::Asset, 64);
        } catch (const std::exception& error) {
            const std::string_view description = error.what();
            const auto expected = std::string_view(argv[2]) == "digest" ? "摘要" : std::string_view(argv[2]) == "legacy" ? "arrange-ui.json" : "ZIP";
            return description.find(expected) != std::string_view::npos ? 0 : 1;
        }
        return 1;
    }
    if (argc != 4) return 2;
    ::juce::ScopedJuceInitialiser_GUI gui;
    try {
        for (const auto* path : {argv[1], argv[2]}) {
            arrange::AppResolver resolver;
            arrange::juce::EditorConfig config;
            config.app.useDist(std::filesystem::u8path(path));
            const auto package = resolver.resolvePackage(config.app);
            if (!package.ok) throw std::runtime_error(package.error);
            const auto painter = arrange::juce::packagePainterLoader(package.package);
            auto bitmap = painter("/test.png", {});
            auto font = painter("/test.ttf", {});
            if (!bitmap.get().content || !std::dynamic_pointer_cast<const arrange::core::FontContent>(font.get().content)) throw std::runtime_error("包中的图片或字体解码失败");
            auto loaded = arrange::juce::RuntimePackageLoader{}.loadDist(config, resolver);
            if (!loaded.ok) throw std::runtime_error(loaded.error ? loaded.error->summary : "加载失败");
            const auto timeout = std::chrono::steady_clock::now() + std::chrono::seconds(5);
            bool completed = false;
            while (std::chrono::steady_clock::now() < timeout && !completed) {
                const auto result = loaded.scriptHost->semanticCheckpoint(16);
                if (!result.ok) throw std::runtime_error(result.error);
                if (const auto transaction = loaded.scriptHost->takePendingTransaction()) completed = transaction->hasTreeMutations();
                if (!completed) std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            if (!completed) throw std::runtime_error("没有收到读取完成后的 UI transaction");
        }
        arrange::App app;
        app.useDist(std::filesystem::u8path(argv[3]));
        auto bad = arrange::AppResolver{}.resolvePackage(app);
        if (bad.ok || bad.error.find("协议不匹配") == std::string::npos) throw std::runtime_error("不匹配的协议未在执行前拒绝");
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
