#include <arrange/core/Repaint.h>

#include <algorithm>
#include <cmath>
#include <optional>

namespace arrange::core {
    namespace {
        // x' = a·x + c·y + tx，y' = b·x + d·y + ty
        struct Affine {
            double a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0;
        };

        // 先 inner 后 outer
        Affine compose(const Affine& outer, const Affine& inner) {
            return {
                outer.a * inner.a + outer.c * inner.b, outer.b * inner.a + outer.d * inner.b, outer.a * inner.c + outer.c * inner.d, outer.b * inner.c + outer.d * inner.d, outer.a * inner.tx + outer.c * inner.ty + outer.tx, outer.b * inner.tx + outer.d * inner.ty + outer.ty,
            };
        }

        Affine translation(Point offset) {
            return {1, 0, 0, 1, offset.x, offset.y};
        }

        // 与 JUCE 重放一致：绕轴心缩放、旋转后平移
        Affine opTransform(const DrawOp& op) {
            const double px = op.rect.x + op.rect.width * op.transformOriginX;
            const double py = op.rect.y + op.rect.height * op.transformOriginY;
            const auto radians = op.rotationZ * 3.14159265358979323846 / 180.0;
            const auto cosine = std::cos(radians), sine = std::sin(radians);
            Affine result{cosine * op.scaleX, sine * op.scaleX, -sine * op.scaleY, cosine * op.scaleY, 0, 0};
            result.tx = px + op.translationX - result.a * px - result.c * py;
            result.ty = py + op.translationY - result.b * px - result.d * py;
            return result;
        }

        // 当前变换与窗口坐标下的保守裁剪范围；裁剪取变换后矩形的外包盒，只会多画
        struct Scope {
            Affine transform;
            std::optional<Rect> clip;
        };

        // 返回外包盒；坐标非有限时返回空
        std::optional<Rect> project(const Rect& r, const Affine& transform) {
            double left = 0, top = 0, right = 0, bottom = 0;
            bool first = true;
            for (const double x : {static_cast<double>(r.x), static_cast<double>(r.x) + r.width})
                for (const double y : {static_cast<double>(r.y), static_cast<double>(r.y) + r.height}) {
                    const auto px = transform.a * x + transform.c * y + transform.tx;
                    const auto py = transform.b * x + transform.d * y + transform.ty;
                    if (!std::isfinite(px) || !std::isfinite(py)) return std::nullopt;
                    left = first ? px : std::min(left, px);
                    top = first ? py : std::min(top, py);
                    right = first ? px : std::max(right, px);
                    bottom = first ? py : std::max(bottom, py);
                    first = false;
                }
            return Rect{static_cast<float>(left), static_cast<float>(top), static_cast<float>(right - left), static_cast<float>(bottom - top)};
        }

        Rect intersect(const Rect& a, const Rect& b) {
            const auto left = std::max(a.x, b.x), top = std::max(a.y, b.y);
            const auto right = std::min(a.x + a.width, b.x + b.width), bottom = std::min(a.y + a.height, b.y + b.height);
            return {left, top, std::max(0.0f, right - left), std::max(0.0f, bottom - top)};
        }

        // 子片段与内容在 before 命令之后重放；before 中出现弹出或自定义绘制时无法给出单一作用域
        std::optional<Scope> enterLayer(const PaintLayerFragment& layer, Scope scope) {
            if (layer.drawCommands) return std::nullopt;
            for (const auto& op : layer.before) {
                if (op.type == DrawOpType::PushTransform) scope.transform = compose(scope.transform, opTransform(op));
                if (op.type == DrawOpType::PushClip) {
                    const auto clip = project(op.rect, scope.transform);
                    if (!clip) return std::nullopt;
                    scope.clip = scope.clip ? intersect(*scope.clip, *clip) : *clip;
                }
                if (op.type == DrawOpType::PopTransform || op.type == DrawOpType::PopClip) return std::nullopt;
            }
            return scope;
        }

        void addBounds(RepaintDamage& damage, PaintBounds bounds, const Scope& scope) {
            if (!bounds.known) {
                damage.markFull();
                return;
            }
            if (bounds.empty) return;
            auto rect = project(bounds.rect, scope.transform);
            if (!rect) {
                damage.markFull();
                return;
            }
            if (scope.clip) rect = intersect(*rect, *scope.clip);
            if (rect->width > 0 && rect->height > 0) damage.addRect(*rect);
        }

        Scope placedScope(const Scope& parent, Point offset) {
            return {compose(parent.transform, translation(offset)), parent.clip};
        }

        void addPlaced(RepaintDamage& damage, const PlacedPaintFragment& placed, const Scope& parent) {
            if (placed.fragment) addBounds(damage, placed.fragment->bounds, placedScope(parent, placed.offset));
        }

        void compare(RepaintDamage& damage, const PlacedPaintFragment& before, const PlacedPaintFragment& after, const Scope& parent) {
            if (damage.full() || (before.fragment == after.fragment && before.offset == after.offset)) return;
            const auto replaceWhole = [&] {
                addPlaced(damage, before, parent);
                addPlaced(damage, after, parent);
            };
            if (!before.fragment || !after.fragment || before.offset != after.offset) return replaceWhole();
            const auto& previous = *before.fragment;
            const auto& next = *after.fragment;
            if (previous.layer != next.layer || previous.content != next.content || previous.children.size() != next.children.size()) return replaceWhole();
            // 内容命令先于子片段重放，其中的状态命令会改变子片段作用域
            if (previous.content && std::any_of(previous.content->begin(), previous.content->end(), [](const DrawOp& op) { return op.type == DrawOpType::PushClip || op.type == DrawOpType::PushTransform; })) return replaceWhole();
            auto inner = placedScope(parent, before.offset);
            if (previous.layer) {
                const auto entered = enterLayer(*previous.layer, inner);
                if (!entered) return replaceWhole();
                inner = *entered;
            }
            for (std::size_t index = 0; index < previous.children.size(); ++index) compare(damage, previous.children[index], next.children[index], inner);
        }

