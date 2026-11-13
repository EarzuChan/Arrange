#include <arrange/juce/JuceDrawOpsPainter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/core/Repaint.h>
#include <arrange/juce/NativePainters.h>
#include <arrange/juce/PainterResources.h>
#include <arrange/juce/JuceTextServices.h>
#include <stdexcept>
#include <chrono>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <optional>
#include <string>

namespace arrange::juce {
    namespace {
        int imageAlignmentFlags(arrange::core::ImageAlignment alignment) {
            const auto horizontal = arrange::core::horizontalBias(alignment);
            const auto vertical = arrange::core::verticalBias(alignment);
            const auto x = horizontal == 0.0f ? ::juce::RectanglePlacement::xLeft : horizontal == 1.0f ? ::juce::RectanglePlacement::xRight : ::juce::RectanglePlacement::xMid;
            const auto y = vertical == 0.0f ? ::juce::RectanglePlacement::yTop : vertical == 1.0f ? ::juce::RectanglePlacement::yBottom : ::juce::RectanglePlacement::yMid;
            return x | y;
        }

        int imagePlacementFlags(arrange::core::ContentScale contentScale, arrange::core::ImageAlignment alignment) {
            using arrange::core::ContentScale;
            const auto align = imageAlignmentFlags(alignment);
            if (contentScale == ContentScale::FillBounds) return ::juce::RectanglePlacement::stretchToFit;
            if (contentScale == ContentScale::Crop) return align | ::juce::RectanglePlacement::fillDestination;
            if (contentScale == ContentScale::Inside) return align | ::juce::RectanglePlacement::onlyReduceInSize;
            if (contentScale == ContentScale::Unscaled) return align | ::juce::RectanglePlacement::doNotResize;
            return align;
        }

        ::juce::Rectangle<float> imageFillAxisTarget(float imageWidth, float imageHeight, ::juce::Rectangle<float> target, arrange::core::ContentScale contentScale, arrange::core::ImageAlignment alignment) {
            if (imageWidth <= 0.0f || imageHeight <= 0.0f || target.isEmpty()) return target;

            const auto scale = contentScale == arrange::core::ContentScale::FillHeight ? target.getHeight() / imageHeight : target.getWidth() / imageWidth;
            const auto width = imageWidth * scale;
            const auto height = imageHeight * scale;
            const auto x = target.getX() + (target.getWidth() - width) * arrange::core::horizontalBias(alignment);
            const auto y = target.getY() + (target.getHeight() - height) * arrange::core::verticalBias(alignment);
            return {x, y, width, height};
        }

        void drawImageOp(::juce::Graphics& g, const ::juce::Image& image, ::juce::Rectangle<float> rect, const arrange::core::DrawOp& op, float alpha) {
            ::juce::Graphics::ScopedSaveState scope(g);
            g.reduceClipRegion(rect.toNearestInt());
            const auto fillAlphaWithTint = op.hasTint;
            if (fillAlphaWithTint) {
                g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
            } else {
                g.setOpacity(static_cast<float>((op.color >> 24u) & 0xffu) / 255.0f * alpha);
            }

            if (op.contentScale == arrange::core::ContentScale::FillWidth || op.contentScale == arrange::core::ContentScale::FillHeight) {
                g.saveState();
                g.reduceClipRegion(rect.toNearestInt());
                g.drawImage(image, imageFillAxisTarget(static_cast<float>(image.getWidth()), static_cast<float>(image.getHeight()), rect, op.contentScale, op.alignment), ::juce::RectanglePlacement::stretchToFit, fillAlphaWithTint);
                g.restoreState();
            } else {
                const auto target = rect.toNearestInt();
                g.drawImageWithin(image, target.getX(), target.getY(), target.getWidth(), target.getHeight(), imagePlacementFlags(op.contentScale, op.alignment), fillAlphaWithTint);
            }

            if (!fillAlphaWithTint) g.setOpacity(1.0f);
        }

        // bounds 为矢量源中要显示的区域：整图视口或 filmstrip 的一帧
        void drawVector(::juce::Graphics& graphics, const ::juce::Drawable& vector, ::juce::Rectangle<float> bounds, ::juce::Rectangle<float> target, const arrange::core::DrawOp& op, float alpha) {
            ::juce::Graphics::ScopedSaveState scope(graphics);
            graphics.reduceClipRegion(target.toNearestInt());
            auto placement = imagePlacementFlags(op.contentScale, op.alignment);
            if (op.contentScale == arrange::core::ContentScale::FillWidth || op.contentScale == arrange::core::ContentScale::FillHeight) {
                target = imageFillAxisTarget(bounds.getWidth(), bounds.getHeight(), target, op.contentScale, op.alignment);
                placement = ::juce::RectanglePlacement::stretchToFit;
            }
            vector.draw(graphics, alpha, ::juce::RectanglePlacement(placement).getTransformToFit(bounds, target));
        }

        ::juce::Rectangle<float> frameOf(const arrange::core::PainterSnapshot& painter, ::juce::Rectangle<float> whole) {
            const auto frame = arrange::core::painterFrameRect(painter, {whole.getWidth(), whole.getHeight()});
            return {whole.getX() + frame.x, whole.getY() + frame.y, frame.width, frame.height};
        }

        float colorAlpha(std::uint32_t color) {
            return static_cast<float>((color >> 24u) & 0xffu) / 255.0f;
        }

        // 分角圆角以三次贝塞尔近似四分之一圆
        ::juce::Path roundedPath(::juce::Rectangle<float> rect, arrange::core::CornerRadii input) {
            constexpr auto k = 0.44771525f;
            const auto r = input.fitted(rect.getWidth(), rect.getHeight());
            const auto left = rect.getX(), top = rect.getY(), right = rect.getRight(), bottom = rect.getBottom();
            ::juce::Path path;
            path.startNewSubPath(left + r.topStart, top);
            path.lineTo(right - r.topEnd, top);
            if (r.topEnd > 0) path.cubicTo(right - r.topEnd * k, top, right, top + r.topEnd * k, right, top + r.topEnd);
            path.lineTo(right, bottom - r.bottomEnd);
            if (r.bottomEnd > 0) path.cubicTo(right, bottom - r.bottomEnd * k, right - r.bottomEnd * k, bottom, right - r.bottomEnd, bottom);
            path.lineTo(left + r.bottomStart, bottom);
            if (r.bottomStart > 0) path.cubicTo(left + r.bottomStart * k, bottom, left, bottom - r.bottomStart * k, left, bottom - r.bottomStart);
            path.lineTo(left, top + r.topStart);
            if (r.topStart > 0) path.cubicTo(left, top + r.topStart * k, left + r.topStart * k, top, left + r.topStart, top);
            path.closeSubPath();
            return path;
        }

