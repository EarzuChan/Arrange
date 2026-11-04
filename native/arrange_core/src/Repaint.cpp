#include <arrange/core/Affine.h>
#include <arrange/core/Repaint.h>

#include <algorithm>
#include <cmath>
#include <optional>

namespace arrange::core {
    namespace {
        // 与 JUCE 重放一致的层变换
        Affine opTransform(const DrawOp& op) {
            return Affine::layer(op.rect, op.transformOriginX, op.transformOriginY, op.scaleX, op.scaleY, op.rotationZ, op.translationX, op.translationY);
        }

        // 当前变换与窗口坐标下的保守裁剪范围；裁剪取变换后矩形的外包盒，只会多画
        struct Scope {
            Affine transform;
            std::optional<Rect> clip;
        };

        // 子片段与内容在 before 命令之后重放；before 中出现弹出或自定义绘制时无法给出单一作用域
        std::optional<Scope> enterLayer(const PaintLayerFragment& layer, Scope scope) {
            if (layer.drawCommands) return std::nullopt;
            for (const auto& op : layer.before) {
                if (op.type == DrawOpType::PushTransform) scope.transform = scope.transform.after(opTransform(op));
                if (op.type == DrawOpType::PushClip) {
                    const auto clip = scope.transform.project(op.rect);
                    if (!clip) return std::nullopt;
                    scope.clip = scope.clip ? intersectRect(*scope.clip, *clip) : *clip;
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
            auto rect = scope.transform.project(bounds.rect);
            if (!rect) {
                damage.markFull();
                return;
            }
            if (scope.clip) rect = intersectRect(*rect, *scope.clip);
            if (rect->width > 0 && rect->height > 0) damage.addRect(*rect);
        }

        Scope placedScope(const Scope& parent, Point offset) {
            return {parent.transform.after(Affine::translation(offset.x, offset.y)), parent.clip};
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
            // 内容模糊把子片段的变化扩散到模糊半径内，不向下递归
            if (const auto* effect = previous.layer ? std::get_if<EffectModifier>(&previous.layer->value) : nullptr; effect && effect->kind == EffectKind::Blur) return replaceWhole();
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

        bool containsFragment(const PlacedPaintFragment& placed, const PaintFragment* target) {
            if (!placed.fragment) return false;
            if (placed.fragment.get() == target) return true;
            return std::any_of(placed.fragment->children.begin(), placed.fragment->children.end(), [&](const PlacedPaintFragment& child) { return containsFragment(child, target); });
        }

        // 与 compare 相同的比较，只收集重放顺序在目标片段之前的变化；目标自身的内容与子片段画在背景之上，不计入
        // 返回 true 表示已到达目标，后续兄弟不再比较
        bool compareUntil(RepaintDamage& damage, const PlacedPaintFragment& before, const PlacedPaintFragment& after, const Scope& parent, const PaintFragment* target) {
            if (damage.full()) return true;
            if (after.fragment.get() == target) return true;
            if (!containsFragment(after, target)) {
                compare(damage, before, after, parent);
                return false;
            }
            if (before.fragment == after.fragment && before.offset == after.offset) return true;
            const auto replaceWhole = [&] {
                addPlaced(damage, before, parent);
                addPlaced(damage, after, parent);
                return true;
            };
            if (!before.fragment || before.offset != after.offset) return replaceWhole();
            const auto& previous = *before.fragment;
            const auto& next = *after.fragment;
            if (previous.layer != next.layer || previous.content != next.content || previous.children.size() != next.children.size()) return replaceWhole();
            if (const auto* effect = previous.layer ? std::get_if<EffectModifier>(&previous.layer->value) : nullptr; effect && effect->kind == EffectKind::Blur) return replaceWhole();
            if (previous.content && std::any_of(previous.content->begin(), previous.content->end(), [](const DrawOp& op) { return op.type == DrawOpType::PushClip || op.type == DrawOpType::PushTransform; })) return replaceWhole();
            auto inner = placedScope(parent, before.offset);
            if (previous.layer) {
                const auto entered = enterLayer(*previous.layer, inner);
                if (!entered) return replaceWhole();
                inner = *entered;
            }
            for (std::size_t index = 0; index < previous.children.size(); ++index)
                if (compareUntil(damage, previous.children[index], next.children[index], inner, target)) return true;
            return true;
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
                            stack.push_back({stack.back().transform.after(opTransform(op)), stack.back().clip});
                            break;
                        case DrawOpType::PushClip: {
                            auto next = stack.back();
                            if (const auto clip = next.transform.project(op.rect)) next.clip = next.clip ? intersectRect(*next.clip, *clip) : *clip;
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

        // 收集背景模糊层：采样范围取输出外扩三倍标准差，与重放一致
        struct BackdropSearch {
            struct Backdrop {
                const PaintFragment* fragment;
                Rect output;
                Rect sample;
            };

            std::vector<Backdrop> found;
            bool unknown = false;

            void placed(const PlacedPaintFragment& target, const Scope& parent) {
                if (!target.fragment || unknown) return;
                const auto& fragment = *target.fragment;
                auto scope = placedScope(parent, target.offset);
                if (fragment.layer) {
                    if (const auto* effect = std::get_if<EffectModifier>(&fragment.layer->value); effect && effect->kind == EffectKind::BackdropBlur) {
                        const auto margin = effectSigma(*effect) * 3.0f;
                        const auto& rect = fragment.layer->bounds;
                        auto output = scope.transform.project(rect);
                        auto sample = scope.transform.project({rect.x - margin, rect.y - margin, rect.width + margin * 2, rect.height + margin * 2});
                        if (!output || !sample) {
                            unknown = true;
                            return;
                        }
                        if (scope.clip) output = intersectRect(*output, *scope.clip);
                        found.push_back({&fragment, *output, *sample});
                    }
                    const auto entered = enterLayer(*fragment.layer, scope);
                    // 无法给出单一作用域的层按变换前范围保守处理
                    if (entered) scope = *entered;
                }
                for (const auto& child : fragment.children) placed(child, scope);
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
        RepaintDamage local(limits_);
        FieldSearch search{local, field};
        search.placed(scene, {});
        if (!search.found || local.full()) return markFull();
        for (const auto& rect : local.rects_) {
            unordered_.push_back(rect);
            addRect(rect);
        }
    }

    bool RepaintDamage::intersects(const Rect& rect) const {
        if (full_) return true;
        const auto hit = [&](const Rect& other) {
            const auto overlap = intersectRect(other, rect);
            return overlap.width > 0 && overlap.height > 0;
        };
        return std::any_of(rects_.begin(), rects_.end(), hit) || std::any_of(unordered_.begin(), unordered_.end(), hit);
    }

    void RepaintDamage::addBackdrops(const PlacedPaintFragment& before, const PlacedPaintFragment& after) {
        if (full_) return;
        BackdropSearch search;
        search.placed(after, {});
        if (search.unknown) return markFull();
        // 搜索按重放顺序给出背景模糊；之前已牵动的背景模糊输出也画在后者之前
        RepaintDamage earlier(limits_);
        earlier.unordered_ = unordered_;
        for (const auto& backdrop : search.found) {
            if (full_) return;
            RepaintDamage prefix(limits_);
            compareUntil(prefix, before, after, {}, backdrop.fragment);
            if (!prefix.intersects(backdrop.sample) && !earlier.intersects(backdrop.sample)) continue;
            earlier.addRect(backdrop.output);
            addRect(backdrop.output);
        }
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
