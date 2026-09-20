#include <arrange/juce/JuceDrawOpsPainter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/PainterResources.h>
#include <arrange/juce/JuceTextServices.h>
#include <stdexcept>
#include <chrono>

#include <algorithm>
#include <cmath>
#include <string>

namespace arrange::juce {
    namespace {
        int imageAlignmentFlags(const std::string& alignment) {
            int flags = 0;
            if (alignment == "TopStart" || alignment == "CenterStart" || alignment == "BottomStart" || alignment == "Start") { flags |= ::juce::RectanglePlacement::xLeft; }
            else if (alignment == "TopEnd" || alignment == "CenterEnd" || alignment == "BottomEnd" || alignment == "End") { flags |= ::juce::RectanglePlacement::xRight; }
            else { flags |= ::juce::RectanglePlacement::xMid; }

            if (alignment == "TopStart" || alignment == "TopCenter" || alignment == "TopEnd" || alignment == "Top") { flags |= ::juce::RectanglePlacement::yTop; }
            else if (alignment == "BottomStart" || alignment == "BottomCenter" || alignment == "BottomEnd" || alignment == "Bottom") { flags |= ::juce::RectanglePlacement::yBottom; }
            else { flags |= ::juce::RectanglePlacement::yMid; }
            return flags;
        }

        int imagePlacementFlags(const std::string& contentScale, const std::string& alignment) {
            const auto align = imageAlignmentFlags(alignment);
            if (contentScale == "FillBounds") return ::juce::RectanglePlacement::stretchToFit;
            if (contentScale == "Crop") return align | ::juce::RectanglePlacement::fillDestination;
            if (contentScale == "Inside") return align | ::juce::RectanglePlacement::onlyReduceInSize;
            if (contentScale == "None") return align | ::juce::RectanglePlacement::doNotResize;
            return align;
        }

        float imageHorizontalAlignment(const std::string& alignment) {
            if (alignment == "TopStart" || alignment == "CenterStart" || alignment == "BottomStart" || alignment == "Start") return 0.0f;
            if (alignment == "TopEnd" || alignment == "CenterEnd" || alignment == "BottomEnd" || alignment == "End") return 1.0f;
            return 0.5f;
        }

        float imageVerticalAlignment(const std::string& alignment) {
            if (alignment == "TopStart" || alignment == "TopCenter" || alignment == "TopEnd" || alignment == "Top") return 0.0f;
            if (alignment == "BottomStart" || alignment == "BottomCenter" || alignment == "BottomEnd" || alignment == "Bottom") return 1.0f;
            return 0.5f;
        }

        ::juce::Rectangle<float> imageFillAxisTarget(float imageWidth, float imageHeight, ::juce::Rectangle<float> target, const std::string& contentScale, const std::string& alignment) {
            if (imageWidth <= 0.0f || imageHeight <= 0.0f || target.isEmpty()) return target;

            const auto scale = contentScale == "FillHeight" ? target.getHeight() / imageHeight : target.getWidth() / imageWidth;
            const auto width = imageWidth * scale;
            const auto height = imageHeight * scale;
            const auto x = target.getX() + (target.getWidth() - width) * imageHorizontalAlignment(alignment);
            const auto y = target.getY() + (target.getHeight() - height) * imageVerticalAlignment(alignment);
            return {x, y, width, height};
        }

        void drawImageOp(::juce::Graphics& g, const ::juce::Image& image, ::juce::Rectangle<float> rect, const arrange::core::DrawOp& op, float alpha) {
            ::juce::Graphics::ScopedSaveState scope(g);
            g.reduceClipRegion(rect.toNearestInt());
            const auto fillAlphaWithTint = op.hasTint;
            if (fillAlphaWithTint) { g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha)); }
            else { g.setOpacity(static_cast<float>((op.color >> 24u) & 0xffu) / 255.0f * alpha); }

            if (op.contentScale == "FillWidth" || op.contentScale == "FillHeight") {
                g.saveState();
                g.reduceClipRegion(rect.toNearestInt());
                g.drawImage(image, imageFillAxisTarget(static_cast<float>(image.getWidth()), static_cast<float>(image.getHeight()), rect, op.contentScale, op.alignment), ::juce::RectanglePlacement::stretchToFit, fillAlphaWithTint);
                g.restoreState();
            }
            else {
                const auto target = rect.toNearestInt();
                g.drawImageWithin(image, target.getX(), target.getY(), target.getWidth(), target.getHeight(), imagePlacementFlags(op.contentScale, op.alignment), fillAlphaWithTint);
            }

