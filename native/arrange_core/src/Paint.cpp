#include <arrange/core/Affine.h>
#include <arrange/core/ModifierGeometry.h>
#include <arrange/core/Paint.h>
#include <arrange/core/Modifier.h>

#include <algorithm>
#include <cstdlib>
#include <cmath>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

namespace arrange::core {
    namespace {
        float zIndexOf(const LayoutNode& node) {
            return node.modifier.zIndex();
        }

        std::vector<NodeId> childrenInPaintOrder(const LayoutTree& tree, const LayoutNode& node) {
            auto children = node.children;
            std::stable_sort(children.begin(), children.end(), [&](NodeId left, NodeId right) { return zIndexOf(tree.node(left)) < zIndexOf(tree.node(right)); });
            return children;
        }

        std::uint32_t styleColor(const PaintStyleSemantics& style) {
            return style.color;
        }

        DrawShapeType shapeType(const PaintStyleSemantics& style) {
            if (style.shapeType == ShapeKind::Circle) return DrawShapeType::Circle;
            if (style.shapeType == ShapeKind::Rounded) return DrawShapeType::Rounded;
            return DrawShapeType::Rectangle;
        }

        std::uint32_t withAlpha(std::uint32_t color, float alpha) {
            const auto clamped = std::clamp(alpha, 0.0f, 1.0f);
            const auto sourceAlpha = static_cast<float>((color >> 24u) & 0xffu);
            const auto nextAlpha = static_cast<std::uint32_t>(std::clamp(sourceAlpha * clamped, 0.0f, 255.0f) + 0.5f);
            return (color & 0x00ffffffu) | (nextAlpha << 24u);
        }
    }

    void DrawOpsBuilder::prepareText(DrawOp& op, const TextLayoutService& service) {
        if (op.type != DrawOpType::DrawText) return;
        const auto width = op.inputText && op.maxLines == 1 ? 0.0f : op.rect.width;
        op.textLayout = service.layout(op.text, op.textStyle, {op.maxLines, width, op.maxLines == 1, op.overflow == TextOverflow::Ellipsis}, op.textLayout);
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
            if (op.type == DrawOpType::DrawLine) {
                op.lineEnd.x += offset.x;
                op.lineEnd.y += offset.y;
            }
        }

        PaintBounds translated(PaintBounds bounds, Point offset) {
            bounds.rect.x += offset.x;
            bounds.rect.y += offset.y;
            return bounds;
        }

        void includeBounds(PaintBounds& target, PaintBounds source) {
            target.known = target.known && source.known;
            if (source.empty) return;
            if (target.empty) {
                target.rect = source.rect;
                target.empty = false;
                return;
            }
            const auto right = std::max(target.rect.x + target.rect.width, source.rect.x + source.rect.width);
            const auto bottom = std::max(target.rect.y + target.rect.height, source.rect.y + source.rect.height);
            target.rect.x = std::min(target.rect.x, source.rect.x);
            target.rect.y = std::min(target.rect.y, source.rect.y);
            target.rect.width = right - target.rect.x;
            target.rect.height = bottom - target.rect.y;
        }

        Affine opTransform(const DrawOp& op) {
            return Affine::layer(op.rect, op.transformOriginX, op.transformOriginY, op.scaleX, op.scaleY, op.rotationZ, op.translationX, op.translationY);
        }

        PaintBounds transformBounds(PaintBounds bounds, const DrawOp& op) {
            if (!bounds.known || bounds.empty) return bounds;
            const auto rect = opTransform(op).project(bounds.rect);
            if (!rect) return {{}, false, false};
            return {*rect, true, false};
        }

