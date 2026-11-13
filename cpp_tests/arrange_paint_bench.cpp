// 重放层性能基准，手动运行，不进 CTest：滚动列表在图块绘制与直接绘制下的每帧耗时，以及 tint 图标的缓存收益
// 每个场景先发布全部帧，只计时重放；每 50 帧回读一个像素让 GPU 完成，耗时含 CPU 提交与 GPU 执行
#include "TextFixtures.h"
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/PainterResources.h>
#include <arrange/juce/PassivePaintRenderer.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace arrange::core;

namespace {
    using Clock = std::chrono::steady_clock;

    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    LayoutModifierSemantics size(float width, float height) {
        LayoutModifierSemantics value;
        value.kind = LayoutModifierKind::Size;
        value.width = width;
        value.height = height;
        return value;
    }

    constexpr int viewportWidth = 1280, viewportHeight = 720;

    // warm 为 false 时不预热、只走一遍：快滚穿过没见过的内容，图块全是冷的
    double paintMillisPerFrame(arrange::juce::PassivePaintRenderer& painter, const std::vector<PublishedFrame>& frames, int repeats, bool warm = true) {
        ::juce::Image target(::juce::Image::ARGB, viewportWidth, viewportHeight, true, ::juce::NativeImageType());
        const auto sync = [&] {
            const ::juce::Image::BitmapData data(target, 0, 0, 1, 1, ::juce::Image::BitmapData::readOnly);
            volatile auto pixel = data.getPixelColour(0, 0).getARGB();
            (void) pixel;
        };
        if (warm)
            for (const auto& frame : frames) {
                ::juce::Graphics graphics(target);
                painter.paint(graphics, frame);
            }
        sync();
        const auto started = Clock::now();
        std::size_t count = 0;
        for (int repeat = 0; repeat < repeats; ++repeat)
            for (const auto& frame : frames) {
                {
                    ::juce::Graphics graphics(target);
                    painter.paint(graphics, frame);
                }
                if (++count % 50 == 0) sync();
            }
        sync();
        return std::chrono::duration<double, std::milli>(Clock::now() - started).count() / static_cast<double>(count);
    }