            if (!fillAlphaWithTint) g.setOpacity(1.0f);
        }

        void drawVector(::juce::Graphics& graphics, const JucePainterContent& content, ::juce::Rectangle<float> target, const arrange::core::DrawOp& op, float alpha) {
            ::juce::Graphics::ScopedSaveState scope(graphics);
            graphics.reduceClipRegion(target.toNearestInt());
            const auto bounds = content.vectorViewport.isEmpty() ? content.vector->getDrawableBounds() : content.vectorViewport;
            auto placement = imagePlacementFlags(op.contentScale, op.alignment);
            if (op.contentScale == "FillWidth" || op.contentScale == "FillHeight") {
                target = imageFillAxisTarget(bounds.getWidth(), bounds.getHeight(), target, op.contentScale, op.alignment);
                placement = ::juce::RectanglePlacement::stretchToFit;
            }
            content.vector->draw(graphics, alpha, ::juce::RectanglePlacement(placement).getTransformToFit(bounds, target));
        }


    } // namespace

    void JuceDrawOpsPainter::drawText(::juce::Graphics& g, const arrange::core::DrawOp& op, float horizontalViewportOffset, float alpha) const {
        if (!op.textLayout) throw std::logic_error("发布的文字缺少排版资源");
        const auto* resource = dynamic_cast<const JuceTextResource*>(op.textLayout->resource.get());
        if (!resource) throw std::logic_error("发布的文字不是 JUCE 绘制资源");
        ::juce::Graphics::ScopedSaveState scope(g);
        if (op.inputText || op.overflow == "clip" || op.overflow == "ellipsis") g.reduceClipRegion(::juce::Rectangle<float>(op.rect.x, op.rect.y, op.rect.width, op.rect.height).getSmallestIntegerContainer());
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

    JuceDrawOpsPainter::PaintResult JuceDrawOpsPainter::paint(::juce::Graphics& g, const std::vector<arrange::core::DrawOp>& ops, arrange::core::ModifierHandle focused, float viewportX) const {
        g.saveState();
        int depth = 1;
        try { replayOps(g, ops, focused, viewportX, 1, depth); }
        catch (...) { while (depth-- > 0) g.restoreState(); throw; }
        while (depth-- > 0) g.restoreState();
        return {};
    }

    JuceDrawOpsPainter::PaintResult JuceDrawOpsPainter::paint(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& root, arrange::core::ModifierHandle focused, float viewportX) const {
        replayFragment(g, root, focused, viewportX, 1);
        return {};
    }

    void JuceDrawOpsPainter::replayFragment(::juce::Graphics& g, const arrange::core::PlacedPaintFragment& placed, arrange::core::ModifierHandle focused, float viewportX, float alpha) const {
        if (!placed.fragment) return;
        ++counters_.fragmentsVisited;
        ::juce::Graphics::ScopedSaveState scope(g);
        g.addTransform(::juce::AffineTransform::translation(placed.offset.x, placed.offset.y));
        const auto& fragment = *placed.fragment;
        if (invisible(g, fragment.bounds)) { ++counters_.fragmentsSkipped; return; }
        g.saveState();
        int depth = 1;
        try {
            if (fragment.layer) replayOps(g, fragment.layer->before, focused, viewportX, alpha, depth);
            const auto contentAlpha = alpha * (fragment.layer ? fragment.layer->contentAlpha : 1.0f);
            if (fragment.content) replayOps(g, *fragment.content, focused, viewportX, contentAlpha, depth);
            for (const auto& child : fragment.children) replayFragment(g, child, focused, viewportX, contentAlpha);
            if (fragment.layer) replayOps(g, fragment.layer->after, focused, viewportX, alpha, depth);
        }
        catch (...) { while (depth-- > 0) g.restoreState(); throw; }
        while (depth-- > 0) g.restoreState();
    }

    void JuceDrawOpsPainter::replayOps(::juce::Graphics& g, const std::vector<arrange::core::DrawOp>& ops, arrange::core::ModifierHandle focusedInputModifier, float focusedInputViewportX, float alpha, int& graphicsStateDepth) const {
        for (const auto& op : ops) {
            ++counters_.opsVisited;
            const auto state = op.type == arrange::core::DrawOpType::PushClip || op.type == arrange::core::DrawOpType::PopClip || op.type == arrange::core::DrawOpType::PushTransform || op.type == arrange::core::DrawOpType::PopTransform;
            if (!state && invisible(g, arrange::core::drawOpBounds(op))) { ++counters_.opsSkipped; continue; }
            const auto rect = ::juce::Rectangle<float>(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
            switch (op.type) {
            case arrange::core::DrawOpType::FillRect:
                g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
                if (op.shape == arrange::core::DrawShapeType::Circle) { g.fillEllipse(rect); }
                else if (op.shape == arrange::core::DrawShapeType::Rounded) { g.fillRoundedRectangle(rect, op.cornerRadius); }
                else { g.fillRect(rect); }
                break;
            case arrange::core::DrawOpType::StrokeRect:
                g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
                if (op.shape == arrange::core::DrawShapeType::Circle) { g.drawEllipse(rect, op.strokeWidth); }
                else if (op.shape == arrange::core::DrawShapeType::Rounded) { g.drawRoundedRectangle(rect, op.cornerRadius, op.strokeWidth); }
                else { g.drawRect(rect, op.strokeWidth); }
                break;
            case arrange::core::DrawOpType::DrawText:
                if (!op.inputText || !focusedInputModifier.valid() || op.textField != focusedInputModifier) drawText(g, op, 0.0f, alpha);
                break;
            case arrange::core::DrawOpType::DrawPainter: {
                const auto* content = dynamic_cast<const JucePainterContent*>(op.painter.content.get());
                if (!content) throw std::runtime_error("Painter 绘制内容不属于 JUCE 受体");
                if (content->image.isValid()) drawImageOp(g, content->image, rect, op, alpha);
                else if (content->vector && !rect.isEmpty()) {
                    if (op.hasTint) {
                        ::juce::Image mask(::juce::Image::ARGB, std::max(1, static_cast<int>(std::ceil(rect.getWidth()))), std::max(1, static_cast<int>(std::ceil(rect.getHeight()))), true);
                        {
                            ::juce::Graphics graphics(mask);
                            drawVector(graphics, *content, mask.getBounds().toFloat(), op, 1.0f);
                        }
                        g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
                        g.drawImage(mask, rect, ::juce::RectanglePlacement::stretchToFit, true);
                    } else {
                        drawVector(g, *content, rect, op, static_cast<float>((op.color >> 24u) & 0xffu) / 255.0f * alpha);
                    }
                }
                break;
            }
            case arrange::core::DrawOpType::DrawLine:
                g.setColour(::juce::Colour(op.color).withMultipliedAlpha(alpha));
                g.drawLine(
                    rect.getX(),
                    rect.getY(),
                    op.lineEnd.x,
                    op.lineEnd.y,
                    std::max(1.0f, op.strokeWidth));
                break;
            case arrange::core::DrawOpType::PushClip:
                g.saveState();
                ++graphicsStateDepth;
                if (op.shape == arrange::core::DrawShapeType::Circle) {
                    ::juce::Path clipPath;
                    clipPath.addEllipse(rect);
                    g.reduceClipRegion(clipPath);
                }
                else if (op.shape == arrange::core::DrawShapeType::Rounded) {
                    ::juce::Path clipPath;
                    clipPath.addRoundedRectangle(rect, op.cornerRadius);
                    g.reduceClipRegion(clipPath);
                }
                else { g.reduceClipRegion(rect.toNearestInt()); }
                break;
            case arrange::core::DrawOpType::PopClip:
                if (graphicsStateDepth > 1) {
                    g.restoreState();
                    --graphicsStateDepth;
                }
                break;
            case arrange::core::DrawOpType::PushTransform: {
                g.saveState();
                ++graphicsStateDepth;
                const auto pivotX = rect.getX() + rect.getWidth() * op.transformOriginX;
                const auto pivotY = rect.getY() + rect.getHeight() * op.transformOriginY;
                const auto radians = op.rotationZ * ::juce::MathConstants<float>::pi / 180.0f;
                const auto transform = ::juce::AffineTransform::translation(-pivotX, -pivotY)
                                       .scaled(op.scaleX, op.scaleY)
                                       .rotated(radians)
                                       .translated(pivotX + op.translationX, pivotY + op.translationY);
                g.addTransform(transform);
                break;
            }
            case arrange::core::DrawOpType::PopTransform:
                if (graphicsStateDepth > 1) {
                    g.restoreState();
                    --graphicsStateDepth;
                }
                break;
            }
        }


    }
} // namespace arrange::juce

#endif