        // 路径数据为局部坐标，按 op.rect 相对路径外包盒的位移平移
        ::juce::Path pathOf(const arrange::core::DrawOp& op) {
            using arrange::core::PathVerb;
            const auto& data = *op.path;
            const auto dx = op.rect.x - data.bounds.x, dy = op.rect.y - data.bounds.y;
            ::juce::Path path;
            path.setUsingNonZeroWinding(!data.evenOdd);
            std::size_t index = 0;
            const auto v = [&](std::size_t offset) {
                return data.values[index + offset];
            };
            for (const auto verb : data.verbs) {
                switch (verb) {
                    case PathVerb::MoveTo:
                        path.startNewSubPath(v(0) + dx, v(1) + dy);
                        break;
                    case PathVerb::LineTo:
                        path.lineTo(v(0) + dx, v(1) + dy);
                        break;
                    case PathVerb::QuadTo:
                        path.quadraticTo(v(0) + dx, v(1) + dy, v(2) + dx, v(3) + dy);
                        break;
                    case PathVerb::CubicTo:
                        path.cubicTo(v(0) + dx, v(1) + dy, v(2) + dx, v(3) + dy, v(4) + dx, v(5) + dy);
                        break;
                    case PathVerb::ArcTo: {
                        // JUCE 的角度从十二点方向起算，Compose 从三点方向起算，均为顺时针
                        constexpr auto degrees = ::juce::MathConstants<float>::pi / 180.0f;
                        const auto from = (v(4) + 90.0f) * degrees;
                        path.addArc(v(0) + dx, v(1) + dy, v(2), v(3), from, from + v(5) * degrees, v(6) != 0 || path.isEmpty());
                        break;
                    }
                    case PathVerb::Close:
                        path.closeSubPath();
                        break;
                }
                index += static_cast<std::size_t>(arrange::core::pathVerbArity(verb));
            }
            return path;
        }

        ::juce::Path shapePath(const arrange::core::DrawOp& op, ::juce::Rectangle<float> rect) {
            using arrange::core::DrawShapeType;
            if (op.shape == DrawShapeType::Path && op.path) return pathOf(op);
            if (op.shape == DrawShapeType::Rounded) return roundedPath(rect, op.corners);
            ::juce::Path path;
            if (op.shape == DrawShapeType::Circle)
                path.addEllipse(rect);
            else
                path.addRectangle(rect);
            return path;
        }

        ::juce::PathStrokeType strokeType(const arrange::core::DrawOp& op) {
            using arrange::core::StrokeCap;
            using arrange::core::StrokeJoin;
            const auto joint = op.join == StrokeJoin::Round ? ::juce::PathStrokeType::curved : op.join == StrokeJoin::Bevel ? ::juce::PathStrokeType::beveled : ::juce::PathStrokeType::mitered;
            const auto cap = op.cap == StrokeCap::Round ? ::juce::PathStrokeType::rounded : op.cap == StrokeCap::Square ? ::juce::PathStrokeType::square : ::juce::PathStrokeType::butt;
            return {op.strokeWidth, joint, cap};
        }

        ::juce::ColourGradient colourGradient(const arrange::core::Gradient& gradient, ::juce::Rectangle<float> box) {
            const auto at = [&](arrange::core::Point point) {
                return ::juce::Point<float>(box.getX() + box.getWidth() * point.x, box.getY() + box.getHeight() * point.y);
            };
            ::juce::ColourGradient result;
            if (gradient.kind == arrange::core::GradientKind::Radial) {
                const auto center = at(gradient.center);
                auto farthest = 0.0f;
                for (const auto& corner : {box.getTopLeft(), box.getTopRight(), box.getBottomLeft(), box.getBottomRight()}) farthest = std::max(farthest, center.getDistanceFrom(corner));
                result.isRadial = true;
                result.point1 = center;
                result.point2 = center.translated(std::max(0.001f, farthest * gradient.radius), 0.0f);
            } else {
                result.point1 = at(gradient.start);
                result.point2 = at(gradient.end);
                if (result.point1 == result.point2) result.point2 = result.point1.translated(0.0f, 0.001f);
            }
            for (const auto& stop : gradient.stops) result.addColour(stop.position, ::juce::Colour(stop.color));
            return result;
        }

        bool drawsFocusedInput(std::span<const arrange::core::DrawOp> ops, arrange::core::ModifierHandle focused) {
            return std::any_of(ops.begin(), ops.end(), [&](const auto& op) { return op.inputText && op.textField == focused; });
        }

        // 子树是否画了焦点输入框：光标与选区不在片段身份里，这样的子树不能用缓存结果
        bool containsFocusedInput(const arrange::core::PaintFragment& fragment, arrange::core::ModifierHandle focused) {
            if (fragment.layer && (drawsFocusedInput(fragment.layer->before, focused) || drawsFocusedInput(fragment.layer->after, focused))) return true;
            if (fragment.content && drawsFocusedInput(*fragment.content, focused)) return true;
            return std::any_of(fragment.children.begin(), fragment.children.end(), [&](const auto& child) { return child.fragment && containsFocusedInput(*child.fragment, focused); });
        }

        bool isScrollLayer(const arrange::core::PaintLayerFragment& layer) {
            const auto* semantics = std::get_if<arrange::core::LayoutModifierSemantics>(&layer.value);
            return semantics && semantics->enabled && (semantics->kind == arrange::core::LayoutModifierKind::VerticalScroll || semantics->kind == arrange::core::LayoutModifierKind::HorizontalScroll);
        }

        bool hasInputOps(std::span<const arrange::core::DrawOp> ops) {
            return std::any_of(ops.begin(), ops.end(), [](const auto& op) { return op.inputText; });
        }

        // 子树是否含背景模糊（依赖根重放）与 Input（可能成为焦点而带光标与选区）
        void scanTraits(const arrange::core::PaintFragment& fragment, bool& backdrop, bool& input) {
            if (fragment.layer) {
                if (const auto* effect = std::get_if<arrange::core::EffectModifier>(&fragment.layer->value); effect && effect->kind == arrange::core::EffectKind::BackdropBlur) backdrop = true;
                if (hasInputOps(fragment.layer->before) || hasInputOps(fragment.layer->after)) input = true;
            }
            if (fragment.content && hasInputOps(*fragment.content)) input = true;
            for (const auto& child : fragment.children)
                if (child.fragment) scanTraits(*child.fragment, backdrop, input);
        }

        // 截取背景只画到目标为止；目标在子树里时子树画不完整，不能写进缓存
        bool containsPlacement(const arrange::core::PlacedPaintFragment& placed, const arrange::core::PlacedPaintFragment* target) {
            if (&placed == target) return true;
            if (!placed.fragment) return false;
            return std::any_of(placed.fragment->children.begin(), placed.fragment->children.end(), [&](const auto& child) { return containsPlacement(child, target); });
        }
    }

    void JuceDrawOpsPainter::fillWithPaint(::juce::Graphics& g, const ::juce::Path& path, const arrange::core::DrawOp& op, ::juce::Rectangle<float> box, float alpha) const {
        if (!op.gradient) {
            g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
            g.fillPath(path);
            return;
        }
        ::juce::Graphics::ScopedSaveState scope(g);
        if (op.gradient->kind == arrange::core::GradientKind::Sweep) {
            g.reduceClipRegion(path);
            g.setOpacity(colorAlpha(op.color) * alpha);
            // 描边轮廓会超出形状矩形，图像铺满路径与矩形的并集
            const auto area = path.getBounds().getUnion(box);
            g.drawImage(sweepImage(g, op.gradient, box, area), area, ::juce::RectanglePlacement::stretchToFit);
            return;
        }
        g.setGradientFill(colourGradient(*op.gradient, box));
        g.setOpacity(colorAlpha(op.color) * alpha);
        g.fillPath(path);
    }

