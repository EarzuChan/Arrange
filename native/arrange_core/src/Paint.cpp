#include <arrange/core/ModifierGeometry.h>
#include <arrange/core/Paint.h>
#include <arrange/core/Modifier.h>
#include <arrange/core/PropValue.h>

#include <algorithm>
#include <cstdlib>
#include <cmath>
#include <string>
#include <string_view>
#include <utility>

namespace arrange::core {
    namespace {
        std::string inputValue(const ArrangeNode& node) {
            if (const auto* value = propValue(node, "modelValue", "model-value")) return value->stringOr();
            if (const auto* value = propValue(node, "value")) return value->stringOr();
            return {};
        }

        std::string inputPlaceholder(const ArrangeNode& node) {
            if (const auto* value = propValue(node, "placeholder")) return value->stringOr();
            return {};
        }

        std::string resourceProp(const ArrangeNode& node) {
            const auto resourceFrom = [](const PropValue* value) -> std::string {
                if (value == nullptr) return {};
                if (value->isString()) return value->string;
                if (value->isObject()) {
                    if (const auto* path = value->field("path"); path != nullptr && path->isString()) return path->string;
                    if (const auto* url = value->field("url"); url != nullptr && url->isString()) return url->string;
                }
                return {};
            };
            if (auto resource = resourceFrom(propValue(node, "source")); !resource.empty()) return resource;
            if (auto resource = resourceFrom(propValue(node, "src")); !resource.empty()) return resource;
            return {};
        }

        float numericProp(const ArrangeNode& node, const char* key, float fallback) { return numberProp(node, key, fallback); }

        std::string textProp(const ArrangeNode& node, const char* key, const char* fallback = "") { return stringProp(node, key, fallback); }

        std::string textProp(const ArrangeNode& node, const char* camelCase, const char* kebabCase, const char* fallback) { return stringProp(node, camelCase, kebabCase, fallback); }

        bool hasProp(const ArrangeNode& node, const char* key) { return node.props.find(key) != node.props.end(); }

        bool hasColorUnspecified(const ArrangeNode& node, const char* key) {
            const auto* value = propValue(node, key);
            return value != nullptr && value->isString() && value->string == "Color.Unspecified";
        }

        float zIndexOf(const ArrangeNode& node) {
            return node.modifier.zIndex();
        }

