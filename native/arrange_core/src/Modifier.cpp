#include <arrange/core/Modifier.h>
#include <arrange/core/Alignment.h>
#include <arrange/core/SlotUpdate.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>

namespace arrange::core {
    namespace {
        constexpr auto kPaint = dirtyMask(DirtyFlag::Paint);
        constexpr auto kHit = dirtyMask(DirtyFlag::HitTest);
        constexpr auto kPlace = dirtyMask(DirtyFlag::Placement) | kPaint | kHit;
        constexpr auto kMeasure = dirtyMask(DirtyFlag::Layout) | kPlace;

        void finite(float value) {
            if (!std::isfinite(value)) throw std::invalid_argument("Arrange Modifier input must be finite");
        }

        void validateTextPresentation(const TextPresentation& input) {
            finite(input.style.fontSize);
            finite(input.style.lineHeight);
            if (input.style.fontWeight < minFontWeight || input.style.fontWeight > maxFontWeight) throw std::invalid_argument("字重必须在 1 到 1000 之间");
            if (input.style.fontSize <= 0 || input.style.lineHeight < 0) throw std::invalid_argument("文本字号必须大于零，行高不能为负数");
            if (input.minLines < 1 || input.maxLines < 0 || input.maxLines > 0 && input.maxLines < input.minLines) throw std::invalid_argument("文本行数范围无效");
            if (input.singleLine && (input.minLines != 1 || input.maxLines > 1)) throw std::invalid_argument("单行文本不能要求多行范围");
        }

        std::uint32_t invalidationMask(const ModifierValue& value) {
            if (std::holds_alternative<LayoutModifierSemantics>(value) || std::holds_alternative<ParentDataModifierSemantics>(value) || std::holds_alternative<AnimateContentSizeModifier>(value)) return kMeasure;
            if (std::holds_alternative<TextModifier>(value)) return kMeasure;
            if (std::holds_alternative<TextFieldModifier>(value)) return kMeasure | dirtyMask(DirtyFlag::EventSlot) | dirtyMask(DirtyFlag::Focus);
            if (std::holds_alternative<PaintModifier>(value)) return kMeasure | dirtyMask(DirtyFlag::Resource);
            if (std::holds_alternative<OffsetModifier>(value)) return kPlace;
            if (std::holds_alternative<PaintStyleSemantics>(value) || std::holds_alternative<EffectModifier>(value)) return kPaint;
            if (std::holds_alternative<DrawModifier>(value)) return kPaint | dirtyMask(DirtyFlag::EventSlot);
            if (std::holds_alternative<InputModifierSemantics>(value)) return kHit | dirtyMask(DirtyFlag::EventSlot) | dirtyMask(DirtyFlag::Focus);
            if (std::holds_alternative<FocusModifier>(value)) return dirtyMask(DirtyFlag::Focus) | dirtyMask(DirtyFlag::EventSlot);
            if (std::holds_alternative<SemanticsModifier>(value)) return dirtyMask(DirtyFlag::Accessibility) | dirtyMask(DirtyFlag::EventSlot);
            return kPaint | kHit;
        }
    }