    ::juce::Image JuceDrawOpsPainter::sweepImage(::juce::Graphics& g, const arrange::core::GradientRef& gradient, ::juce::Rectangle<float> box, ::juce::Rectangle<float> area) const {
        const auto scale = std::max(1.0f, g.getInternalContext().getPhysicalPixelScaleFactor());
        const auto width = std::clamp(static_cast<int>(std::ceil(area.getWidth() * scale)), 1, 4096);
        const auto height = std::clamp(static_cast<int>(std::ceil(area.getHeight() * scale)), 1, 4096);
        // 中心在图像中的像素位置随 box 与 area 的关系变化，计入缓存键
        const auto centerX = (box.getX() + box.getWidth() * gradient->center.x - area.getX()) / std::max(area.getWidth(), 1e-3f) * static_cast<float>(width);
        const auto centerY = (box.getY() + box.getHeight() * gradient->center.y - area.getY()) / std::max(area.getHeight(), 1e-3f) * static_cast<float>(height);
        const auto detail = CacheDetail().add(0x5733u).add(std::round(centerX * 4.0f)).add(std::round(centerY * 4.0f)).value();
        return bitmapCache_.get({gradient.value, detail, width, height}, [&] {
            // 色标先展开为查找表，逐像素只算一次角度
            constexpr int lookupSize = 1024;
            ::juce::ColourGradient colours;
            for (const auto& stop : gradient->stops) colours.addColour(stop.position, ::juce::Colour(stop.color));
            std::vector<::juce::PixelARGB> lookup(lookupSize);
            for (int index = 0; index < lookupSize; ++index) {
                lookup[static_cast<std::size_t>(index)] = colours.getColourAtPosition(static_cast<double>(index) / (lookupSize - 1)).getPixelARGB();
                lookup[static_cast<std::size_t>(index)].premultiply();
            }
            ::juce::Image image(::juce::Image::ARGB, width, height, false);
            {
                ::juce::Image::BitmapData data(image, ::juce::Image::BitmapData::writeOnly);
                for (int y = 0; y < height; ++y)
                    for (int x = 0; x < width; ++x) {
                        auto degrees = std::atan2(static_cast<float>(y) + 0.5f - centerY, static_cast<float>(x) + 0.5f - centerX) * 180.0f / ::juce::MathConstants<float>::pi - gradient->startAngle;
                        degrees -= 360.0f * std::floor(degrees / 360.0f);
                        const auto index = std::clamp(static_cast<int>(degrees / 360.0f * (lookupSize - 1) + 0.5f), 0, lookupSize - 1);
                        *reinterpret_cast<::juce::PixelARGB*>(data.getPixelPointer(x, y)) = lookup[static_cast<std::size_t>(index)];
                    }
            }
            return image;
        });
    }

    // 像素缓冲按内容身份转为预乘位图，同一版本只转换一次
    ::juce::Image JuceDrawOpsPainter::pixelImage(const std::shared_ptr<const arrange::core::PainterContent>& content) const {
        const auto& pixels = static_cast<const arrange::core::PixelBufferContent&>(*content);
        return bitmapCache_.get({content, 0x9e1u, pixels.width, pixels.height}, [&] {
            ::juce::Image image(::juce::Image::ARGB, pixels.width, pixels.height, false, ::juce::SoftwareImageType());
            const ::juce::Image::BitmapData data(image, ::juce::Image::BitmapData::writeOnly);
            for (int y = 0; y < pixels.height; ++y)
                for (int x = 0; x < pixels.width; ++x) {
                    const auto value = pixels.pixels[static_cast<std::size_t>(y * pixels.width + x)];
                    ::juce::PixelARGB pixel(static_cast<::juce::uint8>(value >> 24), static_cast<::juce::uint8>(value >> 16), static_cast<::juce::uint8>(value >> 8), static_cast<::juce::uint8>(value));
                    pixel.premultiply();
                    *reinterpret_cast<::juce::PixelARGB*>(data.getPixelPointer(x, y)) = pixel;
                }
            return image;
        });
    }

