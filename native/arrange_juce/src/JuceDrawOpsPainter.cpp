#include <arrange/juce/JuceDrawOpsPainter.h>

#if ARRANGE_JUCE_WITH_JUCE

#include <arrange/juce/ImageResourceCache.h>

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

        ::juce::Rectangle<float> imageFillAxisTarget(const ::juce::Image& image, ::juce::Rectangle<float> target, const std::string& contentScale, const std::string& alignment) {
            const auto imageWidth = static_cast<float>(image.getWidth());
            const auto imageHeight = static_cast<float>(image.getHeight());
            if (imageWidth <= 0.0f || imageHeight <= 0.0f || target.isEmpty()) return target;

            const auto scale = contentScale == "FillHeight" ? target.getHeight() / imageHeight : target.getWidth() / imageWidth;
            const auto width = imageWidth * scale;
            const auto height = imageHeight * scale;
            const auto x = target.getX() + (target.getWidth() - width) * imageHorizontalAlignment(alignment);
            const auto y = target.getY() + (target.getHeight() - height) * imageVerticalAlignment(alignment);
            return {x, y, width, height};
        }

        void drawImageOp(::juce::Graphics& g, const ::juce::Image& image, ::juce::Rectangle<float> rect, const arrange::core::DrawOp& op) {
            const auto fillAlphaWithTint = op.hasTint;
            if (fillAlphaWithTint) { g.setColour(::juce::Colour(op.color)); }
            else { g.setOpacity(static_cast<float>((op.color >> 24u) & 0xffu) / 255.0f); }

            if (op.contentScale == "FillWidth" || op.contentScale == "FillHeight") {
                g.saveState();
                g.reduceClipRegion(rect.toNearestInt());
                g.drawImage(image, imageFillAxisTarget(image, rect, op.contentScale, op.alignment), ::juce::RectanglePlacement::stretchToFit, fillAlphaWithTint);
                g.restoreState();
            }
            else {
                const auto target = rect.toNearestInt();
                g.drawImageWithin(image, target.getX(), target.getY(), target.getWidth(), target.getHeight(), imagePlacementFlags(op.contentScale, op.alignment), fillAlphaWithTint);
            }

            if (!fillAlphaWithTint) g.setOpacity(1.0f);
        }


        ::juce::Justification textLayoutJustification(const std::string& align) {
            if (align == "center" || align == "Center") return ::juce::Justification::horizontallyCentred | ::juce::Justification::top;
            if (align == "right" || align == "end" || align == "End") return ::juce::Justification::topRight;
            return ::juce::Justification::topLeft;
        }

        class JuceTextLayoutEngine {
        public:
            void drawText(::juce::Graphics& g, const arrange::core::DrawOp& op, float horizontalViewportOffset = 0.0f) const {
                const auto area = ::juce::Rectangle<float>(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
                if (area.isEmpty() || op.text.empty()) return;

                g.saveState();
                g.reduceClipRegion((op.inputText ? area : area.expanded(2.0f, 2.0f)).toNearestInt());
                const auto font = ::juce::Font(::juce::FontOptions(op.fontSize));
                const auto colour = ::juce::Colour(op.color);
                const auto lineHeight = op.lineHeight > 0.0f ? op.lineHeight : font.getHeight();
                if (op.maxLines == 1) { drawSingleLine(g, op.text, area, font, colour, op.textAlign, op.overflow, horizontalViewportOffset, lineHeight); }
                else { drawLayout(g, op.text, area, font, colour, op.textAlign, op.maxLines, lineHeight); }
                g.restoreState();
            }

        private:
            void drawSingleLine(
                ::juce::Graphics& g,
                const std::string& text,
                ::juce::Rectangle<float> area,
                const ::juce::Font& font,
                ::juce::Colour colour,
                const std::string& align,
                const std::string& overflow,
                float horizontalViewportOffset,
                float lineHeight) const {
                ::juce::GlyphArrangement glyphs;
                const auto juceText = ::juce::String::fromUTF8(text.data(), static_cast<int>(text.size()));
                const auto baseline = area.getY() + std::max(0.0f, (lineHeight - font.getHeight()) * 0.5f) + font.getAscent();
                const auto textX = area.getX() - std::max(0.0f, horizontalViewportOffset);
                if (overflow == "ellipsis" && horizontalViewportOffset <= 0.0f) { glyphs.addCurtailedLineOfText(font, juceText, textX, baseline, area.getWidth(), true); }
                else { glyphs.addLineOfText(font, juceText, textX, baseline); }

                if (horizontalViewportOffset <= 0.0f && glyphs.getNumGlyphs() > 0) {
                    const auto bounds = glyphs.getBoundingBox(0, glyphs.getNumGlyphs(), true);
                    float dx = 0.0f;
                    if (align == "center" || align == "Center") dx = area.getX() + (area.getWidth() - bounds.getWidth()) * 0.5f - bounds.getX();
                    if (align == "right" || align == "end" || align == "End") dx = area.getRight() - bounds.getRight();
                    if (std::fabs(dx) > 0.0001f) glyphs.moveRangeOfGlyphs(0, glyphs.getNumGlyphs(), dx, 0.0f);
                }

                g.setColour(colour);
                glyphs.draw(g);
            }

            void drawLayout(
                ::juce::Graphics& g,
                const std::string& text,
                ::juce::Rectangle<float> area,
                const ::juce::Font& font,
                ::juce::Colour colour,
                const std::string& align,
                int maxLines,
                float lineHeight) const {
                ::juce::AttributedString attributed;
                attributed.append(::juce::String::fromUTF8(text.data(), static_cast<int>(text.size())), font, colour);
                attributed.setJustification(textLayoutJustification(align));
                attributed.setWordWrap(::juce::AttributedString::byWord);
                attributed.setLineSpacing(std::max(0.0f, lineHeight - font.getHeight()));

                ::juce::TextLayout layout;
                const auto maxHeight = maxLines > 0 ? std::min(area.getHeight(), lineHeight * static_cast<float>(maxLines)) : area.getHeight();
                layout.createLayout(attributed, std::max(1.0f, area.getWidth()), std::max(1.0f, maxHeight));
                layout.draw(g, area);
            }
        };
    } // namespace

    void JuceDrawOpsPainter::drawText(::juce::Graphics& g, const arrange::core::DrawOp& op, float horizontalViewportOffset) const { JuceTextLayoutEngine{}.drawText(g, op, horizontalViewportOffset); }

    JuceDrawOpsPainter::PaintResult JuceDrawOpsPainter::paint(
        ::juce::Graphics& g,
        const std::vector<arrange::core::DrawOp>& ops,
        ImageResourceCache& imageResources,
        std::optional<arrange::core::NodeId> focusedInputNode,
        float focusedInputViewportX) const {
        g.saveState();
        int graphicsStateDepth = 1;
        const auto restoreGraphicsState = [&]() {
            while (graphicsStateDepth > 0) {
                g.restoreState();
                --graphicsStateDepth;
            }
        };

        for (const auto& op : ops) {
            const auto rect = ::juce::Rectangle<float>(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
            switch (op.type) {
            case arrange::core::DrawOpType::FillRect:
                g.setColour(::juce::Colour(op.color));
                if (op.shape == arrange::core::DrawShapeType::Circle) { g.fillEllipse(rect); }
                else if (op.shape == arrange::core::DrawShapeType::Rounded) { g.fillRoundedRectangle(rect, op.cornerRadius); }
                else { g.fillRect(rect); }
                break;
            case arrange::core::DrawOpType::StrokeRect:
                g.setColour(::juce::Colour(op.color));
                if (op.shape == arrange::core::DrawShapeType::Circle) { g.drawEllipse(rect, op.strokeWidth); }
                else if (op.shape == arrange::core::DrawShapeType::Rounded) { g.drawRoundedRectangle(rect, op.cornerRadius, op.strokeWidth); }
                else { g.drawRect(rect, op.strokeWidth); }
                break;
            case arrange::core::DrawOpType::DrawText:
                drawText(g, op, op.inputText && focusedInputNode && op.nodeId == *focusedInputNode ? focusedInputViewportX : 0.0f);
                break;
            case arrange::core::DrawOpType::DrawImage:
                if (const auto image = imageResources.load(op.resource); image.isValid()) { drawImageOp(g, image, rect, op); }
                else {
                    if (imageResources.lastError()) {
                        restoreGraphicsState();
                        return {*imageResources.lastError()};
                    }
                    g.setColour(::juce::Colour(0xff151922));
                    g.fillRect(rect);
                    g.setColour(::juce::Colour(op.color).withAlpha(0.42f));
                    g.drawRect(rect, 1.0f);
                    g.drawLine(rect.getX(), rect.getBottom(), rect.getRight(), rect.getY(), 1.0f);
                }
                break;
            case arrange::core::DrawOpType::DrawIcon: {
                g.setColour(::juce::Colour(op.color));
                const auto r = rect.reduced(rect.getWidth() * 0.18f, rect.getHeight() * 0.18f);
                ::juce::Path path;
                path.startNewSubPath(r.getX(), r.getY());
                path.lineTo(r.getRight(), r.getCentreY());
                path.lineTo(r.getX(), r.getBottom());
                path.closeSubPath();
                g.fillPath(path);
                break;
            }
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
                                       .translated(pivotX, pivotY);
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

        restoreGraphicsState();
        return {};
    }
} // namespace arrange::juce

#endif