    std::string_view modifierKindName(const ModifierValue& value) {
        return std::visit(
            [](const auto& input) -> std::string_view {
                using T = std::decay_t<decltype(input)>;
                if constexpr (std::is_same_v<T, LayoutModifierSemantics>) {
                    constexpr std::string_view names[]{"padding", "width", "height", "size", "requiredWidth", "requiredHeight", "requiredSize", "fillMaxWidth", "fillMaxHeight", "fillMaxSize", "widthIn", "heightIn", "sizeIn", "defaultMinSize", "verticalScroll", "horizontalScroll", "intrinsicWidth", "intrinsicHeight"};
                    return names[static_cast<std::size_t>(input.kind)];
                }
                if constexpr (std::is_same_v<T, PaintStyleSemantics>) {
                    constexpr std::string_view names[]{"background", "border", "alpha"};
                    return names[static_cast<std::size_t>(input.kind)];
                }
                if constexpr (std::is_same_v<T, InputModifierSemantics>) {
                    constexpr std::string_view names[]{"clickable", "hoverable", "focusable", "onContextClick", "pointerIcon", "onKeyEvent", "onWheel", "draggable", "pointerInput"};
                    return names[static_cast<std::size_t>(input.kind)];
                }
                if constexpr (std::is_same_v<T, FocusModifier>) {
                    constexpr std::string_view names[]{"focusRequester", "focusProperties", "focusGroup", "onFocusChanged"};
                    return names[static_cast<std::size_t>(input.kind)];
                }
                if constexpr (std::is_same_v<T, ParentDataModifierSemantics>) return input.kind == ParentDataKind::Weight ? "weight" : input.kind == ParentDataKind::Align ? "align" : "matchParentSize";
                if constexpr (std::is_same_v<T, PaintModifier>) return "paint";
                if constexpr (std::is_same_v<T, TextModifier>) return "text";
                if constexpr (std::is_same_v<T, TextFieldModifier>) return "textField";
                if constexpr (std::is_same_v<T, ClipModifier>) return "clip";
                if constexpr (std::is_same_v<T, TransformModifierSemantics>) return "graphicsLayer";
                if constexpr (std::is_same_v<T, OffsetModifier>) return "offset";
                if constexpr (std::is_same_v<T, ZIndexModifier>) return "zIndex";
                if constexpr (std::is_same_v<T, AnimateContentSizeModifier>) return "animateContentSize";
                if constexpr (std::is_same_v<T, SemanticsModifier>) return "semantics";
                if constexpr (std::is_same_v<T, EffectModifier>) {
                    constexpr std::string_view names[]{"dropShadow", "innerShadow", "blur", "backdropBlur"};
                    return names[static_cast<std::size_t>(input.kind)];
                }
                if constexpr (std::is_same_v<T, DrawModifier>) {
                    constexpr std::string_view names[]{"drawBehind", "drawWithContent", "drawWithCache"};
                    return names[static_cast<std::size_t>(input.kind)];
                }
                return "";
            },
            value);
    }

    bool sameModifierKind(const ModifierValue& left, const ModifierValue& right) {
        if (left.index() != right.index()) return false;
        return std::visit(
            [&](const auto& a) {
                using T = std::decay_t<decltype(a)>;
                if constexpr (requires { a.kind; }) return a.kind == std::get<T>(right).kind;
                return true;
            },
            left);
    }

    void validateModifierValue(const ModifierValue& value) {
        std::visit(
            [](const auto& input) {
                using T = std::decay_t<decltype(input)>;
                if constexpr (std::is_same_v<T, LayoutModifierSemantics>) {
                    for (auto number : {input.padding.start, input.padding.top, input.padding.end, input.padding.bottom, input.value, input.width, input.height, input.fraction, input.minWidth, input.maxWidth, input.minHeight, input.maxHeight, input.scrollValue}) finite(number);
                    if (input.padding.start < 0 || input.padding.top < 0 || input.padding.end < 0 || input.padding.bottom < 0 || input.value < 0 || input.width < 0 || input.height < 0 || input.scrollValue < 0) throw std::invalid_argument("Arrange Modifier size, padding and scroll inputs must be nonnegative");
                    if (input.minWidth >= 0 && input.maxWidth >= 0 && input.minWidth > input.maxWidth) throw std::invalid_argument("Arrange Modifier minWidth exceeds maxWidth");
                    if (input.minHeight >= 0 && input.maxHeight >= 0 && input.minHeight > input.maxHeight) throw std::invalid_argument("Arrange Modifier minHeight exceeds maxHeight");
                } else if constexpr (std::is_same_v<T, PaintStyleSemantics>) {
                    const auto& corners = input.corners;
                    for (auto number : {input.strokeWidth, corners.topStart, corners.topEnd, corners.bottomEnd, corners.bottomStart, input.alpha}) finite(number);
                    if (input.strokeWidth < 0 || corners.topStart < 0 || corners.topEnd < 0 || corners.bottomEnd < 0 || corners.bottomStart < 0 || input.alpha < 0 || input.alpha > 1) throw std::invalid_argument("Arrange invalid paint Modifier input");
                } else if constexpr (std::is_same_v<T, AnimateContentSizeModifier>) {
                    const auto& spec = input.animationSpec;
                    for (auto value : {spec.durationMillis, spec.delayMillis, spec.stiffness, spec.dampingRatio, spec.threshold}) finite(value);
                    for (auto value : spec.bezier) finite(value);
                    if (spec.durationMillis < 0 || spec.delayMillis < 0 || spec.stiffness <= 0 || spec.dampingRatio <= 0 || spec.threshold <= 0 || spec.bezier[0] < 0 || spec.bezier[0] > 1 || spec.bezier[2] < 0 || spec.bezier[2] > 1) throw std::invalid_argument("Arrange invalid content-size animation spec");
                    if (spec.iterations < 1 || spec.kind == AnimationKind::Spring && (spec.iterations != 1 || spec.reverse)) throw std::invalid_argument("有限重复动画需要正次数及 tween 或 snap");
                } else if constexpr (std::is_same_v<T, PaintModifier>) {
                    finite(input.alpha);
                    if (input.alpha < 0 || input.alpha > 1) throw std::invalid_argument("paint alpha 必须在 0..1 之间");
                    if (input.painter.content && input.painter.content->intrinsicSize) {
                        const auto size = *input.painter.content->intrinsicSize;
                        finite(size.width);
                        finite(size.height);
                        if (size.width < 0 || size.height < 0) throw std::invalid_argument("Painter 固有尺寸不能为负数");
                    }
                    validatePainterView(input.painter, input.repeat, input.slices);
                } else if constexpr (std::is_same_v<T, TextModifier>)
                    validateTextPresentation(input);
                else if constexpr (std::is_same_v<T, TextFieldModifier>)
                    validateTextPresentation(input.presentation);
                else if constexpr (std::is_same_v<T, ClipModifier>)
                    validateModifierValue(input.shape);
                else if constexpr (std::is_same_v<T, TransformModifierSemantics>) {
                    for (auto number : {input.translationX, input.translationY, input.scaleX, input.scaleY, input.rotationZ, input.transformOriginX, input.transformOriginY, input.alpha}) finite(number);
                    if (input.alpha < 0 || input.alpha > 1) throw std::invalid_argument("Arrange graphicsLayer alpha must be within [0, 1]");
                } else if constexpr (std::is_same_v<T, OffsetModifier>) {
                    finite(input.x);
                    finite(input.y);
                } else if constexpr (std::is_same_v<T, ZIndexModifier>)
                    finite(input.value);
                else if constexpr (std::is_same_v<T, EffectModifier>) {
                    for (auto number : {input.radius, input.spread, input.offset.x, input.offset.y}) finite(number);
                    if (input.radius < 0 || input.radius > 1000) throw std::invalid_argument("阴影与模糊半径需要在 0 到 1000 PX 之间");
                    if (std::abs(input.spread) > 10000) throw std::invalid_argument("阴影扩展超出范围");
                    validateModifierValue(input.shape);
                } else if constexpr (std::is_same_v<T, ParentDataModifierSemantics>) {
                    finite(input.weight);
                    if (input.kind == ParentDataKind::Weight && input.weight <= 0) throw std::invalid_argument("weight 必须为正数");
                    if (input.kind == ParentDataKind::Align && !input.align) throw std::invalid_argument("Arrange Modifier.align 缺少对齐值");
                }
            },
            value);
    }