    void JuceDrawOpsPainter::drawPainter(::juce::Graphics& g, const arrange::core::DrawOp& op, ::juce::Rectangle<float> rect, float alpha) const {
        using arrange::core::ImageRepeat;
        if (rect.isEmpty()) return;
        const auto& content = op.painter.content;
        const auto* juceContent = dynamic_cast<const JucePainterContent*>(content.get());
        const auto pixelBuffer = dynamic_cast<const arrange::core::PixelBufferContent*>(content.get()) != nullptr;
        if (!juceContent && !pixelBuffer) throw std::runtime_error("Painter 绘制内容不属于 JUCE 受体");
        // 源图：位图取 filmstrip 当前帧；矢量取帧对应的视口
        ::juce::Image image;
        ::juce::Rectangle<float> vectorBounds;
        if (pixelBuffer || juceContent->image.isValid()) {
            const auto whole = pixelBuffer ? pixelImage(content) : juceContent->image;
            const auto frame = frameOf(op.painter, whole.getBounds().toFloat()).toNearestInt();
            image = op.painter.frames > 1 ? whole.getClippedImage(frame) : whole;
        } else if (juceContent->vector) {
            const auto whole = juceContent->vectorViewport.isEmpty() ? juceContent->vector->getDrawableBounds() : juceContent->vectorViewport;
            vectorBounds = frameOf(op.painter, whole);
        } else
            return;

        if (op.repeat == ImageRepeat::None) {
            if (image.isValid()) return drawImageOp(g, image, rect, op, alpha);
            if (op.hasTint) {
                // 蒙版与颜色无关，按物理像素栅格化后缓存；着色在绘制时由 alpha 着色完成，换色不重建
                const auto scale = std::round(std::clamp(g.getInternalContext().getPhysicalPixelScaleFactor(), 0.25f, 8.0f) * 16.0f) / 16.0f;
                const auto width = std::clamp(static_cast<int>(std::ceil(rect.getWidth() * scale)), 1, 4096), height = std::clamp(static_cast<int>(std::ceil(rect.getHeight() * scale)), 1, 4096);
                const auto detail = CacheDetail{}.add(0x7a5cu).add(op.painter.frame).add(op.painter.frames).add(op.painter.horizontal).add(static_cast<int>(op.contentScale)).add(static_cast<int>(op.alignment)).add(rect.getWidth()).add(rect.getHeight()).add(scale).value();
                const auto mask = bitmapCache_.get({content, detail, width, height}, [&] {
                    ::juce::Image result(::juce::Image::ARGB, width, height, true, ::juce::SoftwareImageType());
                    ::juce::Graphics graphics(result);
                    graphics.addTransform(::juce::AffineTransform::scale(static_cast<float>(width) / rect.getWidth(), static_cast<float>(height) / rect.getHeight()));
                    drawVector(graphics, *juceContent->vector, vectorBounds, rect.withZeroOrigin(), op, 1.0f);
                    return result;
                });
                g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
                g.drawImage(mask, rect, ::juce::RectanglePlacement::stretchToFit, true);
            } else
                drawVector(g, *juceContent->vector, vectorBounds, rect, op, colorAlpha(op.color) * alpha);
            return;
        }

        // 平铺与九宫格以固有尺寸为逻辑单位；矢量先按物理缩放栅格化，着色预先烘入位图
        const auto intrinsic = arrange::core::painterIntrinsicSize(op.painter);
        const auto logical = intrinsic && intrinsic->width > 0 && intrinsic->height > 0 ? ::juce::Rectangle<float>(0, 0, intrinsic->width, intrinsic->height) : image.isValid() ? image.getBounds().toFloat() : vectorBounds.withZeroOrigin();
        if (logical.isEmpty()) return;
        const auto scale = std::clamp(g.getInternalContext().getPhysicalPixelScaleFactor(), 0.25f, 8.0f);
        if (!image.isValid()) {
            const auto width = std::clamp(static_cast<int>(std::ceil(logical.getWidth() * scale)), 1, 4096), height = std::clamp(static_cast<int>(std::ceil(logical.getHeight() * scale)), 1, 4096);
            image = bitmapCache_.get({content, CacheDetail{}.add(op.painter.frame).add(op.painter.frames).add(scale).value(), width, height}, [&] {
                ::juce::Image result(::juce::Image::ARGB, width, height, true, ::juce::SoftwareImageType());
                ::juce::Graphics graphics(result);
                juceContent->vector->draw(graphics, 1.0f, ::juce::RectanglePlacement(::juce::RectanglePlacement::stretchToFit).getTransformToFit(vectorBounds, result.getBounds().toFloat()));
                return result;
            });
        }
        if (op.hasTint) {
            const auto source = image;
            image = bitmapCache_.get({content, CacheDetail{}.add(op.painter.frame).add(op.color).add(scale).add(source.getWidth()).value(), source.getWidth(), source.getHeight()}, [&] {
                ::juce::Image result(::juce::Image::ARGB, source.getWidth(), source.getHeight(), true, ::juce::SoftwareImageType());
                ::juce::Graphics graphics(result);
                graphics.setColour(::juce::Colour(op.color));
                graphics.drawImageAt(source, 0, 0, true);
                return result;
            });
        }
        ::juce::Graphics::ScopedSaveState scope(g);
        g.reduceClipRegion(rect.toNearestInt());
        g.setOpacity(std::clamp((op.hasTint ? 1.0f : colorAlpha(op.color)) * alpha, 0.0f, 1.0f));
        const auto unitX = logical.getWidth() / static_cast<float>(image.getWidth()), unitY = logical.getHeight() / static_cast<float>(image.getHeight());
        if (op.repeat == ImageRepeat::Tile) {
            g.setFillType(::juce::FillType(image, ::juce::AffineTransform::scale(unitX, unitY).translated(rect.getX(), rect.getY())));
            g.fillRect(rect);
            return;
        }
        // 九宫格：源切分换算为像素；目标四角保持逻辑尺寸，放不下时等比缩小
        const auto& s = op.slices;
        const auto fit = std::min({1.0f, s.left + s.right > 0 ? rect.getWidth() / (s.left + s.right) : 1.0f, s.top + s.bottom > 0 ? rect.getHeight() / (s.top + s.bottom) : 1.0f});
        const float sourceX[]{0, s.left / unitX, (logical.getWidth() - s.right) / unitX, static_cast<float>(image.getWidth())};
        const float sourceY[]{0, s.top / unitY, (logical.getHeight() - s.bottom) / unitY, static_cast<float>(image.getHeight())};
        const float targetX[]{rect.getX(), rect.getX() + s.left * fit, rect.getRight() - s.right * fit, rect.getRight()};
        const float targetY[]{rect.getY(), rect.getY() + s.top * fit, rect.getBottom() - s.bottom * fit, rect.getBottom()};
        for (int row = 0; row < 3; ++row)
            for (int column = 0; column < 3; ++column) {
                const auto source = ::juce::Rectangle<float>::leftTopRightBottom(sourceX[column], sourceY[row], sourceX[column + 1], sourceY[row + 1]).toNearestInt();
                const auto target = ::juce::Rectangle<float>::leftTopRightBottom(targetX[column], targetY[row], targetX[column + 1], targetY[row + 1]);
                if (source.isEmpty() || target.isEmpty()) continue;
                g.drawImageTransformed(image.getClippedImage(source), ::juce::AffineTransform::scale(target.getWidth() / static_cast<float>(source.getWidth()), target.getHeight() / static_cast<float>(source.getHeight())).translated(target.getX(), target.getY()));
            }
    }

    void JuceDrawOpsPainter::drawText(::juce::Graphics& g, const arrange::core::DrawOp& op, float horizontalViewportOffset, float alpha) const {
        if (!op.textLayout) throw std::logic_error("发布的文字缺少排版资源");
        const auto* resource = dynamic_cast<const JuceTextResource*>(op.textLayout->resource.get());
        if (!resource) throw std::logic_error("发布的文字不是 JUCE 绘制资源");
        ::juce::Graphics::ScopedSaveState scope(g);
        if (op.inputText || (op.overflow != arrange::core::TextOverflow::Visible && arrange::core::textHasVisualOverflow(op))) g.reduceClipRegion(::juce::Rectangle<float>(op.rect.x, op.rect.y, op.rect.width, op.rect.height).getSmallestIntegerContainer());
        g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
        const auto started = std::chrono::steady_clock::now();
        resource->replay(g, *op.textLayout, op.rect, op.textAlign, horizontalViewportOffset);
        if (!resource->runs.empty()) ++counters_.textSubmissions;
        counters_.glyphSubmitMillis += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    }

    bool JuceDrawOpsPainter::invisible(::juce::Graphics& graphics, arrange::core::PaintBounds bounds) const {
        if (!cullingEnabled_ || !bounds.known) return false;
        if (bounds.empty) return true;
        const auto& r = bounds.rect;
        if (!std::isfinite(r.x) || !std::isfinite(r.y) || !std::isfinite(r.width) || !std::isfinite(r.height)) return false;
        // 超出整数裁剪接口的范围时保留绘制，避免转换溢出造成漏画
        if (std::max({std::abs(r.x), std::abs(r.y), std::abs(r.x + r.width), std::abs(r.y + r.height)}) > 100000000.0f) return false;
        return !graphics.clipRegionIntersects(::juce::Rectangle<float>(r.x, r.y, r.width, r.height).expanded(1.0f).getSmallestIntegerContainer());
    }

    JuceDrawOpsPainter::PaintResult JuceDrawOpsPainter::paint(::juce::Graphics& g, const std::vector<arrange::core::DrawOp>& ops, arrange::core::ModifierHandle focused, float, std::span<const arrange::core::DrawOp> focusedInputOps) const {
        replayScopedOps(g, ops, focused, focusedInputOps, 1);
        return {};
    }

    void JuceDrawOpsPainter::replayScopedOps(::juce::Graphics& g, std::span<const arrange::core::DrawOp> ops, arrange::core::ModifierHandle focused, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha) const {
        const auto base = transformStack_.size();
        const auto saved = transform_;
        const auto restore = [&](int depth) {
            while (depth-- > 0) g.restoreState();
            transformStack_.resize(base);
            transform_ = saved;
        };
        g.saveState();
        int depth = 1;
        try {
            replayOps(g, ops, focused, focusedInputOps, alpha, depth);
        } catch (...) {
            restore(depth);
            throw;
        }
        restore(depth);
    }

    JuceDrawOpsPainter::PaintResult JuceDrawOpsPainter::paint(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& root, arrange::core::ModifierHandle focused, float, std::span<const arrange::core::DrawOp> focusedInputOps) const {
        root_ = &root;
        focused_ = focused;
        focusedOps_ = focusedInputOps;
        transform_ = {};
        transformStack_.clear();
        stopAt_ = nullptr;
        stopped_ = false;
        try {
            replayFragment(g, root, focused, focusedInputOps, 1);
        } catch (...) {
            root_ = nullptr;
            focusedOps_ = {};
            throw;
        }
        root_ = nullptr;
        focusedOps_ = {};
        return {};
    }

