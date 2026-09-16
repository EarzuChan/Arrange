#include <arrange/core/Modifier.h>
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

        std::uint32_t capabilities(const ModifierValue& value) {
            if (std::holds_alternative<LayoutModifierSemantics>(value) || std::holds_alternative<ParentDataModifierSemantics>(value)) return kMeasure;
            if (std::holds_alternative<OffsetModifier>(value)) return kPlace;
            if (std::holds_alternative<PaintStyleSemantics>(value)) return kPaint;
            if (std::holds_alternative<InputModifierSemantics>(value)) return kHit | dirtyMask(DirtyFlag::EventSlot) | dirtyMask(DirtyFlag::Focus);
            return kPaint | kHit;
        }
    } // namespace

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
                for (auto number : {input.strokeWidth, input.cornerRadius, input.alpha, input.shadowOffset.x, input.shadowOffset.y}) finite(number);
                if (input.strokeWidth < 0 || input.cornerRadius < 0 || input.alpha < 0 || input.alpha > 1) throw std::invalid_argument("Arrange invalid paint Modifier input");
                if (!input.shapeType.empty() && input.shapeType != "rectangle" && input.shapeType != "rounded" && input.shapeType != "circle") throw std::invalid_argument("Arrange unknown Modifier shape");
            }
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
            }
        }, value);
    }

    std::uint32_t modifierInvalidation(const ModifierValue& before, const ModifierValue& after) {
        if (before == after) return 0;
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
        if (const auto* a = std::get_if<InputModifierSemantics>(&before)) {
            if (const auto* b = std::get_if<InputModifierSemantics>(&after); b && a->kind == b->kind && a->enabled == b->enabled && a->focusable == b->focusable) return dirtyMask(DirtyFlag::EventSlot) | kHit;
        }
        return capabilities(before) | capabilities(after);
    }

    void validateModifierDescriptors(const ModifierDescriptors& descriptors) {
        std::unordered_set<std::string> keys;
        for (const auto& descriptor : descriptors) {
            validateModifierValue(descriptor.value);
            if (!descriptor.key.empty() && !keys.insert(descriptor.key).second) throw std::invalid_argument("Arrange duplicate Modifier key: " + descriptor.key);
        }
    }

    ModifierReconcileResult ModifierChain::reconcile(const ModifierDescriptors& descriptors) {
        validateModifierDescriptors(descriptors);
        // 有 key 的元素允许移动；无 key 的元素按类型及相对次序协调。
        // 使用前缀直通和线性查找，避免给每个高频值更新分配 O(n*m) DP 表。
        std::unordered_map<std::string, std::size_t> keyed;
        for (std::size_t i = 0; i < elements_.size(); ++i) if (!elements_[i].descriptor.key.empty()) keyed.emplace(elements_[i].descriptor.key, i);
        std::vector<bool> used(elements_.size(), false);
        std::vector<ModifierInstance> next;
        next.reserve(descriptors.size());
        ModifierReconcileResult result;
        std::size_t cursor = 0;
        for (const auto& descriptor : descriptors) {
            auto match = elements_.size();
            if (!descriptor.key.empty()) {
                if (auto found = keyed.find(descriptor.key); found != keyed.end() && sameModifierKind(elements_[found->second].descriptor.value, descriptor.value)) match = found->second;
            }
            else {
                for (auto i = cursor; i < elements_.size(); ++i) {
                    if (!used[i] && elements_[i].descriptor.key.empty() && sameModifierKind(elements_[i].descriptor.value, descriptor.value)) { match = i; cursor = i + 1; break; }
                }
            }
            if (match < elements_.size()) {
                used[match] = true;
                auto instance = elements_[match];
                result.dirty |= modifierInvalidation(instance.descriptor.value, descriptor.value);
                if (match != next.size()) result.dirty |= kMeasure;
                instance.descriptor = descriptor;
                next.push_back(std::move(instance));
            }
            else {
                // identity 在进程生命周期内不复用；generation 保留在协议中供显式代际校验。
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