        // 按重放顺序跟踪变换与裁剪栈，求自定义绘制层的局部外包盒；子片段在内容标记处按当时的变换并入
        PaintBounds commandBounds(const std::vector<DrawOp>& ops, const PaintBounds& children) {
            struct State {
                Affine transform;
                std::optional<Rect> clip;
            };

            std::vector<State> stack{{}};
            PaintBounds result;
            const auto include = [&](const PaintBounds& local) {
                if (!local.known) {
                    result.known = false;
                    return;
                }
                if (local.empty) return;
                auto rect = stack.back().transform.project(local.rect);
                if (!rect) {
                    result.known = false;
                    return;
                }
                if (stack.back().clip) rect = intersectRect(*rect, *stack.back().clip);
                if (rect->width > 0 && rect->height > 0) includeBounds(result, {*rect, true, false});
            };
            for (const auto& op : ops) {
                switch (op.type) {
                    case DrawOpType::PushTransform:
                        stack.push_back({stack.back().transform.after(opTransform(op)), stack.back().clip});
                        break;
                    case DrawOpType::PushClip: {
                        auto next = stack.back();
                        if (const auto clip = next.transform.project(op.rect))
                            next.clip = next.clip ? intersectRect(*next.clip, *clip) : *clip;
                        else
                            result.known = false;
                        stack.push_back(next);
                        break;
                    }
                    case DrawOpType::PopTransform:
                    case DrawOpType::PopClip:
                        if (stack.size() > 1) stack.pop_back();
                        break;
                    case DrawOpType::ContentMarker:
                        include(children);
                        break;
                    default:
                        include(drawOpBounds(op));
                        break;
                }
            }
            return result;
        }

        DrawOp drawCommandOp(const DrawCommand& command, NodeId node) {
            DrawOp op;
            op.nodeId = node;
            op.rect = command.rect;
            op.color = command.gradient ? 0xffffffffu : command.color;
            op.gradient = command.gradient;
            op.strokeWidth = command.strokeWidth;
            op.cap = command.cap;
            op.join = command.join;
            op.corners = CornerRadii::uniform(command.radius);
            op.lineEnd = command.lineEnd;
            op.path = command.path;
            if (command.path) op.rect = command.path->bounds;
            switch (command.kind) {
                case DrawCommandKind::Rectangle:
                case DrawCommandKind::RoundedRectangle:
                case DrawCommandKind::Oval:
                    op.type = command.strokeWidth > 0 ? DrawOpType::StrokeRect : DrawOpType::FillRect;
                    op.shape = command.kind == DrawCommandKind::Rectangle ? DrawShapeType::Rectangle : command.kind == DrawCommandKind::RoundedRectangle ? DrawShapeType::Rounded : DrawShapeType::Circle;
                    break;
                case DrawCommandKind::Line:
                    op.type = DrawOpType::DrawLine;
                    break;
                case DrawCommandKind::PushClip:
                    op.type = DrawOpType::PushClip;
                    op.shape = command.shape == DrawCommandShape::Rectangle ? DrawShapeType::Rectangle : command.shape == DrawCommandShape::Rounded ? DrawShapeType::Rounded : command.shape == DrawCommandShape::Oval ? DrawShapeType::Circle : DrawShapeType::Path;
                    break;
                case DrawCommandKind::PopClip:
                    op.type = DrawOpType::PopClip;
                    break;
                case DrawCommandKind::PushTransform:
                    op.type = DrawOpType::PushTransform;
                    op.translationX = command.translationX;
                    op.translationY = command.translationY;
                    op.scaleX = command.scaleX;
                    op.scaleY = command.scaleY;
                    op.rotationZ = command.rotationZ;
                    op.transformOriginX = command.originX;
                    op.transformOriginY = command.originY;
                    break;
                case DrawCommandKind::PopTransform:
                    op.type = DrawOpType::PopTransform;
                    break;
                case DrawCommandKind::Content:
                    op.type = DrawOpType::ContentMarker;
                    break;
                case DrawCommandKind::Path:
                    op.type = DrawOpType::DrawPath;
                    op.shape = DrawShapeType::Path;
                    break;
                case DrawCommandKind::Text:
                    op.type = DrawOpType::DrawText;
                    op.text = command.text;
                    op.textStyle = command.textStyle;
                    op.maxLines = command.maxLines;
                    op.textAlign = command.textAlign;
                    op.overflow = command.overflow;
                    break;
                case DrawCommandKind::Native:
                    op.type = DrawOpType::DrawNative;
                    op.native = command.native;
                    op.nativeParams = command.nativeParams;
                    op.nativeRevision = command.nativeRevision;
                    break;
                case DrawCommandKind::Painter:
                    op.type = DrawOpType::DrawPainter;
                    op.painter = command.painter;
                    op.contentScale = command.contentScale;
                    op.alignment = command.alignment;
                    op.repeat = command.repeat;
                    op.slices = command.slices;
                    op.hasTint = command.hasTint;
                    op.color = withAlpha(command.hasTint ? command.color : 0xffffffffu, command.alpha);
                    break;
            }
            return op;
        }