        // 按重放顺序跟踪 clip / transform 状态栈，定位聚焦 Input 的叶项
        struct FieldSearch {
            RepaintDamage& damage;
            ModifierHandle field;
            bool found = false;

            void ops(const std::vector<DrawOp>& list, std::vector<Scope>& stack, const PaintFragment* markerOwner) {
                for (const auto& op : list) {
                    switch (op.type) {
                        case DrawOpType::PushTransform:
                            stack.push_back({compose(stack.back().transform, opTransform(op)), stack.back().clip});
                            break;
                        case DrawOpType::PushClip: {
                            auto next = stack.back();
                            if (const auto clip = project(op.rect, next.transform)) next.clip = next.clip ? intersect(*next.clip, *clip) : *clip;
                            stack.push_back(next);
                            break;
                        }
                        case DrawOpType::PopTransform:
                        case DrawOpType::PopClip:
                            if (stack.size() > 1) stack.pop_back();
                            break;
                        case DrawOpType::ContentMarker:
                            if (markerOwner)
                                for (const auto& child : markerOwner->children) placed(child, stack.back());
                            break;
                        case DrawOpType::DrawText:
                            if (op.inputText && op.textField == field) {
                                found = true;
                                addBounds(damage, {{op.rect.x - 2, op.rect.y - 2, op.rect.width + 4, op.rect.height + 4}, true, false}, stack.back());
                            }
                            break;
                        default:
                            break;
                    }
                }
            }

            void placed(const PlacedPaintFragment& target, const Scope& parent) {
                if (!target.fragment) return;
                const auto& fragment = *target.fragment;
                std::vector<Scope> stack{placedScope(parent, target.offset)};
                if (fragment.layer && fragment.layer->drawCommands) return ops(fragment.layer->before, stack, &fragment);
                if (fragment.layer) ops(fragment.layer->before, stack, nullptr);
                if (fragment.content) ops(*fragment.content, stack, nullptr);
                for (const auto& child : fragment.children) placed(child, stack.back());
            }
        };

        bool mergeable(const Rect& a, const Rect& b, float gap) {
            return a.x - gap <= b.x + b.width && b.x - gap <= a.x + a.width && a.y - gap <= b.y + b.height && b.y - gap <= a.y + a.height;
        }

        Rect unite(const Rect& a, const Rect& b) {
            const auto left = std::min(a.x, b.x), top = std::min(a.y, b.y);
            return {left, top, std::max(a.x + a.width, b.x + b.width) - left, std::max(a.y + a.height, b.y + b.height) - top};
        }

        // 并入可合并的区域；合并后的区域可能与更多区域相邻，继续吸收直到稳定
        void mergeInto(std::vector<Rect>& rects, Rect rect, float gap) {
            for (auto merged = true; merged;) {
                merged = false;
                for (std::size_t index = 0; index < rects.size(); ++index) {
                    if (!mergeable(rects[index], rect, gap)) continue;
                    rect = unite(rects[index], rect);
                    rects[index] = rects.back();
                    rects.pop_back();
                    merged = true;
                    break;
                }
            }
            rects.push_back(rect);
        }
    }

    void RepaintDamage::addRect(Rect rect) {
        if (full_) return;
        if (!std::isfinite(rect.x) || !std::isfinite(rect.y) || !std::isfinite(rect.width) || !std::isfinite(rect.height)) {
            markFull();
            return;
        }
        mergeInto(rects_, rect, limits_.mergeGap);
        if (rects_.size() > limits_.maxCollectedRects) markFull();
    }

    void RepaintDamage::compareScene(const PlacedPaintFragment& before, const PlacedPaintFragment& after) {
        compare(*this, before, after, {});
    }

    void RepaintDamage::addInputField(const PlacedPaintFragment& scene, ModifierHandle field) {
        if (full_ || !field.valid()) return;
        FieldSearch search{*this, field};
        search.placed(scene, {});
        if (!search.found) markFull();
    }

    RepaintRegion RepaintDamage::finish(Size viewport) const {
        if (full_ || !std::isfinite(viewport.width) || !std::isfinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) return {true, {}};
        // 外扩 1 PX 兜住抗锯齿并向外取整，再裁到视口
        std::vector<Rect> rects;
        for (const auto& rect : rects_) {
            const auto left = std::max(0.0f, std::floor(rect.x - 1));
            const auto top = std::max(0.0f, std::floor(rect.y - 1));
            const auto right = std::min(std::ceil(viewport.width), std::ceil(rect.x + rect.width + 1));
            const auto bottom = std::min(std::ceil(viewport.height), std::ceil(rect.y + rect.height + 1));
            // 外扩取整后可能新相邻，再合并一次
            if (right > left && bottom > top) mergeInto(rects, {left, top, right - left, bottom - top}, limits_.mergeGap);
        }
        double area = 0;
        for (const auto& rect : rects) area += static_cast<double>(rect.width) * rect.height;
        if (rects.size() > limits_.maxRects || area > static_cast<double>(limits_.maxAreaRatio) * viewport.width * viewport.height) return {true, {}};
        return {false, std::move(rects)};
    }
}