    std::uint32_t modifierInvalidation(const ModifierValue& before, const ModifierValue& after) {
        if (before == after) return 0;
        if (const auto* a = std::get_if<DrawModifier>(&before))
            if (const auto* b = std::get_if<DrawModifier>(&after)) return kPaint | (a->prepare != b->prepare ? dirtyMask(DirtyFlag::EventSlot) : 0u);
        if (const auto* a = textPresentation(before)) {
            if (const auto* b = textPresentation(after); b && sameModifierKind(before, after)) {
                auto previous = *a;
                previous.color = b->color;
                previous.textAlign = b->textAlign;
                if (previous == *b) {
                    auto dirty = a->color != b->color || a->textAlign != b->textAlign ? kPaint : 0u;
                    if (modifierText(before) != modifierText(after)) dirty |= kMeasure;
                    if (const auto* field = std::get_if<TextFieldModifier>(&before)) {
                        const auto& next = std::get<TextFieldModifier>(after);
                        if (field->value != next.value || field->placeholder != next.placeholder) dirty |= kMeasure;
                        if (field->enabled != next.enabled) dirty |= kHit | dirtyMask(DirtyFlag::Focus);
                        if (field->onValueChange != next.onValueChange || field->onSubmit != next.onSubmit || field->onChange != next.onChange || field->onBlur != next.onBlur) dirty |= dirtyMask(DirtyFlag::EventSlot);
                    }
                    return dirty;
                }
            }
        }
        if (const auto* a = std::get_if<PaintModifier>(&before)) {
            if (const auto* b = std::get_if<PaintModifier>(&after)) {
                const auto oldSize = painterIntrinsicSize(a->painter);
                const auto newSize = painterIntrinsicSize(b->painter);
                if (a->sizeToIntrinsics == b->sizeToIntrinsics && (!a->sizeToIntrinsics || oldSize == newSize)) return kPaint | dirtyMask(DirtyFlag::Resource);
            }
        }
        if (const auto* a = std::get_if<LayoutModifierSemantics>(&before)) {
            if (const auto* b = std::get_if<LayoutModifierSemantics>(&after); b && a->kind == b->kind) {
                auto previous = *a;
                previous.scrollValue = b->scrollValue;
                previous.eventSlot = b->eventSlot;
                previous.enabled = b->enabled;
                if (previous == *b) {
                    auto dirty = a->eventSlot == b->eventSlot ? 0u : dirtyMask(DirtyFlag::EventSlot);
                    if (a->scrollValue != b->scrollValue || a->enabled != b->enabled) dirty |= kPlace;
                    return dirty;
                }
            }
        }
        if (const auto* a = std::get_if<TransformModifierSemantics>(&before)) {
            if (const auto* b = std::get_if<TransformModifierSemantics>(&after)) {
                auto previous = *a;
                previous.alpha = b->alpha;
                if (previous == *b) return kPaint;
            }
        }
        if (const auto* a = std::get_if<ParentDataModifierSemantics>(&before)) {
            if (const auto* b = std::get_if<ParentDataModifierSemantics>(&after); b && a->kind == ParentDataKind::Align && b->kind == ParentDataKind::Align) return kPlace;
        }
        if (const auto* a = std::get_if<InputModifierSemantics>(&before)) {
            if (const auto* b = std::get_if<InputModifierSemantics>(&after); b && a->kind == b->kind && a->enabled == b->enabled && a->focusable == b->focusable) return dirtyMask(DirtyFlag::EventSlot) | kHit;
        }
        return invalidationMask(before) | invalidationMask(after);
    }