        std::shared_ptr<const PaintFragment> retainFragment(std::shared_ptr<const PaintFragment> previous, PaintFragment next, PaintWorkCounters& counters) {
            if (previous && previous->layer == next.layer && previous->content == next.content && previous->children == next.children) {
                ++counters.fragmentsReused;
                return previous;
            }
            for (const auto& child : next.children) includeBounds(next.bounds, translated(child.fragment->bounds, child.offset));
            // 自定义绘制层只在内容标记处重放子片段，边界由命令求出
            if (next.layer && next.layer->drawCommands) {
                next.bounds = commandBounds(next.layer->before, next.bounds);
                ++counters.fragmentsBuilt;
                return std::make_shared<const PaintFragment>(std::move(next));
            }
            // 内容模糊把子片段边界外扩三倍标准差；阴影与背景模糊并入自身输出范围
            if (const auto* effect = next.layer ? std::get_if<EffectModifier>(&next.layer->value) : nullptr) {
                if (effect->kind == EffectKind::Blur && next.bounds.known && !next.bounds.empty) {
                    const auto margin = effectSigma(*effect) * 3.0f;
                    next.bounds.rect = {next.bounds.rect.x - margin, next.bounds.rect.y - margin, next.bounds.rect.width + margin * 2, next.bounds.rect.height + margin * 2};
                } else if (effect->kind != EffectKind::Blur)
                    includeBounds(next.bounds, {effectOutputBounds(*effect, next.layer->bounds), true, false});
            }
            if (next.content)
                for (const auto& op : *next.content) includeBounds(next.bounds, drawOpBounds(op));
            if (next.layer) {
                for (auto it = next.layer->before.rbegin(); it != next.layer->before.rend(); ++it)
                    if (it->type == DrawOpType::PushTransform) next.bounds = transformBounds(next.bounds, *it);
                for (const auto& op : next.layer->before) includeBounds(next.bounds, drawOpBounds(op));
                for (const auto& op : next.layer->after) includeBounds(next.bounds, drawOpBounds(op));
            }
            ++counters.fragmentsBuilt;
            return std::make_shared<const PaintFragment>(std::move(next));
        }
    }

    bool textHasVisualOverflow(const DrawOp& op) {
        if (!op.textLayout) return true;
        constexpr float epsilon = 0.01f;
        return op.textLayout->truncated || op.textLayout->width > op.rect.width + epsilon || op.textLayout->height > op.rect.height + epsilon;
    }

    PaintBounds drawOpBounds(const DrawOp& op) {
        if (op.type == DrawOpType::PushClip || op.type == DrawOpType::PopClip || op.type == DrawOpType::PushTransform || op.type == DrawOpType::PopTransform || op.type == DrawOpType::ContentMarker) return {};
        auto rect = op.rect;
        if (op.type == DrawOpType::DrawText) {
            if (op.inputText || (op.overflow != TextOverflow::Visible && textHasVisualOverflow(op))) return {rect, true, rect.width <= 0 || rect.height <= 0};
            if (!op.textLayout || !op.textLayout->boundsKnown) return {{}, false, false};
            rect = op.textLayout->inkBounds;
            float minShift = 0, maxShift = 0;
            for (const auto& line : op.textLayout->lines) {
                const auto shift = textAlignShift(op.textAlign, op.rect.width, line.width);
                minShift = std::min(minShift, shift);
                maxShift = std::max(maxShift, shift);
            }
            rect.x += op.rect.x + minShift;
            rect.y += op.rect.y;
            rect.width += maxShift - minShift;
        }
        if (op.type == DrawOpType::DrawPainter && op.repeat == ImageRepeat::None && (op.contentScale == ContentScale::Unscaled || op.contentScale == ContentScale::Inside || op.contentScale == ContentScale::Crop)) return {{}, false, false};
        auto margin = 1.0f;
        if (op.type == DrawOpType::StrokeRect) margin += op.strokeWidth * 0.5f;
        // 尖角线接最多伸出三倍线宽，其余线帽与线接不超过一倍
        if (op.type == DrawOpType::DrawPath && op.strokeWidth > 0) margin += op.strokeWidth * (op.join == StrokeJoin::Miter ? 3.0f : 1.0f);
        if (op.type == DrawOpType::DrawLine) {
            rect = {std::min(op.rect.x, op.lineEnd.x), std::min(op.rect.y, op.lineEnd.y), std::abs(op.rect.x - op.lineEnd.x), std::abs(op.rect.y - op.lineEnd.y)};
            margin += std::max(1.0f, op.strokeWidth) * 0.5f;
        }
        rect = {rect.x - margin, rect.y - margin, rect.width + 2 * margin, rect.height + 2 * margin};
        return {rect, true, false};
    }

    std::shared_ptr<const PaintFragment> DrawOpsBuilder::buildFragment(LayoutTree& tree, NodeId id, PaintWorkCounters& counters) const {
        const auto& cached = tree.node(id);
        constexpr auto paintMask = dirtyMask(DirtyFlag::Structure) | dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Placement) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::Transform) | dirtyMask(DirtyFlag::Resource);
        if (cached.paintCache && !((cached.dirty | cached.subtreeDirty) & paintMask)) {
            ++counters.subtreeCacheHits;
            return cached.paintCache;
        }
        auto& node = tree.mutableNode(id);
        PaintFragment content;
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
            const auto fontEnvironment = textLayoutService_.environment();
            auto layer = instance.paintCache;
            const auto customDraw = std::holds_alternative<DrawModifier>(value);
            if (customDraw && !instance.preparedDraw) throw std::logic_error("绘制 Modifier 尚未在候选准备阶段生成内容");
            if (!layer || layer->value != value || layer->bounds != localBounds || layer->textLayout != instance.textLayout || layer->fontEnvironment != fontEnvironment || customDraw && layer->drawCommands != instance.preparedDraw) {
                auto next = std::make_shared<PaintLayerFragment>();
                next->value = value;
                next->fontEnvironment = fontEnvironment;
                next->textLayout = instance.textLayout;
                next->bounds = localBounds;
                std::vector<DrawOp> ops;
                std::size_t split = 0;
                if (customDraw) {
                    next->drawCommands = instance.preparedDraw;
                    for (const auto& command : *instance.preparedDraw) {
                        auto op = drawCommandOp(command, id);
                        if (op.type == DrawOpType::DrawText) {
                            prepareText(op, textLayoutService_);
                            op.rect.height = op.textLayout->height;
                        }
                        // 未加载完成的 painter 不出命令
                        if (op.type != DrawOpType::DrawPainter || op.painter.content) ops.push_back(std::move(op));
                    }
                    split = ops.size();
                } else
                    collectModifier(
                        tree, id, index, ops, 1,
                        [&](float alpha) {
                            split = ops.size();
                            next->contentAlpha = alpha;
                        },
                        index + 1);
                if (!customDraw)
                    for (auto& op : ops) translateOp(op, {-instance.bounds.x, -instance.bounds.y});
                next->before.assign(ops.begin(), ops.begin() + static_cast<std::ptrdiff_t>(split));
                next->after.assign(ops.begin() + static_cast<std::ptrdiff_t>(split), ops.end());
                counters.emittedOps += ops.size();
                instance.paintCache = layer = next;
                ++counters.layersBuilt;
                if (textPresentation(value)) ++counters.contentBuilds;
            } else {
                ++counters.layerCacheHits;
                if (textPresentation(value)) ++counters.contentReuses;
            }
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
        if (node.paintCache != current)
            ++counters.nodesBuilt;
        else
            ++counters.subtreeCacheHits;
        node.paintCache = current;
        return current;
    }

    PlacedPaintFragment DrawOpsBuilder::build(LayoutTree& tree, NodeId root, PaintWorkCounters& counters) const {
        if (!tree.contains(root)) return {};
        const auto& node = tree.node(root);
        return {buildFragment(tree, root, counters), {node.bounds.x, node.bounds.y}};
    }

    std::vector<DrawOp> exportDrawOps(const PlacedPaintFragment& root) {
        std::vector<DrawOp> result;
        std::function<void(const PlacedPaintFragment&, Point, float)> append = [&](const auto& placed, Point origin, float alpha) {
            if (!placed.fragment) return;
            origin.x += placed.offset.x;
            origin.y += placed.offset.y;
            const auto& part = *placed.fragment;
            const auto copyOps = [&](const std::vector<DrawOp>& ops, float opacity) {
                for (auto op : ops) {
                    translateOp(op, origin);
                    op.color = withAlpha(op.color, opacity);
                    if (op.inputText) op.inputAlpha *= opacity;
                    result.push_back(std::move(op));
                }
            };
            if (part.layer && part.layer->drawCommands) {
                for (auto op : part.layer->before) {
                    if (op.type == DrawOpType::ContentMarker) {
                        for (const auto& child : part.children) append(child, origin, alpha);
                    } else {
                        translateOp(op, origin);
                        op.color = withAlpha(op.color, alpha);
                        if (op.inputText) op.inputAlpha *= alpha;
                        result.push_back(std::move(op));
                    }
                }
                return;
            }
            if (part.layer) copyOps(part.layer->before, alpha);
            const auto contentAlpha = alpha * (part.layer ? part.layer->contentAlpha : 1.0f);
            if (part.content) copyOps(*part.content, contentAlpha);
            for (const auto& child : part.children) append(child, origin, contentAlpha);
            if (part.layer) copyOps(part.layer->after, alpha);
        };
        append(root, {}, 1);
        return result;
    }

    void DrawOpsBuilder::collectModifier(const LayoutTree& tree, NodeId id, std::size_t index, std::vector<DrawOp>& ops, float alpha, const std::function<void(float)>& contentOverride, std::size_t stopAt) const {
        if (index == stopAt) {
            contentOverride(alpha);
            return;
        }
        const auto& chain = tree.node(id).modifier.elements();
        if (index == chain.size()) {
            contentOverride(alpha);
            return;
        }
        const auto& instance = chain[index];
        const auto& value = instance.descriptor.value;
        const auto content = [&] {
            collectModifier(tree, id, index + 1, ops, alpha, contentOverride, stopAt);
        };
        const auto pushClip = [&](const PaintStyleSemantics& shape) {
            DrawOp op;
            op.type = DrawOpType::PushClip;
            op.nodeId = id;
            op.rect = instance.bounds;
            op.shape = shapeType(shape);
            op.corners = shape.corners;
            ops.push_back(op);
        };
        const auto pop = [&](DrawOpType type) {
            DrawOp op;
            op.type = type;
            op.nodeId = id;
            ops.push_back(op);
        };
        if (const auto* style = std::get_if<PaintStyleSemantics>(&value)) {
            if (style->kind == PaintStyleKind::Alpha) {
                alpha *= style->alpha;
                content();
                return;
            }
            const auto overlay = style->kind == PaintStyleKind::Border;
            if (overlay) content();
            if (style->color != 0 || style->gradient) {
                DrawOp op;
                op.type = overlay ? DrawOpType::StrokeRect : DrawOpType::FillRect;
                op.nodeId = id;
                op.rect = instance.bounds;
                op.color = withAlpha(style->gradient ? 0xffffffffu : style->color, alpha);
                op.gradient = style->gradient;
                op.strokeWidth = style->strokeWidth;
                op.shape = shapeType(*style);
                op.corners = style->corners;
                ops.push_back(op);
            }
            if (!overlay) content();
            return;
        }
        if (const auto* animation = std::get_if<AnimateContentSizeModifier>(&value); animation && animation->clip) {
            pushClip({});
            content();
            pop(DrawOpType::PopClip);
            return;
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
        if (const auto* text = textPresentation(value)) {
            DrawOp op;
            op.type = DrawOpType::DrawText;
            op.nodeId = id;
            op.rect = instance.bounds;
            op.text = modifierText(value);
            op.textStyle = text->style;
            op.color = withAlpha(text->color, alpha);
            op.textAlign = text->textAlign;
            op.overflow = text->overflow;
            op.maxLines = text->singleLine ? 1 : std::holds_alternative<TextFieldModifier>(value) ? 0 : text->maxLines;
            op.inputText = std::holds_alternative<TextFieldModifier>(value);
            if (op.inputText) op.textField = instance.handle;
            op.textLayout = instance.textLayout;
            prepareText(op, textLayoutService_);
            ops.push_back(std::move(op));
            content();
            return;
        }
        if (const auto* paint = std::get_if<PaintModifier>(&value)) {
            if (paint->painter.content) {
                DrawOp op;
                op.type = DrawOpType::DrawPainter;
                op.nodeId = id;
                op.rect = instance.bounds;
                op.painter = paint->painter;
                op.contentScale = paint->contentScale;
                op.alignment = paint->alignment;
                op.repeat = paint->repeat;
                op.slices = paint->slices;
                op.hasTint = paint->tint.has_value();
                op.color = withAlpha(paint->tint.value_or(0xffffffffu), alpha * paint->alpha);
                ops.push_back(std::move(op));
            }
            content();
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

    bool TextInputOverlayBuilder::allowsLineBreak(const ModifierInstance& instance) {
        return !std::get<TextFieldModifier>(instance.descriptor.value).presentation.singleLine;
    }

    TextInputOverlayBuilder::Metrics TextInputOverlayBuilder::metrics(const ModifierInstance& instance, float viewportX, float viewportY) {
        const auto& input = std::get<TextFieldModifier>(instance.descriptor.value).presentation;
        Metrics result;
        result.rect = instance.bounds;
        result.fontSize = input.style.fontSize;
        result.singleLine = !allowsLineBreak(instance);
        result.textLeft = result.rect.x;
        result.textWidth = std::max(0.0f, result.rect.width);
        result.lineHeight = instance.textLayout ? instance.textLayout->lineHeight : std::max(input.style.lineHeight, input.style.fontSize);
        result.textTop = result.rect.y;
        result.textHeight = std::max(0.0f, result.rect.height);
        result.viewportX = result.singleLine ? viewportX : 0.0f;
        result.viewportY = result.singleLine ? 0.0f : viewportY;
        return result;
    }

    Rect TextInputOverlayBuilder::textRect(const ModifierInstance& instance, float viewportX) {
        const auto result = metrics(instance, viewportX);
        return {result.textLeft, result.textTop, result.textWidth, result.textHeight};
    }

    TextInputOverlayBuilder::Layout TextInputOverlayBuilder::layout(const ModifierInstance& instance, const std::string& text, float viewportX, const TextLayoutService& textLayoutService, float viewportY) {
        Layout result;
        result.metrics = metrics(instance, viewportX, viewportY);
        const auto& input = std::get<TextFieldModifier>(instance.descriptor.value).presentation;
        result.text = textLayoutService.layout(text, input.style, {result.metrics.singleLine ? 1 : 0, result.metrics.singleLine ? 0.0f : result.metrics.textWidth, result.metrics.singleLine}, instance.textLayout);
        return result;
    }

    std::vector<Rect> TextInputOverlayBuilder::textBoundsForByteRange(const Layout& layout, const std::string& text, std::size_t start, std::size_t end, const TextLayoutService& textLayoutService) {
        std::vector<Rect> bounds;
        start = std::min(start, text.size());
        end = std::min(end, text.size());
        if (end < start) std::swap(start, end);

        if (start == end) {
            const auto rect = textLayoutService.caretRect(*layout.text, start, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop - layout.metrics.viewportY});
            bounds.push_back({rect.x, rect.y, 1.0f, rect.height});
            return bounds;
        }

        for (auto rect : textLayoutService.boundsForRange(*layout.text, start, end, {layout.metrics.textLeft - layout.metrics.viewportX, layout.metrics.textTop - layout.metrics.viewportY})) {
            rect.width = std::max(1.0f, rect.width);
            bounds.push_back(rect);
        }
        return bounds;
    }

    std::vector<DrawOp> TextInputOverlayBuilder::build(NodeId node, const ModifierInstance& instance, const TextInputOverlayState& state, const TextLayoutService& textLayoutService) const {
        std::vector<DrawOp> ops;
        const auto inputLayout = layout(instance, state.text, state.viewportX, textLayoutService, state.viewportY);
        const auto& overlayMetrics = inputLayout.metrics;

        DrawOp pushClip;
        pushClip.type = DrawOpType::PushClip;
        pushClip.nodeId = node;
        pushClip.rect = {overlayMetrics.textLeft, overlayMetrics.textTop, overlayMetrics.textWidth, overlayMetrics.textHeight};
        ops.push_back(std::move(pushClip));

        if (state.hasSelection()) {
            const auto start = std::min(state.selectionStart, state.selectionEnd);
            const auto end = std::max(state.selectionStart, state.selectionEnd);
            for (const auto& area : textBoundsForByteRange(inputLayout, state.text, start, end, textLayoutService)) {
                DrawOp selection;
                selection.type = DrawOpType::FillRect;
                selection.nodeId = node;
                selection.rect = area;
                selection.color = 0x663a7afeu;
                ops.push_back(std::move(selection));
            }
        }

        const auto& field = std::get<TextFieldModifier>(instance.descriptor.value);
        const auto& input = field.presentation;
        DrawOp text;
        text.type = DrawOpType::DrawText;
        text.nodeId = node;
        text.rect = instance.bounds;
        text.rect.x -= state.viewportX;
        text.rect.y -= state.viewportY;
        text.rect.width += state.viewportX;
        text.rect.height += state.viewportY;
        text.text = state.text.empty() ? field.placeholder : state.text;
        text.color = input.color;
        text.textStyle = input.style;
        text.maxLines = input.singleLine ? 1 : 0;
        text.overflow = TextOverflow::Clip;
        text.textAlign = TextAlign::Start;
        text.textLayout = state.text.empty() ? instance.textLayout : inputLayout.text;
        ops.push_back(std::move(text));

        for (const auto& range : state.temporaryUnderlines) {
            for (const auto& area : textBoundsForByteRange(inputLayout, state.text, range.start, range.end, textLayoutService)) {
                const auto underlineY = area.y + area.height - 2.0f;
                DrawOp underline;
                underline.type = DrawOpType::DrawLine;
                underline.nodeId = node;
                underline.rect = {area.x, underlineY, 0.0f, 0.0f};
                underline.lineEnd = {area.x + area.width, underlineY};
                underline.color = 0xff7aa2ffu;
                underline.strokeWidth = 1.0f;
                ops.push_back(std::move(underline));
            }
        }

        const auto cursor = textLayoutService.caretRect(*inputLayout.text, state.cursorIndex, {overlayMetrics.textLeft - overlayMetrics.viewportX, overlayMetrics.textTop - overlayMetrics.viewportY});
        DrawOp caret;
        caret.type = DrawOpType::DrawLine;
        caret.nodeId = node;
        caret.rect = {cursor.x, cursor.y, 0.0f, 0.0f};
        caret.lineEnd = {cursor.x, cursor.y + cursor.height};
        caret.color = input.color;
        caret.strokeWidth = 1.0f;
        ops.push_back(std::move(caret));

        DrawOp popClip;
        popClip.type = DrawOpType::PopClip;
        popClip.nodeId = node;
        ops.push_back(std::move(popClip));
        return ops;
    }
}