    void JuceDrawOpsPainter::replayFragment(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& placed, arrange::core::ModifierHandle focused, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha) const {
        if (!placed.fragment || stopped_) return;
        if (&placed == stopAt_) {
            stopped_ = true;
            return;
        }
        ++counters_.fragmentsVisited;
        ::juce::Graphics::ScopedSaveState scope(g);
        const auto base = transformStack_.size();
        const auto saved = transform_;
        g.addTransform(::juce::AffineTransform::translation(placed.offset.x, placed.offset.y));
        transform_ = ::juce::AffineTransform::translation(placed.offset.x, placed.offset.y).followedBy(saved);
        const auto& fragment = *placed.fragment;
        const auto restore = [&](int depth) {
            while (depth-- > 0) g.restoreState();
            transformStack_.resize(base);
            transform_ = saved;
        };
        if (invisible(g, fragment.bounds)) {
            ++counters_.fragmentsSkipped;
            transform_ = saved;
            return;
        }
        g.saveState();
        int depth = 1;
        try {
            const auto* effect = fragment.layer ? std::get_if<arrange::core::EffectModifier>(&fragment.layer->value) : nullptr;
            if (fragment.layer && fragment.layer->drawCommands) {
                for (const auto& op : fragment.layer->before) {
                    if (stopped_) break;
                    if (op.type == arrange::core::DrawOpType::ContentMarker) {
                        for (const auto& child : fragment.children) replayFragment(g, child, focused, focusedInputOps, alpha);
                    } else
                        replayOps(g, std::span<const arrange::core::DrawOp>(&op, 1), focused, focusedInputOps, alpha, depth);
                }
            } else if (!effect || !replayEffect(g, placed, *effect, focused, focusedInputOps, alpha)) {
                if (fragment.layer) replayOps(g, fragment.layer->before, focused, focusedInputOps, alpha, depth);
                const auto contentAlpha = alpha * (fragment.layer ? fragment.layer->contentAlpha : 1.0f);
                if (fragment.content) replayOps(g, *fragment.content, focused, focusedInputOps, contentAlpha, depth);
                const auto tiled = fragment.layer && fragment.children.size() == 1 && isScrollLayer(*fragment.layer);
                for (const auto& child : fragment.children)
                    if (!tiled || !replayScrollTiles(g, placed, child, focused, focusedInputOps, contentAlpha)) replayFragment(g, child, focused, focusedInputOps, contentAlpha);
                if (fragment.layer) replayOps(g, fragment.layer->after, focused, focusedInputOps, alpha, depth);
            }
        } catch (...) {
            restore(depth);
            throw;
        }
        restore(depth);
    }

    namespace {
        ::juce::Path effectShape(const arrange::core::PaintStyleSemantics& shape, ::juce::Rectangle<float> rect, float grow) {
            ::juce::Path path;
            rect = rect.expanded(grow);
            if (rect.isEmpty()) return path;
            if (shape.shapeType == arrange::core::ShapeKind::Circle)
                path.addEllipse(rect);
            else if (shape.shapeType == arrange::core::ShapeKind::Rounded) {
                auto corners = shape.corners;
                for (auto* corner : {&corners.topStart, &corners.topEnd, &corners.bottomEnd, &corners.bottomStart}) *corner = std::max(0.0f, *corner + grow);
                path = roundedPath(rect, corners);
            } else
                path.addRectangle(rect);
            return path;
        }

        // 离屏位图的像素尺寸：按物理缩放取整，单边不超过 4096
        struct Offscreen {
            ::juce::Rectangle<float> area;
            float scale = 1;
            int width = 0;
            int height = 0;
        };

        std::optional<Offscreen> offscreen(::juce::Graphics& g, ::juce::Rectangle<float> area) {
            if (area.isEmpty() || !std::isfinite(area.getWidth()) || !std::isfinite(area.getHeight())) return std::nullopt;
            auto scale = std::max(0.01f, g.getInternalContext().getPhysicalPixelScaleFactor());
            scale = std::min({scale, 4096.0f / area.getWidth(), 4096.0f / area.getHeight()});
            Offscreen result{area, scale, std::max(1, static_cast<int>(std::ceil(area.getWidth() * scale))), std::max(1, static_cast<int>(std::ceil(area.getHeight() * scale)))};
            return result;
        }

        ::juce::AffineTransform toImage(const Offscreen& target) {
            return ::juce::AffineTransform::translation(-target.area.getX(), -target.area.getY()).scaled(target.scale);
        }

        void drawOffscreen(::juce::Graphics& g, const ::juce::Image& image, const Offscreen& target, float opacity) {
            g.setOpacity(std::clamp(opacity, 0.0f, 1.0f));
            g.drawImage(image, {target.area.getX(), target.area.getY(), static_cast<float>(target.width) / target.scale, static_cast<float>(target.height) / target.scale}, ::juce::RectanglePlacement::stretchToFit);
            g.setOpacity(1.0f);
        }

        std::uint64_t pixelDigest(const ::juce::Image& image) {
            CacheDetail detail;
            const ::juce::Image::BitmapData data(image, ::juce::Image::BitmapData::readOnly);
            for (int y = 0; y < data.height; ++y) {
                const auto* row = data.getLinePointer(y);
                for (int x = 0; x + 8 <= data.width * data.pixelStride; x += 8) {
                    std::uint64_t word = 0;
                    std::memcpy(&word, row + x, 8);
                    detail.add(word);
                }
            }
            return detail.value();
        }
    }

