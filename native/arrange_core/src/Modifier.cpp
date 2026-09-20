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
            if (input.style.fontSize <= 0 || input.style.lineHeight < 0) throw std::invalid_argument("文本字号必须大于零，行高不能为负数");
            if (input.minLines < 1 || input.maxLines < 0 || input.maxLines > 0 && input.maxLines < input.minLines) throw std::invalid_argument("文本行数范围无效");
            if (input.singleLine && (input.minLines != 1 || input.maxLines > 1)) throw std::invalid_argument("单行文本不能要求多行范围");
            if (input.textAlign != "Start" && input.textAlign != "Center" && input.textAlign != "End") throw std::invalid_argument("textAlign 文本对齐值无效：" + input.textAlign);
            if (input.overflow != "clip" && input.overflow != "ellipsis" && input.overflow != "visible") throw std::invalid_argument("文本溢出模式无效");
        }

        std::uint32_t invalidationMask(const ModifierValue& value) {
            if (std::holds_alternative<LayoutModifierSemantics>(value) || std::holds_alternative<ParentDataModifierSemantics>(value) || std::holds_alternative<AnimateContentSizeModifier>(value)) return kMeasure;
            if (std::holds_alternative<TextModifier>(value)) return kMeasure;
            if (std::holds_alternative<TextFieldModifier>(value)) return kMeasure | dirtyMask(DirtyFlag::EventSlot) | dirtyMask(DirtyFlag::Focus);
            if (std::holds_alternative<PaintModifier>(value)) return kMeasure | dirtyMask(DirtyFlag::Resource);
            if (std::holds_alternative<OffsetModifier>(value)) return kPlace;
            if (std::holds_alternative<PaintStyleSemantics>(value)) return kPaint;
            if (std::holds_alternative<InputModifierSemantics>(value)) return kHit | dirtyMask(DirtyFlag::EventSlot) | dirtyMask(DirtyFlag::Focus);
            return kPaint | kHit;
        }
    } // namespace

    std::string_view modifierKindName(const ModifierValue& value) {
        return std::visit([](const auto& input) -> std::string_view {
            using T = std::decay_t<decltype(input)>;
            if constexpr (std::is_same_v<T, LayoutModifierSemantics>) {
                constexpr std::string_view names[]{"padding", "width", "height", "size", "requiredWidth", "requiredHeight", "requiredSize", "fillMaxWidth", "fillMaxHeight", "fillMaxSize", "widthIn", "heightIn", "sizeIn", "defaultMinSize", "verticalScroll", "horizontalScroll"};
                return names[static_cast<std::size_t>(input.kind)];
            }
            if constexpr (std::is_same_v<T, PaintStyleSemantics>) {
                constexpr std::string_view names[]{"background", "border", "alpha"};
                return names[static_cast<std::size_t>(input.kind)];
            }
            if constexpr (std::is_same_v<T, InputModifierSemantics>) {
                constexpr std::string_view names[]{"clickable", "hoverable", "focusable"};
                return names[static_cast<std::size_t>(input.kind)];
            }
            if constexpr (std::is_same_v<T, ParentDataModifierSemantics>) return input.kind == ParentDataKind::Weight ? "weight" : "align";
            if constexpr (std::is_same_v<T, PaintModifier>) return "paint";
            if constexpr (std::is_same_v<T, TextModifier>) return "text";
            if constexpr (std::is_same_v<T, TextFieldModifier>) return "textField";
            if constexpr (std::is_same_v<T, ClipModifier>) return "clip";
            if constexpr (std::is_same_v<T, TransformModifierSemantics>) return "graphicsLayer";
            if constexpr (std::is_same_v<T, OffsetModifier>) return "offset";
            if constexpr (std::is_same_v<T, ZIndexModifier>) return "zIndex";
            if constexpr (std::is_same_v<T, AnimateContentSizeModifier>) return "animateContentSize";
            return "";
        }, value);
    }

    bool sameModifierKind(const ModifierValue& left, const ModifierValue& right) {
        if (left.index() != right.index()) return false;
        return std::visit([&](const auto& a) {
            using T = std::decay_t<decltype(a)>;
            if constexpr (requires { a.kind; }) return a.kind == std::get<T>(right).kind;
            return true;
        }, left);
    }

    void validateModifierValue(const ModifierValue& value) {
        std::visit([](const auto& input) {
            using T = std::decay_t<decltype(input)>;
            if constexpr (std::is_same_v<T, LayoutModifierSemantics>) {
                for (auto number : {input.padding.start, input.padding.top, input.padding.end, input.padding.bottom, input.value, input.width, input.height, input.fraction, input.minWidth, input.maxWidth, input.minHeight, input.maxHeight, input.scrollValue}) finite(number);
                if (input.padding.start < 0 || input.padding.top < 0 || input.padding.end < 0 || input.padding.bottom < 0 || input.value < 0 || input.width < 0 || input.height < 0 || input.scrollValue < 0) throw std::invalid_argument("Arrange Modifier size, padding and scroll inputs must be nonnegative");
                if (input.minWidth >= 0 && input.maxWidth >= 0 && input.minWidth > input.maxWidth) throw std::invalid_argument("Arrange Modifier minWidth exceeds maxWidth");
                if (input.minHeight >= 0 && input.maxHeight >= 0 && input.minHeight > input.maxHeight) throw std::invalid_argument("Arrange Modifier minHeight exceeds maxHeight");
            }
            else if constexpr (std::is_same_v<T, PaintStyleSemantics>) {
                for (auto number : {input.strokeWidth, input.cornerRadius, input.alpha}) finite(number);
                if (input.strokeWidth < 0 || input.cornerRadius < 0 || input.alpha < 0 || input.alpha > 1) throw std::invalid_argument("Arrange invalid paint Modifier input");
                if (!input.shapeType.empty() && input.shapeType != "rectangle" && input.shapeType != "rounded" && input.shapeType != "circle") throw std::invalid_argument("Arrange unknown Modifier shape");
            }
            else if constexpr (std::is_same_v<T, AnimateContentSizeModifier>) {
                const auto& spec = input.animationSpec;
                for (auto value : {spec.durationMillis, spec.delayMillis, spec.stiffness, spec.dampingRatio, spec.threshold}) finite(value);
                for (auto value : spec.bezier) finite(value);
                if (spec.durationMillis < 0 || spec.delayMillis < 0 || spec.stiffness <= 0 || spec.dampingRatio <= 0 || spec.threshold <= 0 || spec.bezier[0] < 0 || spec.bezier[0] > 1 || spec.bezier[2] < 0 || spec.bezier[2] > 1) throw std::invalid_argument("Arrange invalid content-size animation spec");
            }
            else if constexpr (std::is_same_v<T, PaintModifier>) {
                finite(input.alpha);
                if (input.alpha < 0 || input.alpha > 1) throw std::invalid_argument("paint alpha 必须在 0..1 之间");
                if (!isImageAlignment(input.alignment)) throw std::invalid_argument("paint 对齐值无效");
                if (input.contentScale != "Fit" && input.contentScale != "Crop" && input.contentScale != "FillBounds" && input.contentScale != "Inside" && input.contentScale != "None" && input.contentScale != "FillWidth" && input.contentScale != "FillHeight") throw std::invalid_argument("paint 缩放模式无效");
                if (input.painter.content && input.painter.content->intrinsicSize) {
                    const auto size = *input.painter.content->intrinsicSize;
                    finite(size.width);
                    finite(size.height);
                    if (size.width < 0 || size.height < 0) throw std::invalid_argument("Painter 固有尺寸不能为负数");
                }
            }
            else if constexpr (std::is_same_v<T, TextModifier>) validateTextPresentation(input);
            else if constexpr (std::is_same_v<T, TextFieldModifier>) validateTextPresentation(input.presentation);
            else if constexpr (std::is_same_v<T, ClipModifier>) validateModifierValue(input.shape);
            else if constexpr (std::is_same_v<T, TransformModifierSemantics>) {
                for (auto number : {input.translationX, input.translationY, input.scaleX, input.scaleY, input.rotationZ, input.transformOriginX, input.transformOriginY, input.alpha}) finite(number);
                if (input.alpha < 0 || input.alpha > 1) throw std::invalid_argument("Arrange graphicsLayer alpha must be within [0, 1]");
            }
            else if constexpr (std::is_same_v<T, OffsetModifier>) { finite(input.x); finite(input.y); }
            else if constexpr (std::is_same_v<T, ZIndexModifier>) finite(input.value);
            else if constexpr (std::is_same_v<T, ParentDataModifierSemantics>) {
                finite(input.weight);
                if (input.weight < 0) throw std::invalid_argument("Arrange weight must be nonnegative");
                if (input.kind == ParentDataKind::Align && !isImageAlignment(input.align) && input.align != "Baseline") throw std::invalid_argument("Arrange Modifier.align 不支持对齐值：'" + input.align + "'");
            }
        }, value);
    }

    std::uint32_t modifierInvalidation(const ModifierValue& before, const ModifierValue& after) {
        if (before == after) return 0;
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
                const auto oldSize = a->painter.content ? a->painter.content->intrinsicSize : std::nullopt;
                const auto newSize = b->painter.content ? b->painter.content->intrinsicSize : std::nullopt;
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
        // key 允许移动，无 key 按类型及相对次序匹配；FFI 回调和原生实例使用同一规则
        std::unordered_map<std::string, std::size_t> keyed;
        for (std::size_t i = 0; i < previous.size(); ++i) if (!previous[i]->key.empty()) keyed.emplace(previous[i]->key, i);
        std::vector<bool> used(previous.size(), false);
        std::vector<std::size_t> matches;
        matches.reserve(next.size());
        std::size_t cursor = 0;
        for (const auto& descriptor : next) {
            auto match = previous.size();
            if (!descriptor.key.empty()) {
                if (auto found = keyed.find(descriptor.key); found != keyed.end() && !used[found->second] && sameModifierKind(previous[found->second]->value, descriptor.value)) match = found->second;
            }
            else {
                for (auto i = cursor; i < previous.size(); ++i) {
                    if (!used[i] && previous[i]->key.empty() && sameModifierKind(previous[i]->value, descriptor.value)) { match = i; cursor = i + 1; break; }
                }
            }
            if (match < previous.size()) used[match] = true;
            matches.push_back(match);
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
            }
            else {
                // identity 在进程生命周期内不复用；generation 保留在协议中供显式代际校验
                next.push_back({{allocateRuntimeIdentity(), 1}, descriptor, {}, {}, {}, {}});
                result.dirty |= kMeasure;
            }
        }
        for (std::size_t i = 0; i < elements_.size(); ++i) {
            if (!used[i]) { result.retired.push_back(elements_[i].handle); result.dirty |= kMeasure; }
        }
        elements_ = std::move(next);
        return result;
    }

    ModifierInstance* ModifierChain::find(ModifierHandle handle) {
        for (auto& instance : elements_) if (instance.handle == handle) return &instance;
        return nullptr;
    }

    const ModifierInstance* ModifierChain::find(ModifierHandle handle) const {
        for (const auto& instance : elements_) if (instance.handle == handle) return &instance;
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
                if (input->kind == ParentDataKind::Weight) { result.weight = input->weight; result.weightFill = input->weightFill; }
                else result.align = input->align;
            }
        }
        return result;
    }

    float ModifierChain::zIndex() const {
        float result = 0;
        for (const auto& instance : elements_) if (const auto* input = std::get_if<ZIndexModifier>(&instance.descriptor.value)) result += input->value;
        return result;
    }
} // namespace arrange::core