    void validateModifierDescriptors(const ModifierDescriptors& descriptors) {
        std::unordered_set<std::string> keys;
        for (const auto& descriptor : descriptors) {
            validateModifierValue(descriptor.value);
            if (!descriptor.key.empty() && !keys.insert(descriptor.key).second) throw std::invalid_argument("Arrange duplicate Modifier key: " + descriptor.key);
        }
    }

    std::vector<std::size_t> matchModifierDescriptors(std::span<const ModifierDescriptor* const> previous, const ModifierDescriptors& next) {
        // key 允许移动；无 key 元素按类型求最长公共子序列，插入或移除其它元素不会让后续元素错配重建
        // FFI 回调和原生实例使用同一规则
        std::vector<std::size_t> matches(next.size(), previous.size());
        std::unordered_map<std::string, std::size_t> keyed;
        for (std::size_t i = 0; i < previous.size(); ++i)
            if (!previous[i]->key.empty()) keyed.emplace(previous[i]->key, i);
        std::vector<std::size_t> before;
        std::vector<std::size_t> after;
        for (std::size_t i = 0; i < previous.size(); ++i)
            if (previous[i]->key.empty()) before.push_back(i);
        for (std::size_t j = 0; j < next.size(); ++j) {
            if (next[j].key.empty()) {
                after.push_back(j);
            } else if (auto found = keyed.find(next[j].key); found != keyed.end() && sameModifierKind(previous[found->second]->value, next[j].value)) {
                matches[j] = found->second;
            }
        }
        const auto same = [&](std::size_t i, std::size_t j) {
            return sameModifierKind(previous[before[i]]->value, next[after[j]].value);
        };
        // 常见情形是形状不变，逐位同类直接对应
        if (before.size() == after.size()) {
            auto aligned = true;
            for (std::size_t k = 0; aligned && k < before.size(); ++k) aligned = same(k, k);
            if (aligned) {
                for (std::size_t k = 0; k < before.size(); ++k) matches[after[k]] = before[k];
                return matches;
            }
        }
        // 后缀表：lengths[i][j] 为 before[i..] 与 after[j..] 的最长同类子序列长度
        const auto width = after.size() + 1;
        std::vector<std::uint32_t> lengths((before.size() + 1) * width, 0);
        for (auto i = before.size(); i-- > 0;)
            for (auto j = after.size(); j-- > 0;) lengths[i * width + j] = same(i, j) ? lengths[(i + 1) * width + j + 1] + 1 : std::max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
        std::size_t i = 0;
        std::size_t j = 0;
        while (i < before.size() && j < after.size()) {
            if (same(i, j) && lengths[i * width + j] == lengths[(i + 1) * width + j + 1] + 1) {
                matches[after[j]] = before[i];
                ++i;
                ++j;
            } else if (lengths[i * width + j + 1] >= lengths[(i + 1) * width + j]) {
                ++j;
            } else {
                ++i;
            }
        }
        return matches;
    }