    bool JuceDrawOpsPainter::replayEffect(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& placed, const arrange::core::EffectModifier& effect, arrange::core::ModifierHandle focused, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha) const {
        using arrange::core::EffectKind;
        const auto& fragment = *placed.fragment;
        const auto& layer = fragment.layer;
        const ::juce::Rectangle<float> rect(layer->bounds.x, layer->bounds.y, layer->bounds.width, layer->bounds.height);
        const auto sigma = arrange::core::effectSigma(effect);
        const auto margin = std::ceil(sigma * 3.0f);
        const std::shared_ptr<const void> owner = layer;
        switch (effect.kind) {
            case EffectKind::DropShadow: {
                const auto shape = effectShape(effect.shape, rect, effect.spread);
                if (shape.isEmpty() || (effect.color >> 24u) == 0) return false;
                const auto target = offscreen(g, shape.getBounds().expanded(margin).translated(effect.offset.x, effect.offset.y));
                if (!target) return false;
                const auto image = bitmapCache_.get({owner, CacheDetail{}.add(target->scale).value(), target->width, target->height}, [&] {
                    ::juce::Image result(::juce::Image::ARGB, target->width, target->height, true, ::juce::SoftwareImageType());
                    {
                        ::juce::Graphics graphics(result);
                        graphics.addTransform(::juce::AffineTransform::translation(effect.offset.x, effect.offset.y).followedBy(toImage(*target)));
                        graphics.setColour(::juce::Colour(effect.color));
                        graphics.fillPath(shape);
                    }
                    gaussianBlur(result, sigma * target->scale);
                    return result;
                });
                drawOffscreen(g, image, *target, alpha);
                return false;
            }
            case EffectKind::InnerShadow: {
                const auto outer = effectShape(effect.shape, rect, 0);
                if (outer.isEmpty() || (effect.color >> 24u) == 0) return false;
                const auto target = offscreen(g, rect.expanded(margin + std::abs(effect.offset.x) + std::abs(effect.offset.y)));
                if (!target) return false;
                const auto image = bitmapCache_.get({owner, CacheDetail{}.add(target->scale).value(), target->width, target->height}, [&] {
                    ::juce::Image result(::juce::Image::ARGB, target->width, target->height, true, ::juce::SoftwareImageType());
                    {
                        // 阴影色铺满，挖去按扩展收缩、按偏移移动后的形状
                        ::juce::Graphics graphics(result);
                        graphics.addTransform(toImage(*target));
                        ::juce::Path cover;
                        cover.setUsingNonZeroWinding(false);
                        cover.addRectangle(target->area);
                        cover.addPath(effectShape(effect.shape, rect, -effect.spread), ::juce::AffineTransform::translation(effect.offset.x, effect.offset.y));
                        graphics.setColour(::juce::Colour(effect.color));
                        graphics.fillPath(cover);
                    }
                    gaussianBlur(result, sigma * target->scale);
                    return result;
                });
                ::juce::Graphics::ScopedSaveState scope(g);
                g.reduceClipRegion(outer);
                drawOffscreen(g, image, *target, alpha);
                return false;
            }
            case EffectKind::Blur: {
                auto area = fragment.bounds.known && !fragment.bounds.empty ? ::juce::Rectangle<float>(fragment.bounds.rect.x, fragment.bounds.rect.y, fragment.bounds.rect.width, fragment.bounds.rect.height) : rect.expanded(margin);
                const auto target = offscreen(g, area);
                if (!target) return true;
                const auto build = [&] {
                    ::juce::Image result(::juce::Image::ARGB, target->width, target->height, true, ::juce::SoftwareImageType());
                    {
                        ::juce::Graphics graphics(result);
                        graphics.addTransform(toImage(*target));
                        for (const auto& child : fragment.children) replayFragment(graphics, child, focused, focusedInputOps, 1.0f);
                    }
                    gaussianBlur(result, sigma * target->scale);
                    return result;
                };
                // 只有子树画了焦点输入框，或截取背景的目标落在子树里时才绕开缓存，其余情况照常命中
                const auto bypass = (focused.valid() && containsFocusedInput(fragment, focused)) || (stopAt_ && containsPlacement(placed, stopAt_));
                const auto image = bypass ? build() : bitmapCache_.get({placed.fragment, CacheDetail{}.add(target->scale).value(), target->width, target->height}, build);
                if (!stopped_) drawOffscreen(g, image, *target, alpha);
                return true;
            }
            case EffectKind::BackdropBlur: {
                const auto target = offscreen(g, rect.expanded(margin));
                if (!target || !root_) return false;
                auto backdrop = captureBackdrop(placed, target->area, target->scale, target->width, target->height);
                // 背景像素未变时复用上次的模糊结果
                const auto digest = CacheDetail{}.add(pixelDigest(backdrop)).add(target->scale).value();
                const auto image = bitmapCache_.get({owner, digest, target->width, target->height}, [&] {
                    gaussianBlur(backdrop, sigma * target->scale);
                    return backdrop;
                });
                ::juce::Graphics::ScopedSaveState scope(g);
                g.reduceClipRegion(effectShape(effect.shape, rect, 0));
                drawOffscreen(g, image, *target, 1.0f);
                return false;
            }
        }
        return false;
    }

    ::juce::Image JuceDrawOpsPainter::buildScrollTile(const std::shared_ptr<const arrange::core::PaintFragment>& content, arrange::core::Point tileOrigin, float scale, arrange::core::ModifierHandle focused, std::span<const arrange::core::DrawOp> focusedInputOps) const {
        ::juce::Image image(::juce::Image::ARGB, ScrollTileCache::tilePixels, ScrollTileCache::tilePixels, true, ::juce::NativeImageType());
        const auto savedTransform = transform_;
        auto savedStack = std::move(transformStack_);
        transformStack_.clear();
        transform_ = {};
        inTile_ = true;
        const auto restore = [&] {
            inTile_ = false;
            transform_ = savedTransform;
            transformStack_ = std::move(savedStack);
        };
        try {
            ::juce::Graphics graphics(image);
            graphics.addTransform(::juce::AffineTransform::translation(-tileOrigin.x, -tileOrigin.y).scaled(scale));
            replayFragment(graphics, {content, {}}, focused, focusedInputOps, 1.0f);
        } catch (...) {
            restore();
            throw;
        }
        restore();
        return image;
    }

    void JuceDrawOpsPainter::repaintScrollTile(ScrollTileCache::Tile& tile, arrange::core::Point tileOrigin, float scale, const std::shared_ptr<const arrange::core::PaintFragment>& content, arrange::core::ModifierHandle focused, std::span<const arrange::core::DrawOp> focusedInputOps) const {
        const auto savedTransform = transform_;
        auto savedStack = std::move(transformStack_);
        transformStack_.clear();
        transform_ = {};
        inTile_ = true;
        const auto restore = [&] {
            inTile_ = false;
            transform_ = savedTransform;
            transformStack_ = std::move(savedStack);
        };
        try {
            ::juce::Graphics graphics(tile.image);
            for (const auto& rect : tile.dirty) {
                // 标脏范围换算为图块像素并向外取整，在像素空间里清除、裁剪，再按图块的变换重放
                const auto left = static_cast<int>(std::floor((rect.getX() - tileOrigin.x) * scale)), top = static_cast<int>(std::floor((rect.getY() - tileOrigin.y) * scale));
                const auto right = static_cast<int>(std::ceil((rect.getRight() - tileOrigin.x) * scale)), bottom = static_cast<int>(std::ceil((rect.getBottom() - tileOrigin.y) * scale));
                const auto pixels = ::juce::Rectangle<int>::leftTopRightBottom(left, top, right, bottom).getIntersection({0, 0, ScrollTileCache::tilePixels, ScrollTileCache::tilePixels});
                if (pixels.isEmpty()) continue;
                ::juce::Graphics::ScopedSaveState scope(graphics);
                graphics.reduceClipRegion(pixels);
                graphics.setColour(::juce::Colours::transparentBlack);
                graphics.getInternalContext().fillRect(pixels, true);
                graphics.addTransform(::juce::AffineTransform::translation(-tileOrigin.x, -tileOrigin.y).scaled(scale));
                replayFragment(graphics, {content, {}}, focused, focusedInputOps, 1.0f);
            }
        } catch (...) {
            restore();
            throw;
        }
        restore();
        tile.dirty.clear();
    }

