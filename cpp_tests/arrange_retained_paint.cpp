#include "TextFixtures.h"
#include <arrange/juce/PainterResources.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/TextInputLayoutModel.h>
#include <chrono>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
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

    ::juce::Image render(arrange::juce::PassivePaintRenderer& painter, const PublishedFrame& frame, bool culling) {
        painter.setCullingEnabled(culling);
        ::juce::Image image(::juce::Image::ARGB, 320, 240, true);
        ::juce::Graphics graphics(image);
        painter.paint(graphics, frame);
        return image;
    }

    void compare(arrange::juce::PassivePaintRenderer& painter, const PublishedFrame& frame) {
        const auto reference = render(painter, frame, false);
        const auto optimized = render(painter, frame, true);
        for (int y = 0; y < reference.getHeight(); ++y)
            for (int x = 0; x < reference.getWidth(); ++x) {
                if (reference.getPixelAt(x, y) != optimized.getPixelAt(x, y)) throw std::runtime_error("可见性剔除改变了图像，坐标：" + std::to_string(x) + "," + std::to_string(y));
            }
    }

    void verifyTextResources() {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend, 3, 24000);
        const auto mixed = service.layout("中文 English e\xcc\x81 🙂 ffi", {18, 24}, {0, 90});
        check(mixed->resource && mixed->lines.size() > 1 && mixed->baseline > 0, "混排必须产生真实排版资源、换行和基线");
        const auto repeated = service.layout(mixed->text, mixed->style, mixed->options, mixed);
        check(repeated == mixed && service.counters().nodeReuses == 1, "节点没有保留最近有效资源");
        check(service.layout(mixed->text, mixed->style, mixed->options) == mixed, "同请求没有共享服务结果");
        const auto empty = service.layout("", {18, 24});
        check(empty->width == 0 && empty->height >= 24 && empty->lines.size() == 1, "空文本排版不正确");
        const auto explicitLines = service.layout("第一行\n\n第三行\n", {18, 24}, {0, 100});
        check(explicitLines->lines.size() == 4, "显式空行和末尾换行必须保留");
        const auto unlimited = service.layout("alpha beta gamma delta epsilon", {18, 24}, {0, 60});
        check(unlimited->lines.size() > 2, "maxLines 为零必须不限行");
        const auto ellipsis = service.layout("alpha beta gamma delta epsilon", {18, 24}, {2, 60, false, true});
        check(ellipsis->lines.size() == 2 && ellipsis->resource, "多行省略未经过正式排版服务");
        const auto single = service.layout("中文 English e\xcc\x81 🙂 ffi", {18, 24}, {1, 0, true});
        check(single->lines.size() == 1 && single->width > 90, "单行文本被错误换行");
        for (const auto& run : single->lines.front().runs) {
            check(run.start <= run.end && run.end <= single->text.size(), "字形簇越过 UTF-8 文本边界");
            const auto rect = service.caretRect(*single, run.start);
            check(std::isfinite(rect.x) && std::isfinite(rect.y), "光标几何不是有限数值");
        }
        check(service.counters().cachedEntries <= 3 && service.counters().cachedBytes <= 24000 && service.counters().evictions > 0, "LRU 没有遵守条目与内存预算");
        DrawOp red;
        red.type = DrawOpType::DrawText;
        red.rect = {10, 10, 200, 30};
        red.text = "同一字形资源";
        red.fontSize = 20;
        red.maxLines = 1;
        red.color = 0xffff0000;
        DrawOpsBuilder::prepareText(red, service);
        auto blue = red;
        blue.rect.y = 50;
        blue.color = 0xff0000ff;
        arrange::juce::JuceDrawOpsPainter painter;
        ::juce::Image colors(::juce::Image::ARGB, 240, 100, true);
        const auto count = service.counters().layoutsCreated;
        {
            ::juce::Graphics graphics(colors);
            painter.paint(graphics, std::vector<DrawOp>{red, blue});
        }
        bool sawRed = false, sawBlue = false;
        for (int y = 0; y < 100; ++y)
            for (int x = 0; x < 240; ++x) {
                const auto pixel = colors.getPixelAt(x, y);
                sawRed = sawRed || (y < 40 && pixel.getAlpha() > 128 && pixel.getRed() > pixel.getBlue());
                sawBlue = sawBlue || (y >= 40 && pixel.getAlpha() > 128 && pixel.getBlue() > pixel.getRed());
            }
        check(sawRed && sawBlue && service.counters().layoutsCreated == count, "共享文字资源串色或绘制时重新排版");
        service.clearCache();
        check(service.counters().liveResources >= 5 && mixed->resource, "淘汰缓存错误释放了外部持有的资源");
        service.invalidateFontEnvironment();
        check(service.layout(mixed->text, mixed->style, mixed->options, mixed) != mixed, "字体环境变化没有失效旧结果");
        TextLayoutService tiny(backend, 1, 1);
        auto oversized = tiny.layout("超大单项不进入缓存", {18, 24});
        std::weak_ptr<const TextLayout> weak = oversized;
        check(tiny.counters().cachedEntries == 0 && tiny.counters().liveResources == 1, "超预算资源仍进入了 LRU");
        oversized.reset();
        check(weak.expired() && tiny.counters().liveResources == 0 && tiny.counters().liveBytes == 0, "最后持有者释放后资源没有回收");
    }

    void verifyTextInputGeometry() {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        const auto near = [](float left, float right) {
            return std::abs(left - right) < 0.01f;
        };
        const auto wrapped = service.layout("a b c d e f", {18, 24}, {0, 35});
        const auto selection = service.boundsForRange(*wrapped, 0, wrapped->text.size(), {10, 20});
        check(wrapped->lines.size() > 1 && selection.size() == wrapped->lines.size(), "自动换行的全选没有覆盖全部行");
        check(selection == service.boundsForRange(*wrapped, wrapped->text.size(), 0, {10, 20}), "反向选区与正向选区不一致");
        for (std::size_t index = 0; index < wrapped->lines.size(); ++index) {
            const auto& line = wrapped->lines[index];
            check(near(selection[index].x, 10) && near(selection[index].y, 20 + line.y) && near(selection[index].width, line.width), "全选没有使用当前行的完整宽度");
            const auto caret = service.caretRect(*wrapped, line.start);
            check(near(caret.x, 0) && near(caret.y, line.y), "自动换行边界的光标没有归到下一行行首");
            check(service.byteIndexAtPoint(*wrapped, {0, line.y + line.height * 0.5f}) == line.start, "点击自动换行行首没有返回该行起点");
        }
        const auto& secondLine = wrapped->lines[1];
        const auto partial = service.boundsForRange(*wrapped, secondLine.start, secondLine.runs.front().end);
        check(partial.size() == 1 && near(partial[0].x, 0) && near(partial[0].width, secondLine.runs.front().width), "从换行边界开始的部分选区错误");

        const auto a = service.layout("A", {18, 24});
        const auto b = service.layout("B", {18, 24});
        const auto explicitLines = service.layout("A\n\nB\n", {18, 24});
        check(explicitLines->lines.size() == 4 && near(explicitLines->lines[0].width, a->width) && near(explicitLines->lines[2].width, b->width), "换行符改变了可见文字的行宽");
        check(near(explicitLines->lines[1].width, 0) && near(explicitLines->lines[3].width, 0), "空行被计入非零宽度");
        const auto beforeBreak = service.caretRect(*explicitLines, 1);
        const auto afterBreak = service.caretRect(*explicitLines, 2);
        check(near(beforeBreak.x, a->width) && near(beforeBreak.y, 0) && near(afterBreak.x, 0) && near(afterBreak.y, explicitLines->lines[1].y), "显式换行两侧的光标位置错误");
        const auto withSpace = service.layout("A ", {18, 24});
        check(withSpace->width > a->width && near(service.layout("A \nB", {18, 24})->lines[0].width, withSpace->width), "排除换行时错误丢弃了真实尾随空格");

        arrange::juce::JuceDrawOpsPainter painter;
        for (const std::string alignment : {"center", "end"}) {
            DrawOp multiline;
            multiline.type = DrawOpType::DrawText;
            multiline.text = "A\nA";
            multiline.fontSize = 18;
            multiline.lineHeight = 24;
            multiline.rect = {10, 10, 180, 80};
            multiline.textAlign = alignment;
            multiline.color = 0xffffffff;
            DrawOpsBuilder::prepareText(multiline, service);
            auto first = multiline;
            first.text = "A";
            first.maxLines = 1;
            DrawOpsBuilder::prepareText(first, service);
            auto second = first;
            second.rect.y += multiline.textLayout->lines[1].y;
            ::juce::Image actual(::juce::Image::ARGB, 200, 100, true), expected(::juce::Image::ARGB, 200, 100, true);
            {
                ::juce::Graphics graphics(actual);
                painter.paint(graphics, std::vector<DrawOp>{multiline});
            }
            {
                ::juce::Graphics graphics(expected);
                painter.paint(graphics, std::vector<DrawOp>{first, second});
            }
            for (int y = 0; y < 100; ++y)
                for (int x = 0; x < 200; ++x) check(actual.getPixelAt(x, y) == expected.getPixelAt(x, y), "显式换行改变了居中或末端对齐的绘制位置");
        }

        const auto font = ::juce::Font(::juce::FontOptions(18));
        const auto settings = ::juce::detail::ShapedText::Options{}.withFont(font).withBaselineAtZero(false).withAdditiveLineSpacing(24 - font.getHeight()).withMaxNumLines(1).withDrawLinesInFull(true);
        for (const std::string text : {"e\xcc\x81X", "👨‍👩‍👧‍👦X"}) {
            const auto layout = service.layout(text, {18, 24}, {1, 0, true});
            const ::juce::detail::ShapedText reference(::juce::String::fromUTF8(text.c_str()), settings);
            check(layout->lines[0].end == text.size() && !layout->truncated, "组合文字的末尾字符几何丢失");
            if (text == "e\xcc\x81X") {
                for (float x = 0; x <= layout->width + 1; x += 0.25f) {
                    const auto expected = arrange::juce::byteIndexForCharIndex(text, static_cast<int>(reference.getTextIndexForCaret({x, 12})));
                    check(service.byteIndexAtPoint(*layout, {x, 12}) == expected, "组合字符点击定位与 JUCE 后端不一致");
                }
                const auto middle = service.caretRect(*layout, 1);
                check(service.byteIndexAtPoint(*layout, {middle.x, middle.y + 12}) == 1, "组合字符内部的后端光标位置无法通过点击还原");
                const auto accentRange = service.boundsForRange(*layout, 1, 3);
                check(accentRange.size() == 1 && near(accentRange[0].x, middle.x) && near(accentRange[0].width, service.xForByteIndex(*layout, 3) - middle.x), "组合字符占位部分的选区几何丢失");
            }

            ::juce::Image actual(::juce::Image::ARGB, 200, 50, true), expected(::juce::Image::ARGB, 200, 50, true);
            DrawOp op;
            op.type = DrawOpType::DrawText;
            op.rect = {10, 10, 180, 30};
            op.textLayout = layout;
            op.color = 0xffffffff;
            {
                ::juce::Graphics graphics(actual);
                painter.paint(graphics, std::vector<DrawOp>{op});
            }
            {
                ::juce::GlyphArrangement glyphs;
                glyphs.addLineOfText(font, ::juce::String::fromUTF8(text.c_str()), 10, 10 + layout->baseline);
                ::juce::Graphics graphics(expected);
                graphics.setColour(::juce::Colours::white);
                glyphs.draw(graphics);
            }
            for (int y = 0; y < 50; ++y)
                for (int x = 0; x < 200; ++x) {
                    if (actual.getPixelAt(x, y) != expected.getPixelAt(x, y)) throw std::runtime_error("字形绘制与后端不同，文本：" + text + "，坐标：" + std::to_string(x) + "," + std::to_string(y));
                }
        }
    }

    void verifyPublishedReuseAndCulling() {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        NativeScene scene;
        SceneFramePipeline pipeline{LayoutEngine{service}};
        PublishedFrame frame;
        arrange::juce::PassivePaintRenderer painter(service);
        LayoutModifierSemantics scroll;
        scroll.kind = LayoutModifierKind::VerticalScroll;
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout}, arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Column")}})}, SetModifierMutation{1, {{size(320, 240), {}}, {scroll, "scroll"}}}};
        for (NodeId id = 2; id < 82; ++id) {
            initial.operations.push_back(CreateNodeMutation{id, arrange::core::NodeType::Layout});
            initial.operations.push_back(SetPropMutation{id, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})});
            initial.operations.push_back(SetModifierMutation{id, {{size(300, 30), {}}, {test_support::text("音轨 " + std::to_string(id) + " English 🙂", 0xffabcdef, 18), {}}}});
            initial.operations.push_back(InsertChildMutation{1, id, id - 2});
        }
        const auto publish = [&](const MutationTransaction* transaction, const FrameFinalizer& extra = {}) {
            return pipeline.run(scene, 1, {0, 320, 0, 240}, transaction, true, frame, [&](const auto& candidate, auto& next) {
                painter.prepareResources(next.content);
                if (extra) extra(candidate, next);
            });
        };
        check(!publish(&initial).error, "初始列表发布失败");
        const auto warmedLayouts = service.counters().layoutsCreated;
        const auto firstFragment = scene.node(2).paintCache;
        const auto firstText = test_support::textLayoutOf(scene.node(2));
        const auto previousFrame = frame;
        compare(painter, frame);
        {
            ::juce::File output(::juce::File::getCurrentWorkingDirectory().getChildFile("m23-retained-list.png"));
            auto stream = output.createOutputStream();
            check(stream != nullptr, "无法打开绘制验收图像文件");
            stream->setPosition(0);
            stream->truncate();
            check(::juce::PNGImageFormat{}.writeImageToStream(render(painter, frame, true), *stream), "无法写入绘制验收图像");
        }
        const auto beforePaint = painter.replayCounters();
        for (int repeat = 0; repeat < 4; ++repeat) render(painter, frame, true);
        const auto afterPaint = painter.replayCounters();
        check(service.counters().layoutsCreated == warmedLayouts, "重复被动绘制发生了排版");
        check(afterPaint.fragmentsSkipped > beforePaint.fragmentsSkipped && afterPaint.textSubmissions - beforePaint.textSubmissions <= 36, "屏外稳定文本没有被整片段剔除");

        auto before = pipeline.counters();
        scroll.scrollValue = 600;
        MutationTransaction movement;
        movement.operations = {SetModifierMutation{1, {{size(320, 240), {}}, {scroll, "scroll"}}}};
        check(!publish(&movement).error, "滚动发布失败");
        check(scene.node(2).paintCache == firstFragment && test_support::textLayoutOf(scene.node(2)) == firstText, "整体滚动重建了稳定子片段或文字");
        check(pipeline.counters().paintWork.contentBuilds == before.paintWork.contentBuilds && pipeline.counters().measures == before.measures, "滚动重建了内容命令或执行测量");
        check(service.counters().layoutsCreated == warmedLayouts, "滚动产生新排版");
        compare(painter, frame);
        compare(painter, previousFrame);

        const auto sibling = scene.node(3).paintCache;
        MutationTransaction color;
        color.operations = {SetModifierMutation{2, {{size(300, 30), {}}, {test_support::text("音轨 2 English 🙂", 0xffff3311, 18), {}}}}};
        check(!publish(&color).error, "颜色更新发布失败");
        check(test_support::textLayoutOf(scene.node(2)) == firstText && scene.node(3).paintCache == sibling && service.counters().layoutsCreated == warmedLayouts, "纯颜色更新破坏了文字或兄弟片段复用");
        MutationTransaction offscreen;
        offscreen.operations = {SetModifierMutation{2, {{size(300, 30), {}}, {test_support::text("屏外更新后的文字", 0xffff3311, 18), {}}}}};
        check(!publish(&offscreen).error && test_support::textLayoutOf(scene.node(2))->text == "屏外更新后的文字", "屏外文字更新被冻结");
        scroll.scrollValue = 0;
        movement.operations = {SetModifierMutation{1, {{size(320, 240), {}}, {scroll, "scroll"}}}};
        check(!publish(&movement).error, "滚回发布失败");
        compare(painter, frame);

        const auto retained = frame;
        MutationTransaction failure;
        failure.operations = {SetModifierMutation{2, {{size(300, 30), {}}, {test_support::text("失败候选不能污染成功帧", 0xffff3311, 18), {}}}}};
        check(publish(&failure, [](const auto&, auto&) { throw std::runtime_error("注入准备失败"); }).error.has_value(), "准备失败没有上报");
        check(frame.revision == retained.revision && frame.content.scenePaint == retained.content.scenePaint && test_support::textOf(scene.node(2)) == "屏外更新后的文字", "失败候选改写了已发布内容");
        compare(painter, frame);
        MutationTransaction recreate;
        recreate.operations = {RemoveChildMutation{1, 2}, DeleteNodeMutation{2}, CreateNodeMutation{2, arrange::core::NodeType::Layout}, SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, SetModifierMutation{2, {{size(300, 30), {}}, {test_support::text("新代际", 0xffff3311, 18), {}}}}, InsertChildMutation{1, 2, 0}};
        check(!publish(&recreate).error && test_support::textLayoutOf(scene.node(2)) != firstText, "节点代际重用命中了过期文字");
        compare(painter, frame);
        const auto stats = painter.replayCounters();
        std::cout << "片段验证：排版=" << service.counters().layoutsCreated << "，内容构建=" << pipeline.counters().paintWork.contentBuilds << "，整段跳过=" << stats.fragmentsSkipped << "，文字提交=" << stats.textSubmissions << "，绘制毫秒=" << painter.paintMillis() << "，排版毫秒=" << service.counters().layoutMillis << '\n';
    }

    void verifyInputAndPublicationLifetime() {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        NativeScene scene;
        SceneFramePipeline pipeline{LayoutEngine{service}};
        PublishedFrame frame;
        arrange::juce::PassivePaintRenderer painter(service);
        MutationTransaction initial;
        auto field = test_support::textField("English 中文 e\xcc\x81 🙂 很长的输入文字", "输入占位符", 0xffeeeeee, 20);
        field.presentation.singleLine = true;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, SetModifierMutation{1, {{size(180, 40), {}}, {field, {}}}}};
        auto publish = [&](const MutationTransaction* transaction) {
            return pipeline.run(scene, 1, {0, 320, 0, 240}, transaction, true, frame);
        };
        check(!publish(&initial).error, "输入节点准备失败");
        const auto& node = *test_support::editable(scene.node(1));
        arrange::juce::TextInputLayoutModel model(service);
        const auto input = model.layout(node, node.textLayout->text, 0);
        check(input.text == node.textLayout, "输入几何与正文未使用同一排版结果");
        const auto x = service.xForByteIndex(*input.text, 3);
        check(model.textIndexAtPoint(node, input.text->text, 0, input.metrics.textLeft + x + 0.01f, input.metrics.textTop + 1) == 3, "输入 point-to-index 未使用字形几何");
        const auto viewport = model.updatedViewportX(node, input.text->text, input.text->text.size(), 0);
        check(viewport > 0, "长文本没有移动输入视口");
        service.clearCache();
        const auto layouts = service.counters().layoutsCreated;
        for (std::size_t index = 0; index < 4; ++index) {
            TextInputOverlayState state;
            state.text = input.text->text;
            state.cursorIndex = index;
            state.selectionStart = 0;
            state.selectionEnd = index;
            state.viewportX = viewport;
            frame.content.focusedInputNode = 1;
            frame.content.focusedInputModifier = node.handle;
            frame.content.focusedInputViewportX = viewport;
            frame.content.overlayDrawOps = TextInputOverlayBuilder{}.build(1, node, state, service);
            compare(painter, frame);
        }
        check(service.counters().layoutsCreated == layouts, "选区、光标或 viewport 更新重新排版");
        const auto oldFrame = frame;
        MutationTransaction empty;
        field.value.clear();
        empty.operations = {SetModifierMutation{1, {{size(180, 40), {}}, {field, {}}}}};
        check(!publish(&empty).error && test_support::textLayoutOf(scene.node(1)), "占位符没有准备文本资源");
        check(test_support::textLayoutOf(scene.node(1))->text == "输入占位符", "占位符误用了正文资源");
        compare(painter, oldFrame);

        std::weak_ptr<const TextLayout> retired;
        {
            NativeScene temporary;
            PublishedFrame retained;
            MutationTransaction create;
            create.operations = {CreateNodeMutation{7, arrange::core::NodeType::Layout}, SetPropMutation{7, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})}, SetModifierMutation{7, {{test_support::text("只有旧帧持有的文字"), {}}}}};
            check(!pipeline.run(temporary, 7, {0, 320, 0, 240}, &create, true, retained).error, "寿命场景发布失败");
            retired = test_support::textLayoutOf(temporary.node(7));
            temporary = NativeScene{};
            service.clearCache();
            check(!retired.expired(), "旧帧不能继续持有已退休节点的资源");
            compare(painter, retained);
        }
        check(retired.expired(), "旧帧释放后文本资源没有回收");
    }

    void verifyTransformedOverflowAndState() {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        NativeScene scene;
        SceneFramePipeline pipeline{LayoutEngine{service}};
        PublishedFrame frame;
        arrange::juce::PassivePaintRenderer painter(service);
        TransformModifierSemantics outer;
        outer.rotationZ = 13;
        outer.scaleX = 0.8f;
        outer.scaleY = 1.2f;
        outer.translationX = 22;
        outer.alpha = 0.65f;
        ClipModifier rounded;
        rounded.shape.shapeType = "rounded";
        rounded.shape.cornerRadius = 30;
        ClipModifier circle;
        circle.shape.shapeType = "circle";
        PaintStyleSemantics border;
        border.kind = PaintStyleKind::Border;
        border.color = 0xff11ff44;
        border.strokeWidth = 9;
        LayoutModifierSemantics scroll;
        scroll.kind = LayoutModifierKind::VerticalScroll;
        scroll.scrollValue = 18;
        MutationTransaction create;
        create.operations = {CreateNodeMutation{1, arrange::core::NodeType::Layout},
                             arrange::core::SetPropMutation{1, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})},
                             SetModifierMutation{1, {{size(320, 240), {}}, {rounded, {}}, {outer, {}}}},
                             CreateNodeMutation{2, arrange::core::NodeType::Layout},
                             arrange::core::SetPropMutation{2, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Column")}})},
                             SetModifierMutation{2, {{size(160, 100), {}}, {OffsetModifier{90, 15}, {}}, {circle, {}}, {scroll, {}}}},
                             InsertChildMutation{1, 2, 0},
                             CreateNodeMutation{3, arrange::core::NodeType::Layout},
                             SetPropMutation{3, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})},
                             SetModifierMutation{3,
                                                 {{size(25, 45), {}},
                                                  {OffsetModifier{-140, 20}, {}},
                                                  {[] {
                                                       auto value = test_support::text("VISIBLE 中文溢出 English", 0xffff0000, 30);
                                                       value.overflow = "visible";
                                                       value.maxLines = 1;
                                                       return value;
                                                   }(),
                                                   {}}}},
                             InsertChildMutation{2, 3, 0},
                             CreateNodeMutation{4, arrange::core::NodeType::Layout},
                             arrange::core::SetPropMutation{4, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("Box")}})},
                             SetModifierMutation{4, {{size(25, 50), {}}, {OffsetModifier{230, 130}, {}}, {border, {}}}},
                             InsertChildMutation{1, 4, 1},
                             CreateNodeMutation{5, arrange::core::NodeType::Layout},
                             SetPropMutation{5, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})},
                             SetModifierMutation{5, {{size(160, 30), {}}, {OffsetModifier{20, 170}, {}}, {test_support::text("同资源不同颜色", 0xff00ff00, 18), {}}}},
                             InsertChildMutation{1, 5, 2},
                             CreateNodeMutation{6, arrange::core::NodeType::Layout},
                             SetPropMutation{6, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})},
                             SetModifierMutation{6, {{size(160, 30), {}}, {OffsetModifier{20, 195}, {}}, {test_support::text("同资源不同颜色", 0xff0000ff, 18), {}}}},
                             InsertChildMutation{1, 6, 3}};
        {
            ::juce::Image source(::juce::Image::ARGB, 100, 10, true);
            {
                ::juce::Graphics graphics(source);
                graphics.fillAll(::juce::Colour(0x999922aa));
            }
            auto stream = ::juce::File::getCurrentWorkingDirectory().getChildFile("m23-crop-source.png").createOutputStream();
            check(stream != nullptr, "无法打开绘制验收图像文件");
            stream->setPosition(0);
            stream->truncate();
            check(::juce::PNGImageFormat{}.writeImageToStream(source, *stream), "无法创建图片边界验收资源");
        }
        const auto loaded = arrange::juce::packagePainterLoader(std::filesystem::current_path())("m23-crop-source.png", {}).get();
        check(loaded.content != nullptr, "绘制验收图片加载失败");
        PaintModifier imagePaint;
        imagePaint.painter = {1, 1, 1, loaded.content};
        imagePaint.contentScale = "Crop";
        create.operations.push_back(CreateNodeMutation{7, arrange::core::NodeType::Layout});
        create.operations.push_back(arrange::core::SetPropMutation{7, "measurePolicy", arrange::core::PropValue::objectValue({{"kind", arrange::core::PropValue::stringValue("MinSize")}})});
        create.operations.push_back(SetModifierMutation{7, {{size(20, 40), {}}, {OffsetModifier{330, 20}, {}}, {imagePaint, {}}}});
        create.operations.push_back(InsertChildMutation{1, 7, 4});
        const auto result = pipeline.run(scene, 1, {0, 320, 0, 240}, &create, true, frame, [&](const auto&, auto& candidate) { painter.prepareResources(candidate.content); });
        check(!result.error, "变换与溢出场景发布失败");
        check(test_support::textLayoutOf(scene.node(5)) == test_support::textLayoutOf(scene.node(6)), "相同排版的不同颜色未共享资源");
        compare(painter, frame);
        const auto created = service.counters().layoutsCreated;
        for (int index = 0; index < 12; ++index) {
            outer.rotationZ = static_cast<float>(index * 31);
            outer.scaleX = index % 2 == 0 ? -0.75f : 1.4f;
            outer.translationX = static_cast<float>(index * 17 - 70);
            outer.alpha = 0.2f + index * 0.05f;
            MutationTransaction transform;
            transform.operations = {SetModifierMutation{1, {{size(320, 240), {}}, {rounded, {}}, {outer, {}}}}};
            const auto changed = pipeline.run(scene, 1, {0, 320, 0, 240}, &transform, true, frame);
            check(!changed.error, "连续变换发布失败");
            compare(painter, frame);
        }
        for (int index = 0; index < 4; ++index) compare(painter, frame);
        check(service.counters().layoutsCreated == created, "图像对照在重放期间重新排版");
        arrange::juce::JuceDrawOpsPainter draw;
        ::juce::Image skippedImage(::juce::Image::ARGB, 320, 240, true);
        {
            ::juce::Graphics graphics(skippedImage);
            PlacedPaintFragment invisible{scene.node(5).paintCache, {}};
            invisible.offset = {10000, 10000};
            draw.paint(graphics, invisible);
        }
        check(draw.counters().fragmentsVisited == 1 && draw.counters().fragmentsSkipped == 1 && draw.counters().opsVisited == 0, "整段剔除仍访问内部 DrawOps");
        draw.resetCounters();
        DrawOp clip;
        clip.type = DrawOpType::PushClip;
        clip.rect = {0, 0, 100, 100};
        DrawOp offscreen;
        offscreen.rect = {500, 500, 20, 20};
        offscreen.color = 0xffff0000;
        DrawOp pop;
        pop.type = DrawOpType::PopClip;
        DrawOp visible;
        visible.rect = {150, 150, 20, 20};
        visible.color = 0xff00ff00;
        ::juce::Image image(::juce::Image::ARGB, 320, 240, true);
        {
            ::juce::Graphics graphics(image);
            draw.paint(graphics, std::vector<DrawOp>{clip, offscreen, pop, visible});
        }
        check(draw.counters().opsSkipped == 1 && image.getPixelAt(155, 155) == ::juce::Colour(0xff00ff00), "操作剔除破坏了相邻片段的状态");
    }
}  // namespace

int main() {
    try {
        ::juce::ScopedJuceInitialiser_GUI initializer;
        verifyTextResources();
        verifyTextInputGeometry();
        verifyPublishedReuseAndCulling();
        verifyInputAndPublicationLifetime();
        verifyTransformedOverflowAndState();
        std::cout << "文本资源、发布片段及两级裁剪行为通过\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
