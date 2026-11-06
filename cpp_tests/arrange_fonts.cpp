#include "TextFixtures.h"
#include <arrange/core/Font.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/juce/JuceFonts.h>
#include <arrange/juce/JuceDrawOpsPainter.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/PassivePaintRenderer.h>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    FontBytes readFile(const std::filesystem::path& path) {
        std::ifstream stream(path, std::ios::binary);
        if (!stream) throw std::runtime_error("读取测试字体失败：" + path.string());
        return std::make_shared<std::vector<std::uint8_t>>(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>{});
    }

    bool near(float left, float right, float epsilon = 0.6f) {
        return std::abs(left - right) <= epsilon;
    }

    void verifySelection() {
        const FontFaceInfo faces[]{{300, false}, {400, false}, {700, false}, {400, true}, {900, false}};
        // 精确命中
        check(selectFontFace(faces, 400, false, true).index == 1 && selectFontFace(faces, 700, false, true).index == 2, "精确字重没有命中");
        // 500 先找 500 以内再往下：落到 400，不伪造
        auto choice = selectFontFace(faces, 500, false, true);
        check(choice.found && choice.index == 1 && !choice.syntheticBold, "500 应落到 400");
        // 小于 400 先往下：200 没有更低字重，再往上取 300
        check(selectFontFace(faces, 200, false, true).index == 0, "200 应取最近的 300");
        // 大于 500 先往上：800 取 900，600 取 700，且不伪造
        choice = selectFontFace(faces, 800, false, true);
        check(choice.index == 4 && !choice.syntheticBold, "800 应先往上取 900");
        check(selectFontFace(faces, 600, false, true).index == 2, "600 应先往上取 700");
        // 斜体：优先斜体面，字重在斜体面里再匹配；加粗请求在斜体面低于 600 时伪造粗体
        choice = selectFontFace(faces, 700, true, true);
        check(choice.index == 3 && choice.syntheticBold && !choice.syntheticItalic, "斜体 700 应取斜体 400 并伪造粗体");
        check(!selectFontFace(faces, 700, true, false).syntheticBold, "关闭伪造后不应伪造粗体");
        // 没有斜体面时回落正体并伪造斜体
        const FontFaceInfo upright[]{{400, false}, {700, false}};
        choice = selectFontFace(upright, 400, true, true);
        check(choice.index == 0 && choice.syntheticItalic && !choice.syntheticBold, "缺少斜体面应伪造斜体");
        check(!selectFontFace(upright, 400, true, false).syntheticItalic, "关闭伪造后不应伪造斜体");
        // 只有 Regular 的族请求 600 以上伪造粗体
        const FontFaceInfo single[]{{400, false}};
        check(selectFontFace(single, 600, false, true).syntheticBold && !selectFontFace(single, 590, false, true).syntheticBold, "伪造粗体的阈值是 600");
        check(!selectFontFace({}, 400, false, true).found, "空字面表不应选中");
        check(splitFontFamilies(joinFontFamilies({"A", "B C"})) == std::vector<std::string>{"A", "B C"}, "字体族表编码往返不一致");
    }

    void verifyFontTables(const std::filesystem::path& fonts) {
        const auto regular = readFontFaceInfo(*readFile(fonts / "ArrangeTestSans-Regular.ttf"));
        const auto bold = readFontFaceInfo(*readFile(fonts / "ArrangeTestSans-Bold.ttf"));
        const auto italic = readFontFaceInfo(*readFile(fonts / "ArrangeTestSans-Italic.ttf"));
        check(regular && regular->weight == 400 && !regular->italic, "Regular 的 OS/2 读数错误");
        check(bold && bold->weight == 700 && !bold->italic, "Bold 的 OS/2 读数错误");
        check(italic && italic->weight == 400 && italic->italic, "Italic 的 OS/2 读数错误");
        const std::uint8_t garbage[]{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
        check(!readFontFaceInfo(garbage), "非字体字节不应被接受");
    }

    FontFamilyDefinition testFamily(const std::filesystem::path& fonts) {
        FontFamilyDefinition family;
        family.name = "Arrange Test Sans";
        for (const char* name : {"Regular", "Bold", "Italic"}) family.faces.push_back({readFile(fonts / (std::string("ArrangeTestSans-") + name + ".ttf")), std::nullopt, std::nullopt});
        return family;
    }

    TextStyle bundledStyle(int weight, bool italic, bool synthesis = true) {
        TextStyle style;
        style.fontSize = 100;
        style.fontFamily = {"Arrange Test Sans"};
        style.fontWeight = weight;
        style.italic = italic;
        style.fontSynthesis = synthesis;
        return style;
    }

    void verifyBundledFamily(const std::filesystem::path& fonts) {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        const auto before = service.environment();
        FontRegistry::shared().define(&backend, testFamily(fonts));
        check(service.environment() != before, "登记字体族没有推进字体环境代际");

        // 方块字体的前进量：Regular 520、Bold 680、Italic 600（千分之一 em），字号 100 时每个 A 的宽度为 52、68、60
        const auto width = [&](TextStyle style) { return service.layout("AAAA", style)->width; };
        check(near(width(bundledStyle(400, false)), 208), "常规体宽度应取自 Regular 面");
        check(near(width(bundledStyle(700, false)), 272), "700 应取 Bold 面");
        check(near(width(bundledStyle(500, false)), 208), "500 应按 CSS 落到 Regular 而不是静默变粗");
        check(near(width(bundledStyle(600, false)), 272), "600 应先往上取 Bold");
        check(near(width(bundledStyle(400, true)), 240), "斜体应取 Italic 面");

        const auto resourceOf = [&](TextStyle style) {
            return std::dynamic_pointer_cast<const arrange::juce::JuceTextResource>(service.layout("AAAA", style)->resource);
        };
        // 斜体加粗：取 Italic 面（400）并伪造粗体，斜体本身是真字面
        const auto italicBold = resourceOf(bundledStyle(700, true));
        check(italicBold && !italicBold->runs.empty() && !italicBold->runs[0].boldStroke.isEmpty() && italicBold->runs[0].skew == 0.0f, "斜体 700 应伪造粗体而不错切");
        check(near(width(bundledStyle(700, true)), 240), "斜体 700 的前进量应取自 Italic 面，伪造不改字距");
        const auto strict = resourceOf(bundledStyle(700, true, false));
        check(strict && strict->runs[0].boldStroke.isEmpty(), "关闭伪造后不应有描边");

        // 常规体没有伪造；只有 Regular 与 Bold 的族请求斜体才伪造错切
        const auto plain = resourceOf(bundledStyle(400, false));
        check(plain && plain->runs[0].boldStroke.isEmpty() && plain->runs[0].skew == 0.0f, "真字面不应伪造");

        FontFamilyDefinition upright;
        upright.name = "Arrange Test Upright";
        upright.faces.push_back({readFile(fonts / "ArrangeTestSans-Regular.ttf"), std::nullopt, std::nullopt});
        FontRegistry::shared().define(&backend, upright);
        TextStyle slanted = bundledStyle(400, true);
        slanted.fontFamily = {"Arrange Test Upright"};
        const auto fake = resourceOf(slanted);
        check(fake && fake->runs[0].skew > 0.0f && fake->runs[0].boldStroke.isEmpty(), "缺少斜体面应伪造错切");
        slanted.fontSynthesis = false;
        check(resourceOf(slanted)->runs[0].skew == 0.0f, "关闭伪造后不应错切");
        TextStyle bolded = bundledStyle(800, false);
        bolded.fontFamily = {"Arrange Test Upright"};
        const auto fakeBold = resourceOf(bolded);
        check(fakeBold && !fakeBold->runs[0].boldStroke.isEmpty(), "只有 Regular 的族请求 800 应伪造粗体");

        // 伪造的墨迹边界要大于真字面
        check(service.layout("AAAA", bolded)->inkBounds.width > service.layout("AAAA", [&] { auto s = bolded; s.fontSynthesis = false; return s; }())->inkBounds.width, "伪粗体的墨迹边界应外扩");

        // 族名不分大小写；列表按序取首个可用族
        TextStyle listed = bundledStyle(700, false);
        listed.fontFamily = {"No Such Family Anywhere", "arrange test sans"};
        check(near(width(listed), 272), "族名列表应跳过不存在的族并忽略大小写");

        // 重新登记同名族：旧结果失效
        const auto old = service.layout("AAAA", bundledStyle(400, false));
        FontRegistry::shared().define(&backend, testFamily(fonts));
        check(service.layout("AAAA", bundledStyle(400, false), {}, old) != old, "字体环境代际变化后旧排版不应复用");

        // 撤销登记后回落到默认字体
        FontRegistry::shared().removeOwned(&backend);
        const auto fallback = width(bundledStyle(400, false));
        check(!near(fallback, 208), "撤销登记后应回落到默认字体");
    }

    void verifyDefaultFont() {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        TextStyle plain;
        plain.fontSize = 100;
        TextStyle missing = plain;
        missing.fontFamily = {"No Such Family Anywhere"};
        check(near(service.layout("Hamburgefons", plain)->width, service.layout("Hamburgefons", missing)->width), "不存在的族名应回落到默认字体");
        TextStyle bold = plain;
        bold.fontWeight = 700;
        check(service.layout("Hamburgefons", bold)->width > service.layout("Hamburgefons", plain)->width * 1.01f, "默认字体的粗体应更宽或伪造");
        // 字号是 em：同一字号下中英混排的行高恒为 lineHeight
        TextStyle sized = plain;
        sized.fontSize = 20;
        sized.lineHeight = 30;
        check(near(service.layout("Hello", sized)->height, 30) && near(service.layout("Hello 你好 🙂", sized)->height, 30), "行高应恒为 lineHeight");
    }

    void verifySystemFaces() {
#if JUCE_WINDOWS
        const auto family = arrange::juce::enumerateSystemFontFamily("Segoe UI");
        check(!family.faces.empty(), "Segoe UI 应能枚举出字面");
        bool regular = false, semibold = false, bold = false, italic = false;
        for (const auto& face : family.faces) {
            regular = regular || (face.info.weight == 400 && !face.info.italic);
            semibold = semibold || face.info.weight == 600;
            bold = bold || face.info.weight == 700;
            italic = italic || face.info.italic;
        }
        check(regular && semibold && bold && italic, "Segoe UI 应有常规、半粗、粗与斜体字面");
        TextStyle style;
        style.fontSize = 100;
        style.fontFamily = {"Segoe UI"};
        arrange::juce::JuceFontResolver::shared().resolve(style);
        style.fontWeight = 600;
        const auto resolved = arrange::juce::JuceFontResolver::shared().resolve(style);
        check(resolved.typeface && !resolved.syntheticBold, "Segoe UI 的 600 应取真 Semibold");
        check(resolved.typeface->getStyle().containsIgnoreCase("semi"), "Segoe UI 的 600 选中的字面名应含 Semi");
        style.fontWeight = 400;
        style.italic = true;
        check(!arrange::juce::JuceFontResolver::shared().resolve(style).syntheticItalic, "Segoe UI 有斜体字面，不应伪造");
        // Microsoft YaHei UI 没有斜体：请求斜体应伪造
        style.fontFamily = {"Microsoft YaHei UI"};
        const auto yahei = arrange::juce::JuceFontResolver::shared().resolve(style);
        check(yahei.syntheticItalic, "Microsoft YaHei UI 的斜体应由 Arrange 伪造");
        // 非常规宽度字面不进入枚举
        for (const auto& face : arrange::juce::enumerateSystemFontFamily("Arial").faces) check(face.styleName.find("Narrow") == std::string::npos, "枚举不应包含窄体");
#elif JUCE_MAC
        // macOS 待验：Helvetica Neue 是静态字面，有 400/700 与斜体；Condensed 系列被排除
        const auto family = arrange::juce::enumerateSystemFontFamily("Helvetica Neue");
        check(!family.faces.empty(), "Helvetica Neue 应能枚举出字面");
        bool regular = false, bold = false, italic = false;
        for (const auto& face : family.faces) {
            regular = regular || (face.info.weight == 400 && !face.info.italic);
            bold = bold || face.info.weight == 700;
            italic = italic || face.info.italic;
            check(face.styleName.find("Condensed") == std::string::npos, "枚举不应包含 Condensed 字面");
        }
        check(regular && bold && italic, "Helvetica Neue 应有常规、粗与斜体字面");
        TextStyle style;
        style.fontFamily = {"Helvetica Neue"};
        style.fontWeight = 600;
        const auto resolved = arrange::juce::JuceFontResolver::shared().resolve(style);
        check(resolved.typeface && resolved.syntheticBold == false, "Helvetica Neue 的 600 应往上取真 Bold");
#endif
    }

    ::juce::Image renderText(const TextLayoutService& service, TextStyle style, std::uint32_t color) {
        DrawOp op;
        op.type = DrawOpType::DrawText;
        op.rect = {10, 10, 400, 140};
        op.text = "HHHH";
        op.textStyle = style;
        op.maxLines = 1;
        op.color = color;
        DrawOpsBuilder::prepareText(op, service);
        arrange::juce::JuceDrawOpsPainter painter;
        ::juce::Image image(::juce::Image::ARGB, 440, 160, true);
        ::juce::Graphics graphics(image);
        painter.paint(graphics, std::vector<DrawOp>{op});
        return image;
    }

    struct Ink {
        double coverage = 0;
        double topCentroid = 0;
        double bottomCentroid = 0;
    };

    Ink measureInk(const ::juce::Image& image) {
        Ink ink;
        double topSum = 0, topWeight = 0, bottomSum = 0, bottomWeight = 0;
        int minY = image.getHeight(), maxY = 0;
        for (int y = 0; y < image.getHeight(); ++y)
            for (int x = 0; x < image.getWidth(); ++x)
                if (image.getPixelAt(x, y).getAlpha() > 0) {
                    minY = std::min(minY, y);
                    maxY = std::max(maxY, y);
                }
        const auto middle = (minY + maxY) / 2;
        for (int y = minY; y <= maxY; ++y)
            for (int x = 0; x < image.getWidth(); ++x) {
                const double alpha = image.getPixelAt(x, y).getAlpha() / 255.0;
                ink.coverage += alpha;
                (y < middle ? topSum : bottomSum) += alpha * x;
                (y < middle ? topWeight : bottomWeight) += alpha;
            }
        ink.topCentroid = topWeight > 0 ? topSum / topWeight : 0;
        ink.bottomCentroid = bottomWeight > 0 ? bottomSum / bottomWeight : 0;
        return ink;
    }

    // 伪造在窗口与离屏位图上真的画出来：伪粗体覆盖率明显增大，伪斜体上半部向右偏移，关闭伪造与真字面都不变
    void verifySyntheticRendering(const std::filesystem::path& fonts) {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        FontFamilyDefinition upright;
        upright.name = "Arrange Test Upright";
        upright.faces.push_back({readFile(fonts / "ArrangeTestSans-Regular.ttf"), std::nullopt, std::nullopt});
        FontRegistry::shared().define(&backend, upright);
        TextStyle base = bundledStyle(400, false);
        base.fontSize = 60;
        base.fontFamily = {"Arrange Test Upright"};
        const auto regular = measureInk(renderText(service, base, 0xff000000u));
        auto bold = base;
        bold.fontWeight = 700;
        const auto fakeBold = measureInk(renderText(service, bold, 0xff000000u));
        check(regular.coverage > 100 && fakeBold.coverage > regular.coverage * 1.12, "伪粗体的覆盖率应明显大于常规体");
        bold.fontSynthesis = false;
        check(std::abs(measureInk(renderText(service, bold, 0xff000000u)).coverage - regular.coverage) < 1.0, "关闭伪造后应与常规体完全一致");
        auto italic = base;
        italic.italic = true;
        const auto fakeItalic = measureInk(renderText(service, italic, 0xff000000u));
        check(fakeItalic.topCentroid - fakeItalic.bottomCentroid > 4.0 && std::abs(regular.topCentroid - regular.bottomCentroid) < 1.0, "伪斜体的上半部应向右偏移");
        check(near(static_cast<float>(fakeItalic.coverage), static_cast<float>(regular.coverage), static_cast<float>(regular.coverage) * 0.05f), "错切不应改变覆盖面积");
        // 渐变与纯色路径都经同一变换；半透明文字色下仍有伪造
        bold.fontSynthesis = true;
        const auto translucent = measureInk(renderText(service, bold, 0x80000000u));
        check(translucent.coverage > 0, "半透明文字应能绘制");
        FontRegistry::shared().removeOwned(&backend);
    }

    // 找到右边界之外的墨迹列数（相对文字框右边缘）
    int inkBeyond(const ::juce::Image& image, int right) {
        int count = 0;
        for (int y = 0; y < image.getHeight(); ++y)
            for (int x = right; x < image.getWidth(); ++x)
                if (image.getPixelAt(x, y).getAlpha() > 8) ++count;
        return count;
    }

    // 斜体末字伸出前进量的部分不是视觉溢出，不裁；真正的溢出（排版比文字框宽）才裁到文字框，对齐 Compose 的 hasVisualOverflow
    void verifyItalicOverhang(const std::filesystem::path& fonts) {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        FontRegistry::shared().define(&backend, testFamily(fonts));
        arrange::juce::JuceDrawOpsPainter painter;
        const auto render = [&](TextStyle style, float boxWidth, TextOverflow overflow, DrawOp* out = nullptr) {
            DrawOp op;
            op.type = DrawOpType::DrawText;
            op.rect = {10, 10, boxWidth, 80};
            op.text = "HHHH";
            op.textStyle = style;
            op.maxLines = 1;
            op.overflow = overflow;
            op.color = 0xff000000u;
            DrawOpsBuilder::prepareText(op, service);
            if (boxWidth <= 0) op.rect.width = op.textLayout->width;
            DrawOpsBuilder::prepareText(op, service);
            ::juce::Image image(::juce::Image::ARGB, 400, 120, true);
            ::juce::Graphics graphics(image);
            painter.paint(graphics, std::vector<DrawOp>{op});
            if (out) *out = op;
            return image;
        };
        TextStyle real = bundledStyle(400, true);
        real.fontSize = 60;
        // 方块字体的真 Italic 字面右上角超出前进量：框正好等于排版宽度时，默认 clip 也要画出来
        DrawOp op;
        const auto image = render(real, 0, TextOverflow::Clip, &op);
        check(!textHasVisualOverflow(op), "前进量刚好等于文字框不是视觉溢出");
        check(inkBeyond(image, static_cast<int>(std::ceil(op.rect.x + op.rect.width)) + 1) > 0, "真斜体末字伸出前进量的部分不应被裁掉");
        check(drawOpBounds(op).rect.x + drawOpBounds(op).rect.width >= op.rect.x + op.textLayout->inkBounds.x + op.textLayout->inkBounds.width - 0.5f, "绘制边界应包含伸出的墨迹");
        // 伪斜体同样不裁
        FontFamilyDefinition upright;
        upright.name = "Arrange Test Upright";
        upright.faces.push_back({readFile(fonts / "ArrangeTestSans-Regular.ttf"), std::nullopt, std::nullopt});
        FontRegistry::shared().define(&backend, upright);
        TextStyle fake = real;
        fake.fontFamily = {"Arrange Test Upright"};
        DrawOp fakeOp;
        const auto fakeImage = render(fake, 0, TextOverflow::Clip, &fakeOp);
        check(inkBeyond(fakeImage, static_cast<int>(std::ceil(fakeOp.rect.x + fakeOp.rect.width)) + 1) > 0, "伪斜体末字伸出前进量的部分不应被裁掉");
        // 文字框比排版窄是真溢出：clip 仍裁到文字框，visible 不裁
        const auto narrow = render(fake, 100, TextOverflow::Clip, &fakeOp);
        check(textHasVisualOverflow(fakeOp) && inkBeyond(narrow, 111) == 0, "真正溢出时 clip 应裁到文字框");
        check(inkBeyond(render(fake, 100, TextOverflow::Visible), 111) > 0, "visible 不应裁剪");
        FontRegistry::shared().removeOwned(&backend);
    }

    LayoutModifierSemantics fixedSize(float width, float height) {
        LayoutModifierSemantics value;
        value.kind = LayoutModifierKind::Size;
        value.width = width;
        value.height = height;
        return value;
    }

    PropValue policy(const char* kind) {
        return PropValue::objectValue({{"kind", PropValue::stringValue(kind)}});
    }

    TextModifier styledText() {
        auto text = test_support::text("AAAA", 0xff000000u, 100);
        text.style = bundledStyle(400, false);
        return text;
    }

    // 字体环境代际推进后，Text 重新测量，含文字命令的绘制层重建；代际不变时一律复用
    void verifyRebuildOnGeneration(const std::filesystem::path& fonts) {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        LayoutTree tree;
        LayoutEngine layout(service);
        DrawOpsBuilder builder(service);
        DrawCommand command;
        command.kind = DrawCommandKind::Text;
        command.text = "AAAA";
        command.color = 0xff000000u;
        command.textStyle = bundledStyle(400, false);
        const auto commands = std::make_shared<DrawCommands>(DrawCommands{command});
        tree.apply({CreateNodeMutation{1, NodeType::Layout}, SetPropMutation{1, "measurePolicy", policy("Box")}, SetModifierMutation{1, {{fixedSize(300, 100), {}}, {DrawModifier{}, {}}}}, CreateNodeMutation{2, NodeType::Layout}, SetPropMutation{2, "measurePolicy", policy("MinSize")}, SetModifierMutation{2, {{styledText(), {}}}}, InsertChildMutation{1, 2, 0}});
        for (auto& instance : tree.mutableNode(1).modifier.elements())
            if (std::holds_alternative<DrawModifier>(instance.descriptor.value)) instance.preparedDraw = commands;
        layout.layout(tree, 1, {0, 500, 0, 500});
        PaintWorkCounters counters;
        const auto first = builder.build(tree, 1, counters);
        tree.clearDirty();
        const auto drawLayerOf = [&] {
            for (const auto& instance : tree.node(1).modifier.elements())
                if (std::holds_alternative<DrawModifier>(instance.descriptor.value)) return instance.paintCache;
            return std::shared_ptr<const PaintLayerFragment>{};
        };
        const auto layerBefore = drawLayerOf();
        const auto textBefore = test_support::textLayoutOf(tree.node(2));
        check(layerBefore && layerBefore->before.size() + layerBefore->after.size() == 1, "绘制层应有一条文字命令");
        check(builder.build(tree, 1, counters).fragment == first.fragment, "代际不变时绘制应整体复用");

        FontRegistry::shared().define(&backend, testFamily(fonts));
        (void)service.environment();
        tree.invalidateFontEnvironment();
        layout.layout(tree, 1, {0, 500, 0, 500});
        const auto second = builder.build(tree, 1, counters);
        tree.clearDirty();
        check(second.fragment != first.fragment, "字体代际推进后绘制片段没有重建");
        const auto layerAfter = drawLayerOf();
        check(layerAfter && layerAfter != layerBefore && layerAfter->drawCommands == commands, "含文字命令的绘制层应重建而命令不变");
        const auto textAfter = test_support::textLayoutOf(tree.node(2));
        check(textAfter && textBefore && textAfter != textBefore && near(textAfter->width, 208) , "Text 应按新注册的字体重新测量");
        FontRegistry::shared().removeOwned(&backend);
    }

    // 经完整流水线与被动绘制渲染器（含剔除）：斜体 Text 默认 clip，末字伸出的部分仍被画出
    void verifyItalicThroughPipeline(const std::filesystem::path& fonts) {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        FontRegistry::shared().define(&backend, testFamily(fonts));
        NativeScene scene;
        SceneFramePipeline pipeline{LayoutEngine{service}};
        PublishedFrame frame;
        arrange::juce::PassivePaintRenderer painter(service);
        auto text = test_support::text("HHHH", 0xff000000u, 60);
        text.style = bundledStyle(400, true);
        text.style.fontSize = 60;
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, SetPropMutation{1, "measurePolicy", policy("MinSize")}, SetModifierMutation{1, {{text, {}}}}};
        const auto result = pipeline.run(scene, 1, {0, 400, 0, 200}, &initial, true, frame, [&](const auto&, auto& next) { painter.prepareResources(next.content); });
        check(!result.error, "斜体 Text 的帧失败");
        const auto box = scene.node(1).bounds;
        ::juce::Image image(::juce::Image::ARGB, 400, 200, true);
        {
            ::juce::Graphics graphics(image);
            painter.paint(graphics, frame);
        }
        check(inkBeyond(image, static_cast<int>(std::ceil(box.x + box.width)) + 1) > 0, "完整流水线下真斜体末字伸出的部分被裁掉了");
        FontRegistry::shared().removeOwned(&backend);
    }

    // 流水线在代际推进后无需其它失效也会重新测量与重建
    void verifyPipelineHook(const std::filesystem::path& fonts) {
        arrange::juce::JuceTextMeasurer backend;
        TextLayoutService service(backend);
        NativeScene scene;
        SceneFramePipeline pipeline{LayoutEngine{service}};
        PublishedFrame frame;
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, SetPropMutation{1, "measurePolicy", policy("MinSize")}, SetModifierMutation{1, {{test_support::text("AAAA", 0xff000000u, 100), {}}}}};
        check(!pipeline.run(scene, 1, {0, 400, 0, 200}, &initial, true, frame, {}).error, "初始帧失败");
        TextStyle styled = bundledStyle(400, false);
        auto text = test_support::text("AAAA", 0xff000000u, 100);
        text.style = styled;
        MutationTransaction update;
        update.operations = {SetModifierMutation{1, {{text, {}}}}};
        check(!pipeline.run(scene, 1, {0, 400, 0, 200}, &update, true, frame, {}).error, "更新帧失败");
        const auto width = [&] { return test_support::textLayoutOf(scene.node(1))->width; };
        const auto before = width();
        const auto measures = pipeline.counters().measures;
        check(!pipeline.run(scene, 1, {0, 400, 0, 200}, nullptr, true, frame, {}).error && pipeline.counters().measures == measures, "代际不变时空跑一帧不应重新测量");
        FontRegistry::shared().define(&backend, testFamily(fonts));
        check(!pipeline.run(scene, 1, {0, 400, 0, 200}, nullptr, true, frame, {}).error, "代际推进后的帧失败");
        check(pipeline.counters().measures == measures + 1 && near(width(), 208) && !near(before, 208), "流水线没有在代际推进后重新测量 Text");
        FontRegistry::shared().removeOwned(&backend);
    }
}

int main(int argc, char** argv) {
    try {
        if (argc < 2) throw std::runtime_error("需要测试字体目录参数");
        const std::filesystem::path fonts(argv[1]);
        verifySelection();
        verifyFontTables(fonts);
        verifyBundledFamily(fonts);
        verifyDefaultFont();
        verifySystemFaces();
        verifySyntheticRendering(fonts);
        verifyItalicOverhang(fonts);
        verifyItalicThroughPipeline(fonts);
        verifyRebuildOnGeneration(fonts);
        verifyPipelineHook(fonts);
    } catch (const std::exception& error) {
        std::cerr << "arrange_fonts 失败：" << error.what() << std::endl;
        return 1;
    }
    std::cout << "arrange_fonts passed" << std::endl;
    return 0;
}