    bool JuceDrawOpsPainter::replayScrollTiles(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& scrollLayer, const arrange::core::PlacedPaintFragment& child, arrange::core::ModifierHandle focused, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha) const {
        const auto& content = child.fragment;
        if (!scrollTilesEnabled_ || inTile_ || stopAt_ || !content) return false;
        auto& counters = scrollTiles_.mutableCounters();
        const auto direct = [&] {
            ++counters.layersDirect;
            return false;
        };
        // 图块是整层合成，只在与逐操作透明度等价、且只有平移的条件下使用
        if (alpha < 0.9999f) return direct();
        const auto& t = transform_;
        if (std::abs(t.mat00 - 1.0f) > 1e-4f || std::abs(t.mat11 - 1.0f) > 1e-4f || std::abs(t.mat01) > 1e-4f || std::abs(t.mat10) > 1e-4f) return direct();
        const auto& bounds = content->bounds;
        if (!bounds.known || !std::isfinite(bounds.rect.x) || !std::isfinite(bounds.rect.y) || !std::isfinite(bounds.rect.width) || !std::isfinite(bounds.rect.height)) return direct();
        if (bounds.empty) return true;

        auto& state = scrollTiles_.layer(scrollLayer.fragment->layer);
        const auto scale = std::clamp(g.getInternalContext().getPhysicalPixelScaleFactor(), 0.25f, 8.0f);
        if (state.scale != scale) {
            scrollTiles_.clear(state);
            state.content.reset();
            state.scale = scale;
        }
        const auto extent = static_cast<float>(ScrollTileCache::tilePixels) / scale;
        // 网格锚点取内容边界左上角并对齐物理像素；已有图块时保持不变，图块索引才有意义
        if (state.tiles.empty()) {
            state.gridX = std::floor(bounds.rect.x * scale) / scale;
            state.gridY = std::floor(bounds.rect.y * scale) / scale;
        }
        // 内容原点的设备位置吸附到物理像素：图块以整数像素对齐绘制，不重采样；吸附只作用于绘制
        // 设备位置按窗口坐标算：编辑器原点是逻辑整数位置，乘以缩放后可能落在半个像素上
        const auto originX = deviceOrigin_.x + t.getTranslationX() + child.offset.x, originY = deviceOrigin_.y + t.getTranslationY() + child.offset.y;
        const arrange::core::Point origin{child.offset.x + std::round(originX * scale) / scale - originX, child.offset.y + std::round(originY * scale) / scale - originY};
        const auto clip = g.getClipBounds().toFloat().expanded(1.0f).translated(-origin.x, -origin.y);
        const auto visible = clip.getIntersection(::juce::Rectangle<float>(bounds.rect.x, bounds.rect.y, bounds.rect.width, bounds.rect.height));

        const auto hadContent = state.content != nullptr;
        const auto changed = state.content != content;
        // 本次内容变化落在可见范围内的面积，用来判断内容是否在持续大面积变化
        auto changedArea = 0.0f;
        auto changedWhole = false;
        if (changed) {
            // 内容换新：比较新旧片段树，变化范围内的图块标脏、之后只局部重画；范围无法界定时全部失效
            if (hadContent && !state.tiles.empty()) {
                arrange::core::RepaintLimits limits;
                limits.maxCollectedRects = 256;
                arrange::core::RepaintDamage damage(limits);
                damage.compareScene({state.content, {}}, {content, {}});
                if (damage.full()) {
                    scrollTiles_.clear(state);
                    changedWhole = true;
                } else {
                    const auto tileArea = extent * extent;
                    for (const auto& rect : damage.collected()) {
                        const ::juce::Rectangle<float> area(rect.x - 1.0f, rect.y - 1.0f, rect.width + 2.0f, rect.height + 2.0f);
                        const auto inView = area.getIntersection(visible);
                        changedArea += inView.getWidth() * inView.getHeight();
                        const auto column0 = static_cast<int>(std::floor((area.getX() - state.gridX) / extent)), column1 = static_cast<int>(std::floor((area.getRight() - state.gridX) / extent));
                        const auto row0 = static_cast<int>(std::floor((area.getY() - state.gridY) / extent)), row1 = static_cast<int>(std::floor((area.getBottom() - state.gridY) / extent));
                        for (auto row = row0; row <= row1; ++row)
                            for (auto column = column0; column <= column1; ++column) {
                                const ::juce::Rectangle<float> tile(state.gridX + static_cast<float>(column) * extent, state.gridY + static_cast<float>(row) * extent, extent, extent);
                                scrollTiles_.markDirty(state, ScrollTileCache::pack(column, row), area.getIntersection(tile), tileArea);
                            }
                    }
                }
            } else if (!state.tiles.empty()) {
                scrollTiles_.clear(state);
            }
            state.hasBackdrop = false;
            state.hasInput = false;
            scanTraits(*content, state.hasBackdrop, state.hasInput);
            state.content = content;
        }
        if (state.hasBackdrop) return direct();
        if (state.hasInput && focused.valid() && containsFocusedInput(*content, focused)) return direct();
        if (visible.isEmpty()) return true;
        const auto column0 = static_cast<int>(std::floor((visible.getX() - state.gridX) / extent)), column1 = static_cast<int>(std::ceil((visible.getRight() - state.gridX) / extent)) - 1;
        const auto row0 = static_cast<int>(std::floor((visible.getY() - state.gridY) / extent)), row1 = static_cast<int>(std::ceil((visible.getBottom() - state.gridY) / extent)) - 1;
        const auto count = static_cast<std::size_t>(column1 - column0 + 1) * static_cast<std::size_t>(row1 - row0 + 1);
        if (count * ScrollTileCache::tileBytes > scrollTiles_.budget()) return direct();
        // 内容在持续大面积变化时图块得不偿失：连续三次绘制，内容变化都覆盖了可见范围的一半以上，就改为直接绘制
        // 只看内容变化的面积，滚动新进入的图块不算；内容一旦稳定或变化变小就恢复
        const auto heavy = changed && hadContent && (changedWhole || changedArea * 2.0f >= visible.getWidth() * visible.getHeight());
        state.churn = heavy ? state.churn + 1 : 0;
        if (state.churn >= 3) {
            ++counters.demotions;
            return direct();
        }

        ::juce::Graphics::ScopedSaveState scope(g);
        g.setOpacity(1.0f);
        // 图块与设备像素一一对应，最近邻采样：万一偏离整数像素也只是平移不到半个像素，不会模糊
        g.setImageResamplingQuality(::juce::Graphics::lowResamplingQuality);
        for (auto row = row0; row <= row1; ++row)
            for (auto column = column0; column <= column1; ++column) {
                const auto key = ScrollTileCache::pack(column, row);
                auto found = state.tiles.find(key);
                if (found == state.tiles.end()) {
                    auto image = buildScrollTile(content, {state.gridX + static_cast<float>(column) * extent, state.gridY + static_cast<float>(row) * extent}, scale, focused, focusedInputOps);
                    found = state.tiles.emplace(key, ScrollTileCache::Tile{std::move(image), 0}).first;
                    scrollTiles_.added();
                } else if (!found->second.dirty.empty()) {
                    // 图块里只有一小块内容变了：清掉那一块并只重放它，不整块重建
                    repaintScrollTile(found->second, {state.gridX + static_cast<float>(column) * extent, state.gridY + static_cast<float>(row) * extent}, scale, content, focused, focusedInputOps);
                    ++counters.tilesRepainted;
                } else
                    ++counters.tileHits;
                found->second.used = scrollTiles_.touch();
                g.drawImage(found->second.image, ::juce::Rectangle<float>(origin.x + state.gridX + static_cast<float>(column) * extent, origin.y + state.gridY + static_cast<float>(row) * extent, extent, extent), ::juce::RectanglePlacement::stretchToFit);
            }
        ++counters.layersTiled;
        scrollTiles_.trim();
        return true;
    }