    void scrollList(int rows, bool icons, float stride = 7.0f, bool hover = false) {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        NativeScene scene;
        SceneFramePipeline pipeline{LayoutEngine{service}};
        PublishedFrame frame;
        arrange::juce::PassivePaintRenderer painter(service);
        LayoutModifierSemantics scroll;
        scroll.kind = LayoutModifierKind::VerticalScroll;
        auto vector = std::make_shared<arrange::juce::JucePainterContent>();
        {
            const auto xml = ::juce::parseXML("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#333333\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m9 18 6-6-6-6\"/><rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\"/></svg>");
            check(xml != nullptr, "基准用 SVG 解析失败");
            vector->vector = ::juce::Drawable::createFromSVG(*xml);
            vector->vectorViewport = {0, 0, 24, 24};
            vector->intrinsicSize = Size{24, 24};
        }
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, SetPropMutation{1, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Column")}})}, SetModifierMutation{1, {{size(viewportWidth, viewportHeight), {}}, {scroll, "scroll"}}}};
        for (NodeId id = 2; id < static_cast<NodeId>(rows) + 2; ++id) {
            PaintStyleSemantics fill;
            fill.color = id % 2 ? 0xffe8f0ff : 0xfffff0e0;
            initial.operations.push_back(CreateNodeMutation{id, NodeType::Layout});
            initial.operations.push_back(SetPropMutation{id, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue(icons ? "Box" : "MinSize")}})});
            initial.operations.push_back(SetModifierMutation{id, {{size(viewportWidth - 40, 36), {}}, {fill, {}}, {test_support::text("列表行 " + std::to_string(id) + " Row title English 中文混排", 0xff102030, 16), {}}}});
            initial.operations.push_back(InsertChildMutation{1, id, id - 2});
            if (icons) {
                const auto iconId = id + static_cast<NodeId>(rows) + 1000;
                PaintModifier paint;
                paint.painter.content = vector;
                paint.tint = 0xff555566;
                paint.sizeToIntrinsics = false;
                paint.contentScale = ContentScale::Fit;
                initial.operations.push_back(CreateNodeMutation{iconId, NodeType::Layout});
                initial.operations.push_back(SetPropMutation{iconId, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Box")}})});
                initial.operations.push_back(SetModifierMutation{iconId, {{size(22, 22), {}}, {paint, {}}}});
                initial.operations.push_back(InsertChildMutation{id, iconId, 0});
            }
        }
        const auto publish = [&](const MutationTransaction& transaction) {
            return pipeline.run(scene, 1, {0, static_cast<float>(viewportWidth), 0, static_cast<float>(viewportHeight)}, &transaction, true, frame, [&](const auto&, auto& next) { painter.prepareResources(next.content); });
        };
        check(!publish(initial).error, "基准场景发布失败");
        std::vector<PublishedFrame> frames;
        for (int step = 0; step < 240; ++step) {
            scroll.scrollValue = static_cast<float>(step) * stride;
            MutationTransaction movement;
            movement.operations = {SetModifierMutation{1, {{size(viewportWidth, viewportHeight), {}}, {scroll, "scroll"}}}};
            if (hover) {
                // 指针停在视口中部，滚动时悬停行随之更替：相邻两行的底色交替改变
                const auto row = std::clamp(static_cast<NodeId>((scroll.scrollValue + viewportHeight * 0.5f) / 36.0f) + 2, NodeId{3}, static_cast<NodeId>(rows) + 1);
                for (const auto id : {row - 1, row}) {
                    PaintStyleSemantics fill;
                    fill.color = id == row ? 0xffbfd7ff : (id % 2 ? 0xffe8f0ff : 0xfffff0e0);
                    movement.operations.push_back(SetModifierMutation{id, {{size(viewportWidth - 40, 36), {}}, {fill, {}}, {test_support::text("列表行 " + std::to_string(id) + " Row title English 中文混排", 0xff102030, 16), {}}}});
                }
            }
            check(!publish(movement).error, "基准场景滚动发布失败");
            frames.push_back(frame);
        }
        painter.setScrollTilesEnabled(false);
        const auto direct = paintMillisPerFrame(painter, frames, 3);
        painter.setScrollTilesEnabled(true);
        const auto tiled = paintMillisPerFrame(painter, frames, 3);
        const auto counters = painter.scrollTileCounters();
        std::printf("[步长 %.0f%s] 图块层 %llu、直接 %llu、降级 %llu、失效 %llu\n", stride, hover ? "，悬停行随滚动更替" : "", static_cast<unsigned long long>(counters.layersTiled), static_cast<unsigned long long>(counters.layersDirect), static_cast<unsigned long long>(counters.demotions), static_cast<unsigned long long>(counters.tilesInvalidated));
        std::printf("滚动列表 %3d 行%s：直接重放 %7.3f ms/帧，图块 %7.3f ms/帧（图块建 %llu、命中 %llu、保留 %zu 块）\n", rows, icons ? "（带 tint 图标）" : "", direct, tiled, static_cast<unsigned long long>(counters.tileBuilds), static_cast<unsigned long long>(counters.tileHits), counters.tiles);
        // 冷启动：新建重放器，不预热，只走一遍。快滚时每个位置只经过一次，图块来不及复用
        {
            arrange::juce::PassivePaintRenderer coldDirect(service), coldTiled(service);
            coldDirect.setScrollTilesEnabled(false);
            const auto directCold = paintMillisPerFrame(coldDirect, frames, 1, false);
            const auto tiledCold = paintMillisPerFrame(coldTiled, frames, 1, false);
            const auto cold = coldTiled.scrollTileCounters();
            std::printf("  冷启动快滚（走一遍）：直接重放 %7.3f ms/帧，图块 %7.3f ms/帧（图块建 %llu、命中 %llu、局部重画 %llu、降级 %llu）\n", directCold, tiledCold, static_cast<unsigned long long>(cold.tileBuilds), static_cast<unsigned long long>(cold.tileHits), static_cast<unsigned long long>(cold.tilesRepainted), static_cast<unsigned long long>(cold.demotions));
        }
    }
}

int main() {
    try {
        ::juce::ScopedJuceInitialiser_GUI initializer;
        std::printf("视口 %dx%d，原生图像目标\n", viewportWidth, viewportHeight);
        scrollList(100, false);
        scrollList(100, true);
        scrollList(1000, true);
        scrollList(200, true, 7.0f, true);
        scrollList(200, true, 40.0f, true);
        scrollList(1000, true, 40.0f, false);
        scrollList(1000, true, 100.0f, false);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