        std::vector<NodeId> childrenInPaintOrder(const LayoutTree& tree, const ArrangeNode& node) {
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId left, NodeId right) { return zIndexOf(tree.node(left)) < zIndexOf(tree.node(right)); });
            return children;
        }

        std::uint32_t styleColor(const PaintStyleSemantics& style) {
            return style.color;
        }

        DrawShapeType shapeType(const PaintStyleSemantics& style) {
            if (style.shapeType == "circle") return DrawShapeType::Circle;
            if (style.shapeType == "rounded") return DrawShapeType::Rounded;
            return DrawShapeType::Rectangle;
        }




        std::uint32_t withAlpha(std::uint32_t color, float alpha) {
            const auto clamped = std::clamp(alpha, 0.0f, 1.0f);
            const auto sourceAlpha = static_cast<float>((color >> 24u) & 0xffu);
            const auto nextAlpha = static_cast<std::uint32_t>(std::clamp(sourceAlpha * clamped, 0.0f, 255.0f) + 0.5f);
            return (color & 0x00ffffffu) | (nextAlpha << 24u);
        }
    } // namespace

    void DrawOpsBuilder::prepareText(DrawOp& op, const TextLayoutService& service) {
        if (op.type != DrawOpType::DrawText) return;
        const auto width = op.inputText && op.maxLines == 1 ? 0.0f : op.rect.width;
        op.textLayout = service.layout(op.text, {op.fontSize, op.lineHeight}, {op.maxLines, width, op.maxLines == 1, op.overflow == "ellipsis"}, op.textLayout);
    }

    std::vector<DrawOp> DrawOpsBuilder::exportScene(const LayoutTree& tree, NodeId root) const {
        auto copy = tree;
        PaintWorkCounters counters;
        return exportDrawOps(build(copy, root, counters));
    }

    namespace {
        void translateOp(DrawOp& op, Point offset) {
            if (op.type == DrawOpType::PopClip || op.type == DrawOpType::PopTransform) return;
            op.rect.x += offset.x;
            op.rect.y += offset.y;
            if (op.type == DrawOpType::DrawLine) { op.lineEnd.x += offset.x; op.lineEnd.y += offset.y; }
        }

        PaintBounds translated(PaintBounds bounds, Point offset) {
            bounds.rect.x += offset.x;
            bounds.rect.y += offset.y;
            return bounds;
        }

        void includeBounds(PaintBounds& target, PaintBounds source) {
            target.known = target.known && source.known;
            if (source.empty) return;
            if (target.empty) { target.rect = source.rect; target.empty = false; return; }
            const auto right = std::max(target.rect.x + target.rect.width, source.rect.x + source.rect.width);
            const auto bottom = std::max(target.rect.y + target.rect.height, source.rect.y + source.rect.height);
            target.rect.x = std::min(target.rect.x, source.rect.x);
            target.rect.y = std::min(target.rect.y, source.rect.y);
            target.rect.width = right - target.rect.x;
            target.rect.height = bottom - target.rect.y;
        }

        PaintBounds transformBounds(PaintBounds bounds, const DrawOp& op) {
            if (!bounds.known || bounds.empty) return bounds;
            const auto px = op.rect.x + op.rect.width * op.transformOriginX;
            const auto py = op.rect.y + op.rect.height * op.transformOriginY;
            const auto radians = op.rotationZ * 3.14159265358979323846 / 180.0;
            PaintBounds result;
            for (const auto x : {bounds.rect.x, bounds.rect.x + bounds.rect.width}) for (const auto y : {bounds.rect.y, bounds.rect.y + bounds.rect.height}) {
                const auto sx = (x - px) * op.scaleX;
                const auto sy = (y - py) * op.scaleY;
                const auto tx = px + op.translationX + sx * std::cos(radians) - sy * std::sin(radians);
                const auto ty = py + op.translationY + sx * std::sin(radians) + sy * std::cos(radians);
                if (!std::isfinite(tx) || !std::isfinite(ty)) return {{}, false, false};
                includeBounds(result, {{static_cast<float>(tx), static_cast<float>(ty), 0, 0}, true, false});
            }
            return result;
        }

        std::shared_ptr<const PaintFragment> retainFragment(std::shared_ptr<const PaintFragment> previous, PaintFragment next, PaintWorkCounters& counters) {
            if (previous && previous->layer == next.layer && previous->content == next.content && previous->children == next.children) {
                ++counters.fragmentsReused;
                return previous;
            }
            for (const auto& child : next.children) includeBounds(next.bounds, translated(child.fragment->bounds, child.offset));
            if (next.content) for (const auto& op : *next.content) includeBounds(next.bounds, drawOpBounds(op));
            if (next.layer) {
                for (auto it = next.layer->before.rbegin(); it != next.layer->before.rend(); ++it) if (it->type == DrawOpType::PushTransform) next.bounds = transformBounds(next.bounds, *it);
                for (const auto& op : next.layer->before) includeBounds(next.bounds, drawOpBounds(op));
                for (const auto& op : next.layer->after) includeBounds(next.bounds, drawOpBounds(op));
            }
            if (next.content) for (const auto& op : *next.content) if (op.type == DrawOpType::DrawImage || op.type == DrawOpType::DrawIcon) next.hasExternalResources = true;
            for (const auto& child : next.children) next.hasExternalResources = next.hasExternalResources || child.fragment->hasExternalResources;
            ++counters.fragmentsBuilt;
            return std::make_shared<const PaintFragment>(std::move(next));
        }
    }

    PaintBounds drawOpBounds(const DrawOp& op) {
        if (op.type == DrawOpType::PushClip || op.type == DrawOpType::PopClip || op.type == DrawOpType::PushTransform || op.type == DrawOpType::PopTransform) return {};
        auto rect = op.rect;
        if (op.type == DrawOpType::DrawText) {
            if (op.inputText || op.overflow == "clip" || op.overflow == "ellipsis") return {rect, true, rect.width <= 0 || rect.height <= 0};
            if (!op.textLayout || !op.textLayout->boundsKnown) return {{}, false, false};
            rect = op.textLayout->inkBounds;
            float minShift = 0, maxShift = 0;
            for (const auto& line : op.textLayout->lines) {
                float shift = 0;
                if (op.textAlign == "center" || op.textAlign == "Center") shift = (op.rect.width - line.width) * 0.5f;
                else if (op.textAlign == "right" || op.textAlign == "end" || op.textAlign == "End") shift = op.rect.width - line.width;
                minShift = std::min(minShift, shift);
                maxShift = std::max(maxShift, shift);
            }
            rect.x += op.rect.x + minShift;
            rect.y += op.rect.y;
            rect.width += maxShift - minShift;
        }
        if (op.type == DrawOpType::DrawImage && (op.contentScale == "None" || op.contentScale == "Inside" || op.contentScale == "Crop")) return {{}, false, false};
        auto margin = 1.0f;
        if (op.type == DrawOpType::StrokeRect) margin += op.strokeWidth * 0.5f;
        if (op.type == DrawOpType::DrawLine) {
            rect = {std::min(op.rect.x, op.lineEnd.x), std::min(op.rect.y, op.lineEnd.y), std::abs(op.rect.x - op.lineEnd.x), std::abs(op.rect.y - op.lineEnd.y)};
            margin += std::max(1.0f, op.strokeWidth) * 0.5f;
        }
        rect = {rect.x - margin, rect.y - margin, rect.width + 2 * margin, rect.height + 2 * margin};
        return {rect, true, false};
    }

    std::shared_ptr<const PaintFragment> DrawOpsBuilder::buildFragment(LayoutTree& tree, NodeId id, PaintWorkCounters& counters) const {
        auto& node = tree.node(id);
        constexpr auto paintMask = dirtyMask(DirtyFlag::Structure) | dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Placement) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::Transform) | dirtyMask(DirtyFlag::Resource);
        if (node.paintCache && !(node.dirty & paintMask)) { ++counters.subtreeCacheHits; return node.paintCache; }
        const Size size{node.contentBounds.width, node.contentBounds.height};
        if (!node.paintContent || node.paintedContentRevision != node.contentRevision || node.paintedContentSize != size || node.paintedTextLayout != node.textLayout) {
            auto ops = std::make_shared<std::vector<DrawOp>>();
            collectContent(tree, id, *ops, 1);
            for (auto& op : *ops) {
                prepareText(op, textLayoutService_);
                if (op.type == DrawOpType::DrawText) {
                    if (node.type == NodeType::Input && inputValue(node).empty()) node.placeholderLayout = op.textLayout;
                    else node.textLayout = op.textLayout;
                }
                translateOp(op, {-node.contentBounds.x, -node.contentBounds.y});
            }
            counters.emittedOps += ops->size();
            node.paintContent = std::move(ops);
            node.paintedContentRevision = node.contentRevision;
            node.paintedContentSize = size;
            node.paintedTextLayout = node.textLayout;
            ++counters.contentBuilds;
        } else ++counters.contentReuses;

        PaintFragment content;
        content.content = node.paintContent;
        for (auto childId : childrenInPaintOrder(tree, node)) {
            const auto& child = tree.node(childId);
            content.children.push_back({buildFragment(tree, childId, counters), {child.bounds.x - node.contentBounds.x, child.bounds.y - node.contentBounds.y}});
        }
        auto current = node.contentFragment = retainFragment(node.contentFragment, std::move(content), counters);
        Point origin{node.contentBounds.x, node.contentBounds.y};
        for (std::size_t index = node.modifier.elements().size(); index-- > 0;) {
            auto& instance = node.modifier.elements()[index];
            auto value = instance.descriptor.value;
            if (auto* layout = std::get_if<LayoutModifierSemantics>(&value)) layout->scrollValue = 0;
            const Rect localBounds{0, 0, instance.bounds.width, instance.bounds.height};
            auto layer = instance.paintCache;
            if (!layer || layer->value != value || layer->bounds != localBounds) {
                auto next = std::make_shared<PaintLayerFragment>();
                next->value = value;
                next->bounds = localBounds;
                std::vector<DrawOp> ops;
                std::size_t split = 0;
                collectModifier(tree, id, index, ops, 1, [&](float alpha) { split = ops.size(); next->contentAlpha = alpha; }, false, index + 1);
                for (auto& op : ops) translateOp(op, {-instance.bounds.x, -instance.bounds.y});
                next->before.assign(ops.begin(), ops.begin() + static_cast<std::ptrdiff_t>(split));
                next->after.assign(ops.begin() + static_cast<std::ptrdiff_t>(split), ops.end());
                counters.emittedOps += ops.size();
                instance.paintCache = layer = next;
                ++counters.layersBuilt;
            } else ++counters.layerCacheHits;
            const PlacedPaintFragment child{current, {origin.x - instance.bounds.x, origin.y - instance.bounds.y}};
            if (instance.fragmentCache && instance.fragmentCache->layer == layer && instance.fragmentCache->children.size() == 1 && instance.fragmentCache->children.front() == child) {
                current = instance.fragmentCache;
                ++counters.fragmentsReused;
            } else {
                PaintFragment wrapper;
                wrapper.layer = layer;
                wrapper.children.push_back(child);
                current = instance.fragmentCache = retainFragment(instance.fragmentCache, std::move(wrapper), counters);
            }
            origin = {instance.bounds.x, instance.bounds.y};
        }
        if (node.paintCache != current) ++counters.nodesBuilt;
        else ++counters.subtreeCacheHits;
        node.paintCache = current;
        return current;
    }

    PlacedPaintFragment DrawOpsBuilder::build(LayoutTree& tree, NodeId root, PaintWorkCounters& counters) const {
        if (!tree.contains(root)) return {};
        const auto& node = tree.node(root);
        return {buildFragment(tree, root, counters), {node.bounds.x, node.bounds.y}};
    }

    void visitPaintOps(const PaintFragment& fragment, const std::function<void(const std::vector<DrawOp>&)>& visitor, bool resourcesOnly) {
        if (resourcesOnly && !fragment.hasExternalResources) return;
        if (fragment.layer) visitor(fragment.layer->before);
        if (fragment.content) visitor(*fragment.content);
        for (const auto& child : fragment.children) visitPaintOps(*child.fragment, visitor, resourcesOnly);
        if (fragment.layer) visitor(fragment.layer->after);
    }

    std::vector<DrawOp> exportDrawOps(const PlacedPaintFragment& root) {
        std::vector<DrawOp> result;
        std::function<void(const PlacedPaintFragment&, Point, float)> append = [&](const auto& placed, Point origin, float alpha) {
            if (!placed.fragment) return;
            origin.x += placed.offset.x;
            origin.y += placed.offset.y;
            const auto& part = *placed.fragment;
            const auto copyOps = [&](const std::vector<DrawOp>& ops, float opacity) {
                for (auto op : ops) { translateOp(op, origin); op.color = withAlpha(op.color, opacity); result.push_back(std::move(op)); }
            };
            if (part.layer) copyOps(part.layer->before, alpha);
            const auto contentAlpha = alpha * (part.layer ? part.layer->contentAlpha : 1.0f);
            if (part.content) copyOps(*part.content, contentAlpha);
            for (const auto& child : part.children) append(child, origin, contentAlpha);
            if (part.layer) copyOps(part.layer->after, alpha);
        };
        append(root, {}, 1);
        return result;
    }

    std::vector<DrawOp> DrawOpsBuilder::collectOverlay(const LayoutTree& tree, NodeId target, const std::vector<DrawOp>& content) const {
        std::vector<DrawOp> ops;
        const auto path = nodePath(tree, target);
        if (path.empty()) return ops;
        std::function<void(std::size_t, float)> wrap = [&](std::size_t index, float alpha) {
            if (index == path.size()) {
                for (auto op : content) { op.color = withAlpha(op.color, alpha); ops.push_back(std::move(op)); }
                return;
            }
            collectModifier(tree, path[index], 0, ops, alpha, [&](float nextAlpha) { wrap(index + 1, nextAlpha); }, true);
        };
        wrap(0, 1.0f);
        return ops;
    }

    void DrawOpsBuilder::collectModifier(const LayoutTree& tree, NodeId id, std::size_t index, std::vector<DrawOp>& ops, float alpha, const std::function<void(float)>& contentOverride, bool geometryOnly, std::size_t stopAt) const {
        if (index == stopAt) { contentOverride(alpha); return; }
        const auto& chain = tree.node(id).modifier.elements();
        if (index == chain.size()) { contentOverride(alpha); return; }
        const auto& instance = chain[index];
        const auto& value = instance.descriptor.value;
        const auto content = [&] { collectModifier(tree, id, index + 1, ops, alpha, contentOverride, geometryOnly, stopAt); };
        const auto pushClip = [&](const PaintStyleSemantics& shape) {
            DrawOp op;
            op.type = DrawOpType::PushClip;
            op.nodeId = id;
            op.rect = instance.bounds;
            op.shape = shapeType(shape);
            op.cornerRadius = shape.cornerRadius;
            ops.push_back(op);
        };
        const auto pop = [&](DrawOpType type) { DrawOp op; op.type = type; op.nodeId = id; ops.push_back(op); };
        if (const auto* style = std::get_if<PaintStyleSemantics>(&value)) {
            if (style->kind == PaintStyleKind::Alpha) { alpha *= style->alpha; content(); return; }
            if (geometryOnly) { content(); return; }
            const auto overlay = style->kind == PaintStyleKind::Border;
            if (overlay) content();
            if (style->color != 0) {
                DrawOp op;
                op.type = overlay ? DrawOpType::StrokeRect : DrawOpType::FillRect;
                op.nodeId = id;
                op.rect = instance.bounds;
                op.color = withAlpha(style->color, alpha);
                op.strokeWidth = style->strokeWidth;
                op.shape = shapeType(*style);
                op.cornerRadius = style->cornerRadius;
                ops.push_back(op);
            }
            if (!overlay) content();
            return;
        }
        if (const auto* animation = std::get_if<AnimateContentSizeModifier>(&value); animation && animation->clip) {
            pushClip({}); content(); pop(DrawOpType::PopClip); return;
        }
        if (const auto* clip = std::get_if<ClipModifier>(&value)) {
            pushClip(clip->shape);
            content();
            pop(DrawOpType::PopClip);
            return;
        }
        if (const auto* layer = std::get_if<TransformModifierSemantics>(&value)) {
            DrawOp op;
            op.type = DrawOpType::PushTransform;
            op.nodeId = id;
            op.rect = instance.bounds;
            op.translationX = layer->translationX;
            op.translationY = layer->translationY;
            op.scaleX = layer->scaleX;
            op.scaleY = layer->scaleY;
            op.rotationZ = layer->rotationZ;
            op.transformOriginX = layer->transformOriginX;
            op.transformOriginY = layer->transformOriginY;
            ops.push_back(op);
            alpha *= layer->alpha;
            if (layer->clip) pushClip({});
            content();
            if (layer->clip) pop(DrawOpType::PopClip);
            pop(DrawOpType::PopTransform);
            return;
        }
        if (const auto* layout = std::get_if<LayoutModifierSemantics>(&value); layout && (layout->kind == LayoutModifierKind::VerticalScroll || layout->kind == LayoutModifierKind::HorizontalScroll)) {
            pushClip({});
            content();
            pop(DrawOpType::PopClip);
            return;
        }
        content();
    }

    void DrawOpsBuilder::collectContent(const LayoutTree& tree, NodeId id, std::vector<DrawOp>& ops, float alpha) const {
        const auto& node = tree.node(id);
        const auto contentRect = node.contentBounds;
        if (node.type == NodeType::Text && !node.text.empty()) {
            std::uint32_t textColor = 0xff000000u;
            float fontSize = 14.0f;
            const auto style = objectProp(node, "textStyle", "text-style");
            textColor = style.color("color", textColor);
            fontSize = style.number("fontSize", fontSize);
            const auto lineHeight = std::max(fontSize, style.number("lineHeight", fontSize * 1.2f));
            DrawOp op;
            op.type = DrawOpType::DrawText;
            op.nodeId = id;
            op.rect = contentRect;
            op.color = withAlpha(textColor, alpha);
            op.fontSize = fontSize;
            op.lineHeight = lineHeight;
            op.maxLines = std::max(0, intProp(node, "maxLines", 0));
            op.text = node.text;
            op.textLayout = node.textLayout;
            op.textAlign = textProp(node, "textAlign", "start");
            op.overflow = textProp(node, "overflow", "clip");
            if (op.overflow == "clip" || op.overflow == "ellipsis") {
                DrawOp pushClip;
                pushClip.type = DrawOpType::PushClip;
                pushClip.nodeId = id;
                pushClip.rect = contentRect;
                ops.push_back(std::move(pushClip));
                ops.push_back(std::move(op));
                DrawOp popClip;
                popClip.type = DrawOpType::PopClip;
                popClip.nodeId = id;
                ops.push_back(std::move(popClip));
            }
            else {
                ops.push_back(std::move(op));
            }
        }

        if (node.type == NodeType::Input) {
            std::uint32_t textColor = 0xffe8eaedu;
            float fontSize = 14.0f;
            const auto style = objectProp(node, "textStyle", "text-style");
            textColor = style.color("color", textColor);
            fontSize = style.number("fontSize", fontSize);
            const auto lineHeight = style.number("lineHeight", fontSize);
            const auto singleLine = !TextInputOverlayBuilder::allowsLineBreak(node);
            auto text = inputValue(node);
            if (text.empty()) {
                text = inputPlaceholder(node);
                textColor = 0xff8a9099u;
            }
            if (!text.empty()) {
                auto rect = TextInputOverlayBuilder::textRect(node, 0.0f);
                DrawOp op;
                op.type = DrawOpType::DrawText;
                op.nodeId = id;
                op.inputText = true;
                op.rect = rect;
                op.color = withAlpha(textColor, alpha);
                op.fontSize = fontSize;
                op.lineHeight = std::max(fontSize, lineHeight);
                op.text = text;
                op.textLayout = inputValue(node).empty() ? node.placeholderLayout : node.textLayout;
                op.maxLines = singleLine ? 1 : 0;
                ops.push_back(std::move(op));
            }
        }

        if (node.type == NodeType::Image) {
            DrawOp op;
            op.type = DrawOpType::DrawImage;
            op.rect = contentRect;
            op.color = withAlpha(0xffffffffu, alpha * numericProp(node, "alpha", 1.0f));
            op.resource = resourceProp(node);
            if (auto origin = objectProp(node, "source").string("origin"); !origin.empty()) op.resourceOrigin = std::move(origin);
            op.contentScale = textProp(node, "contentScale", "content-scale", "Fit");
            op.alignment = textProp(node, "alignment", "Center");
            ops.push_back(std::move(op));
        }

        if (node.type == NodeType::Icon) {
            DrawOp op;
            op.type = DrawOpType::DrawIcon;
            op.rect = contentRect;
            op.hasTint = !hasColorUnspecified(node, "tint");
            op.color = withAlpha(colorProp(node, "tint", 0xff000000u), alpha);
            op.resource = resourceProp(node);
            if (auto origin = objectProp(node, "source").string("origin"); !origin.empty()) op.resourceOrigin = std::move(origin);
            op.resourceIsIcon = true;
            ops.push_back(std::move(op));
        }



    }

    std::string DrawOpsBuilder::textStyleProp(const ArrangeNode& node) { return stringProp(node, "textStyle", "text-style", ""); }

    bool TextInputOverlayBuilder::allowsLineBreak(const ArrangeNode& node) {
        if (!boolProp(node, "singleLine", true)) return true;
        if (numberProp(node, "minLines", 1.0f) > 1.0f) return true;
        if (numberProp(node, "maxLines", 1.0f) > 1.0f) return true;
        return false;
    }

    TextInputOverlayBuilder::Metrics TextInputOverlayBuilder::metrics(const ArrangeNode& node, float viewportX) {
        Metrics result;
        result.rect = node.contentBounds;
        const auto style = objectProp(node, "textStyle", "text-style");
        result.fontSize = style.number("fontSize", 14.0f);
        result.singleLine = !allowsLineBreak(node);
        result.textLeft = result.rect.x + 8.0f;
        result.textWidth = std::max(0.0f, result.rect.width - 16.0f);
        result.lineHeight = std::max(result.fontSize, style.number("lineHeight", result.fontSize));
        result.textTop = result.singleLine
                             ? result.rect.y + std::max(0.0f, (result.rect.height - result.lineHeight) * 0.5f)
                             : result.rect.y + 4.0f;
        result.textHeight = result.singleLine ? std::min(result.rect.height, result.lineHeight) : std::max(0.0f, result.rect.height - 8.0f);
        result.viewportX = result.singleLine ? viewportX : 0.0f;
        return result;
    }

    Rect TextInputOverlayBuilder::textRect(const ArrangeNode& node, float viewportX) {
        const auto result = metrics(node, viewportX);
        return {result.textLeft, result.textTop, result.textWidth, result.textHeight};
    }

    TextInputOverlayBuilder::Layout TextInputOverlayBuilder::layout(
        const ArrangeNode& node,
        const std::string& text,
        float viewportX,
        const TextLayoutService& textLayoutService) {
        Layout result;
        result.metrics = metrics(node, viewportX);
        result.text = textLayoutService.layout(
            text,
            {result.metrics.fontSize, result.metrics.lineHeight},
            {result.metrics.singleLine ? 1 : 0, result.metrics.singleLine ? 0.0f : result.metrics.textWidth, result.metrics.singleLine}, node.textLayout);
        return result;
    }

    std::vector<Rect> TextInputOverlayBuilder::textBoundsForByteRange(
        const Layout& layout,
        const std::string& text,
        std::size_t start,
        std::size_t end,
        const TextLayoutService& textLayoutService) {
        std::vector<Rect> bounds;
        start = std::min(start, text.size());
        end = std::min(end, text.size());
        if (end < start) std::swap(start, end);

        if (start == end) {
            const auto rect = textLayoutService.caretRect(
                *layout.text,
                start,
                {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop});
            bounds.push_back({rect.x, rect.y, 1.0f, rect.height});
            return bounds;
        }

        for (auto rect : textLayoutService.boundsForRange(
                 *layout.text,
                 start,
                 end,
                 {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop})) {
            rect.width = std::max(1.0f, rect.width);
            bounds.push_back(rect);
        }
        return bounds;
    }

    std::vector<DrawOp> TextInputOverlayBuilder::build(
        const ArrangeNode& node,
        const TextInputOverlayState& state,
        const TextLayoutService& textLayoutService) const {
        std::vector<DrawOp> ops;
        const auto inputLayout = layout(node, state.text, state.viewportX, textLayoutService);
        const auto& overlayMetrics = inputLayout.metrics;

        DrawOp focusRing;
        focusRing.type = DrawOpType::StrokeRect;
        focusRing.nodeId = node.id;
        focusRing.rect = overlayMetrics.rect;
        focusRing.color = 0xff7aa2ffu;
        focusRing.strokeWidth = 1.0f;
        ops.push_back(std::move(focusRing));

        DrawOp pushClip;
        pushClip.type = DrawOpType::PushClip;
        pushClip.nodeId = node.id;
        pushClip.rect = {overlayMetrics.textLeft, overlayMetrics.textTop, overlayMetrics.textWidth, overlayMetrics.textHeight};
        ops.push_back(std::move(pushClip));

        if (state.hasSelection()) {
            const auto start = std::min(state.selectionStart, state.selectionEnd);
            const auto end = std::max(state.selectionStart, state.selectionEnd);
            for (const auto& area : textBoundsForByteRange(inputLayout, state.text, start, end, textLayoutService)) {
                DrawOp selection;
                selection.type = DrawOpType::FillRect;
                selection.nodeId = node.id;
                selection.rect = area;
                selection.color = 0x663a7afeu;
                ops.push_back(std::move(selection));
            }
        }

        for (const auto& range : state.temporaryUnderlines) {
            for (const auto& area : textBoundsForByteRange(inputLayout, state.text, range.start, range.end, textLayoutService)) {
                const auto underlineY = area.y + area.height - 2.0f;
                DrawOp underline;
                underline.type = DrawOpType::DrawLine;
                underline.nodeId = node.id;
                underline.rect = {area.x, underlineY, 0.0f, 0.0f};
                underline.lineEnd = {area.x + area.width, underlineY};
                underline.color = 0xff7aa2ffu;
                underline.strokeWidth = 1.0f;
                ops.push_back(std::move(underline));
            }
        }

        const auto cursor = textLayoutService.caretRect(*inputLayout.text, state.cursorIndex, {overlayMetrics.textLeft - overlayMetrics.viewportX, overlayMetrics.textTop});
        DrawOp caret;
        caret.type = DrawOpType::DrawLine;
        caret.nodeId = node.id;
        caret.rect = {cursor.x, cursor.y, 0.0f, 0.0f};
        caret.lineEnd = {cursor.x, cursor.y + cursor.height};
        caret.color = 0xffe8eaedu;
        caret.strokeWidth = 1.0f;
        ops.push_back(std::move(caret));

        DrawOp popClip;
        popClip.type = DrawOpType::PopClip;
        popClip.nodeId = node.id;
        ops.push_back(std::move(popClip));
        return ops;
    }
} // namespace arrange::core