    ::juce::Image JuceDrawOpsPainter::captureBackdrop(const arrange::core::PlacedPaintFragment& target, ::juce::Rectangle<float> area, float scale, int width, int height) const {
        ::juce::Image result(::juce::Image::ARGB, width, height, true, ::juce::SoftwareImageType());
        const auto inverse = transform_.inverted();
        const auto savedTransform = transform_;
        auto savedStack = std::move(transformStack_);
        const auto savedStop = stopAt_;
        const auto savedStopped = stopped_;
        const auto savedCounters = counters_;
        const auto restore = [&] {
            transform_ = savedTransform;
            transformStack_ = std::move(savedStack);
            stopAt_ = savedStop;
            stopped_ = savedStopped;
            counters_ = savedCounters;
        };
        transform_ = {};
        transformStack_.clear();
        stopAt_ = &target;
        stopped_ = false;
        try {
            ::juce::Graphics graphics(result);
            // 根坐标先回到目标层局部，再映射到离屏位图
            graphics.addTransform(inverse.followedBy(::juce::AffineTransform::translation(-area.getX(), -area.getY()).scaled(scale)));
            replayFragment(graphics, *root_, focused_, focusedOps_, 1.0f);
        } catch (...) {
            restore();
            throw;
        }
        restore();
        return result;
    }

    void JuceDrawOpsPainter::replayOps(::juce::Graphics& g, std::span<const arrange::core::DrawOp> ops, arrange::core::ModifierHandle focusedInputModifier, std::span<const arrange::core::DrawOp> focusedInputOps, float alpha, int& graphicsStateDepth) const {
        for (const auto& op : ops) {
            if (stopped_) return;
            ++counters_.opsVisited;
            const auto state = op.type == arrange::core::DrawOpType::PushClip || op.type == arrange::core::DrawOpType::PopClip || op.type == arrange::core::DrawOpType::PushTransform || op.type == arrange::core::DrawOpType::PopTransform;
            if (!state && invisible(g, arrange::core::drawOpBounds(op))) {
                ++counters_.opsSkipped;
                continue;
            }
            const auto rect = ::juce::Rectangle<float>(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
            switch (op.type) {
                case arrange::core::DrawOpType::ContentMarker:
                    throw std::logic_error("内容标记必须通过共享绘制片段重放");
                case arrange::core::DrawOpType::FillRect:
                    if (!op.gradient && op.shape == arrange::core::DrawShapeType::Rectangle) {
                        g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
                        g.fillRect(rect);
                    } else
                        fillWithPaint(g, shapePath(op, rect), op, rect, alpha);
                    break;
                case arrange::core::DrawOpType::StrokeRect: {
                    ::juce::Path outline;
                    if (op.shape == arrange::core::DrawShapeType::Rectangle) {
                        // 矩形描边向内，与 JUCE drawRect 一致
                        outline.setUsingNonZeroWinding(false);
                        outline.addRectangle(rect);
                        outline.addRectangle(rect.reduced(std::min(op.strokeWidth, std::min(rect.getWidth(), rect.getHeight()) * 0.5f)));
                    } else
                        ::juce::PathStrokeType(op.strokeWidth).createStrokedPath(outline, shapePath(op, rect));
                    fillWithPaint(g, outline, op, rect, alpha);
                    break;
                }
                case arrange::core::DrawOpType::DrawPath: {
                    if (!op.path) break;
                    const auto path = pathOf(op);
                    if (op.strokeWidth > 0) {
                        ::juce::Path outline;
                        strokeType(op).createStrokedPath(outline, path);
                        fillWithPaint(g, outline, op, rect, alpha);
                    } else
                        fillWithPaint(g, path, op, rect, alpha);
                    break;
                }
                case arrange::core::DrawOpType::DrawText:
                    if (op.inputText && focusedInputModifier.valid() && op.textField == focusedInputModifier) {
                        ::juce::Graphics::ScopedSaveState scope(g);
                        g.addTransform(::juce::AffineTransform::translation(op.rect.x, op.rect.y));
                        replayScopedOps(g, focusedInputOps, {}, {}, alpha * op.inputAlpha);
                    } else
                        drawText(g, op, 0.0f, alpha);
                    break;
                case arrange::core::DrawOpType::DrawPainter:
                    drawPainter(g, op, rect, alpha);
                    break;
                case arrange::core::DrawOpType::DrawNative: {
                    const auto* paint = op.native ? static_cast<const NativePaint*>(op.native->implementation.get()) : nullptr;
                    if (!paint || !*paint || rect.isEmpty()) break;
                    // 原生 painter 只能画在目标矩形内，透明度经图层合成
                    ::juce::Graphics::ScopedSaveState scope(g);
                    g.reduceClipRegion(rect.getSmallestIntegerContainer());
                    if (alpha < 1.0f) g.beginTransparencyLayer(std::clamp(alpha, 0.0f, 1.0f));
                    static const arrange::core::NativePainterParams empty;
                    try {
                        (*paint)(g, rect, op.nativeParams ? *op.nativeParams : empty);
                    } catch (...) {
                        if (alpha < 1.0f) g.endTransparencyLayer();
                        throw;
                    }
                    if (alpha < 1.0f) g.endTransparencyLayer();
                    break;
                }
                case arrange::core::DrawOpType::DrawLine: {
                    const ::juce::Line<float> line(rect.getX(), rect.getY(), op.lineEnd.x, op.lineEnd.y);
                    const auto width = op.strokeWidth > 0 ? op.strokeWidth : 1.0f;
                    if (!op.gradient) {
                        g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
                        g.drawLine(line, width);
                    } else {
                        // 线段的渐变参照两端点的外包盒
                        ::juce::Path path;
                        path.addLineSegment(line, width);
                        fillWithPaint(g, path, op, {line.getStart(), line.getEnd()}, alpha);
                    }
                    break;
                }
                case arrange::core::DrawOpType::PushClip:
                    g.saveState();
                    transformStack_.push_back(transform_);
                    ++graphicsStateDepth;
                    if (op.shape == arrange::core::DrawShapeType::Rectangle)
                        g.reduceClipRegion(rect.toNearestInt());
                    else
                        g.reduceClipRegion(shapePath(op, rect));
                    break;
                case arrange::core::DrawOpType::PopClip:
                    if (graphicsStateDepth > 1) {
                        g.restoreState();
                        --graphicsStateDepth;
                        if (!transformStack_.empty()) {
                            transform_ = transformStack_.back();
                            transformStack_.pop_back();
                        }
                    }
                    break;
                case arrange::core::DrawOpType::PushTransform: {
                    g.saveState();
                    transformStack_.push_back(transform_);
                    ++graphicsStateDepth;
                    const auto pivotX = rect.getX() + rect.getWidth() * op.transformOriginX;
                    const auto pivotY = rect.getY() + rect.getHeight() * op.transformOriginY;
                    const auto radians = op.rotationZ * ::juce::MathConstants<float>::pi / 180.0f;
                    const auto transform = ::juce::AffineTransform::translation(-pivotX, -pivotY).scaled(op.scaleX, op.scaleY).rotated(radians).translated(pivotX + op.translationX, pivotY + op.translationY);
                    if (transform.isSingularity())
                        g.reduceClipRegion(::juce::Rectangle<int>{});
                    else {
                        g.addTransform(transform);
                        transform_ = transform.followedBy(transform_);
                    }
                    break;
                }
                case arrange::core::DrawOpType::PopTransform:
                    if (graphicsStateDepth > 1) {
                        g.restoreState();
                        --graphicsStateDepth;
                        if (!transformStack_.empty()) {
                            transform_ = transformStack_.back();
                            transformStack_.pop_back();
                        }
                    }
                    break;
            }
        }
    }
}

#endif