    ModifierReconcileResult ModifierChain::reconcile(const ModifierDescriptors& descriptors) {
        validateModifierDescriptors(descriptors);
        std::vector<const ModifierDescriptor*> previous;
        previous.reserve(elements_.size());
        for (const auto& instance : elements_) previous.push_back(&instance.descriptor);
        const auto matches = matchModifierDescriptors(previous, descriptors);
        std::vector<bool> used(elements_.size(), false);
        std::vector<ModifierInstance> next;
        next.reserve(descriptors.size());
        ModifierReconcileResult result;
        for (std::size_t index = 0; index < descriptors.size(); ++index) {
            const auto& descriptor = descriptors[index];
            const auto match = matches[index];
            if (match < elements_.size()) {
                used[match] = true;
                auto instance = elements_[match];
                result.dirty |= modifierInvalidation(instance.descriptor.value, descriptor.value);
                if (match != next.size()) result.dirty |= kMeasure;
                instance.descriptor = descriptor;
                next.push_back(std::move(instance));
            } else {
                // identity 在进程生命周期内不复用；generation 保留在协议中供显式代际校验
                next.push_back({{allocateRuntimeIdentity(), 1}, descriptor, {}, {}, {}, {}});
                result.dirty |= kMeasure;
            }
        }
        for (std::size_t i = 0; i < elements_.size(); ++i) {
            if (!used[i]) {
                result.retired.push_back(elements_[i].handle);
                result.dirty |= kMeasure;
            }
        }
        elements_ = std::move(next);
        return result;
    }

    ModifierInstance* ModifierChain::find(ModifierHandle handle) {
        for (auto& instance : elements_)
            if (instance.handle == handle) return &instance;
        return nullptr;
    }

    const ModifierInstance* ModifierChain::find(ModifierHandle handle) const {
        for (const auto& instance : elements_)
            if (instance.handle == handle) return &instance;
        return nullptr;
    }

    std::uint32_t ModifierChain::update(ModifierHandle handle, const ModifierValue& value) {
        auto* instance = find(handle);
        if (!instance) throw std::invalid_argument("Arrange stale Modifier handle");
        if (!sameModifierKind(instance->descriptor.value, value)) throw std::invalid_argument("Arrange Modifier slot cannot change element kind");
        validateModifierValue(value);
        const auto dirty = modifierInvalidation(instance->descriptor.value, value);
        instance->descriptor.value = value;
        return dirty;
    }

    ParentDataModifierSemantics ModifierChain::parentData() const {
        ParentDataModifierSemantics result;
        for (const auto& instance : elements_) {
            if (const auto* input = std::get_if<ParentDataModifierSemantics>(&instance.descriptor.value)) {
                if (input->kind == ParentDataKind::Weight) {
                    result.weight = input->weight;
                    result.weightFill = input->weightFill;
                } else if (input->kind == ParentDataKind::Align)
                    result.align = input->align;
                else
                    result.matchParentSize = true;
            }
        }
        return result;
    }

    float ModifierChain::zIndex() const {
        float result = 0;
        for (const auto& instance : elements_)
            if (const auto* input = std::get_if<ZIndexModifier>(&instance.descriptor.value)) result += input->value;
        return result;
    }

    Rect effectOutputBounds(const EffectModifier& effect, Rect layer) noexcept {
        if (effect.kind != EffectKind::DropShadow) return layer;
        const auto margin = std::max(0.0f, effect.spread) + effectSigma(effect) * 3.0f;
        const Rect shadow{layer.x + effect.offset.x - margin, layer.y + effect.offset.y - margin, layer.width + margin * 2, layer.height + margin * 2};
        const auto left = std::min(layer.x, shadow.x), top = std::min(layer.y, shadow.y);
        return {left, top, std::max(layer.x + layer.width, shadow.x + shadow.width) - left, std::max(layer.y + layer.height, shadow.y + shadow.height) - top};
    }

    void validatePainterView(const PainterSnapshot& painter, ImageRepeat repeat, const ImageSlices& slices) {
        if (painter.frames < 1 || painter.frames > 4096 || painter.frame >= painter.frames) throw std::invalid_argument("filmstrip 帧数需要在 1 到 4096 之间，帧下标不能越界");
        if (repeat != ImageRepeat::NinePatch) return;
        for (const auto value : {slices.left, slices.top, slices.right, slices.bottom})
            if (!std::isfinite(value) || value < 0) throw std::invalid_argument("九宫格切分需要非负有限数值");
        if (const auto size = painterIntrinsicSize(painter); size && (slices.left + slices.right > size->width || slices.top + slices.bottom > size->height)) throw std::invalid_argument("九宫格切分超过图片固有尺寸");
    }
}
