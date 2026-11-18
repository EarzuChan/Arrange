#pragma once

#include <arrange/core/Version.h>
#include <arrange/juce/PainterResources.h>
#include <arrange/juce/UiPackage.h>
#include <arrange/quickjs/QuickJsScriptHost.h>
#include <juce_cryptography/juce_cryptography.h>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <stdexcept>

namespace test_support {
    inline arrange::quickjs::ScriptExecutionResult loadUiPackage(arrange::quickjs::QuickJsScriptHost& host, const std::filesystem::path& root) {
        const auto package = arrange::juce::mountUiPackage(root);
        host.setPainterLoader(arrange::juce::packagePainterLoader(package));
        host.setAssetLoader(arrange::juce::packageAssetLoader(package));
        return host.executePackage(package);
    }

    inline void writeUiManifest(const std::filesystem::path& root, std::initializer_list<std::string_view> assets = {}, std::initializer_list<std::string_view> modules = {"app.js"}) {
        ::juce::Array<::juce::var> entries;
        const auto add = [&](std::string_view name, const char* kind) {
            const auto path = root / std::filesystem::path(std::u8string(name.begin(), name.end()));
            std::ifstream input(path, std::ios::binary);
            if (!input) throw std::runtime_error("测试包条目不存在");
            const std::string bytes((std::istreambuf_iterator<char>(input)), {});
            ::juce::var row(new ::juce::DynamicObject());
            auto* object = row.getDynamicObject();
            object->setProperty("path", ::juce::String::fromUTF8(name.data(), static_cast<int>(name.size())));
            object->setProperty("kind", kind);
            object->setProperty("size", static_cast<int>(bytes.size()));
            object->setProperty("sha256", ::juce::SHA256(bytes.data(), bytes.size()).toHexString());
            entries.add(row);
        };
        for (auto name : modules) add(name, "module");
        for (auto name : assets) add(name, "asset");
        ::juce::var manifest(new ::juce::DynamicObject());
        auto* object = manifest.getDynamicObject();
        object->setProperty("format", 1);
        object->setProperty("protocol", static_cast<int>(arrange::core::RuntimeVersion));
        object->setProperty("entry", "app.js");
        object->setProperty("entries", entries);
        std::ofstream out(root / "arrange-ui.json", std::ios::binary);
        if (!(out << ::juce::JSON::toString(manifest).toStdString())) throw std::runtime_error("测试包清单写入失败");
    }
}
