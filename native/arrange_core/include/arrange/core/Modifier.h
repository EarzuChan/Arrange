#pragma once

#include "EventSlot.h"
#include "Animation.h"
#include "Geometry.h"

#include <cstdint>
#include <memory>
#include <string>
#include <variant>
#include <vector>

namespace arrange::core {
    enum class DirtyFlag : std::uint32_t {
        Structure = 1,
        Layout = 2,
        Paint = 4,
        Transform = 8,
        HitTest = 16,
        Focus = 32,
        Accessibility = 64,
        Resource = 128,
        EventSlot = 256,
        Placement = 512,
    };

    inline constexpr std::uint32_t dirtyMask(DirtyFlag flag) noexcept { return static_cast<std::uint32_t>(flag); }

    struct ModifierPadding {
        float start = 0.0f;
        float top = 0.0f;
        float end = 0.0f;
        float bottom = 0.0f;
        bool operator==(const ModifierPadding&) const = default;
    };

    enum class LayoutModifierKind {
        Padding, Width, Height, Size, RequiredWidth, RequiredHeight, RequiredSize,
        FillMaxWidth, FillMaxHeight, FillMaxSize, WidthIn, HeightIn, SizeIn,
        DefaultMinSize, VerticalScroll, HorizontalScroll,
    };

    struct LayoutModifierSemantics {
        LayoutModifierKind kind = LayoutModifierKind::Padding;
        ModifierPadding padding;
        float value = 0.0f;
        float width = 0.0f;
        float height = 0.0f;
        float fraction = 1.0f;
        float minWidth = -1.0f;
        float maxWidth = -1.0f;
        float minHeight = -1.0f;
        float maxHeight = -1.0f;
        float scrollValue = 0.0f;
        bool enabled = true;
        EventSlotId eventSlot;
        bool operator==(const LayoutModifierSemantics&) const = default;
    };

    enum class ParentDataKind { Weight, Align };
    struct ParentDataModifierSemantics {
        ParentDataKind kind = ParentDataKind::Weight;
        float weight = 0.0f;
        bool weightFill = true;
        std::string align;
        bool operator==(const ParentDataModifierSemantics&) const = default;
    };

    enum class PaintStyleKind { Background, Border, Alpha, DropShadow, InnerShadow };
    struct PaintStyleSemantics {
        PaintStyleKind kind = PaintStyleKind::Background;
        std::uint32_t color = 0;
        float strokeWidth = 1.0f;
        std::string shapeType;
        float cornerRadius = 0.0f;
        float alpha = 1.0f;
        Point shadowOffset;
        bool operator==(const PaintStyleSemantics&) const = default;
    };

    struct ClipModifier {
        PaintStyleSemantics shape;
        bool operator==(const ClipModifier&) const = default;
    };

    enum class InputModifierKind { Clickable, Hoverable, Focusable };
    struct InputModifierSemantics {
        InputModifierKind kind = InputModifierKind::Clickable;
        bool enabled = true;
        bool focusable = true;
        EventSlotId eventSlot;
        bool operator==(const InputModifierSemantics&) const = default;
    };

    struct TransformModifierSemantics {
        float translationX = 0.0f;
        float translationY = 0.0f;
        float scaleX = 1.0f;
        float scaleY = 1.0f;
        float rotationZ = 0.0f;
        float transformOriginX = 0.5f;
        float transformOriginY = 0.5f;
        float alpha = 1.0f;
        bool clip = false;
        bool operator==(const TransformModifierSemantics&) const = default;
    };

    struct OffsetModifier {
        float x = 0.0f;
        float y = 0.0f;
        bool operator==(const OffsetModifier&) const = default;
    };

    struct ZIndexModifier {
        float value = 0.0f;
        bool operator==(const ZIndexModifier&) const = default;
    };

    struct AnimateContentSizeModifier {
        AnimationSpec animationSpec;
        bool clip = true;
        bool operator==(const AnimateContentSizeModifier&) const = default;
    };

    using ModifierValue = std::variant<LayoutModifierSemantics, PaintStyleSemantics, ClipModifier, InputModifierSemantics, TransformModifierSemantics, OffsetModifier, ParentDataModifierSemantics, ZIndexModifier, AnimateContentSizeModifier>;

    struct ModifierDescriptor {
        ModifierValue value;
        // 可选协调 key；key 与数组下标均不是更新目标的运行时身份。
        std::string key;
        bool operator==(const ModifierDescriptor&) const = default;
    };
    using ModifierDescriptors = std::vector<ModifierDescriptor>;

    struct ModifierHandle {
        std::uint64_t identity = 0;
        std::uint64_t generation = 0;
        bool valid() const noexcept { return identity != 0 && generation != 0; }
        bool operator==(const ModifierHandle&) const = default;
    };

    struct PaintLayerFragment;

    struct ModifierInstance {
        ModifierHandle handle;
        ModifierDescriptor descriptor;
        Size measured;
        Size childMeasured;
        Point childOffset;
        Rect bounds;
        std::shared_ptr<const PaintLayerFragment> paintCache;
        SizeAnimation sizeAnimation;
    };

    struct ModifierReconcileResult {
        std::uint32_t dirty = 0;
        std::vector<ModifierHandle> retired;
    };

    class ModifierChain {
    public:
        const std::vector<ModifierInstance>& elements() const noexcept { return elements_; }
        std::vector<ModifierInstance>& elements() noexcept { return elements_; }
        ModifierReconcileResult reconcile(const ModifierDescriptors& descriptors);
        ModifierInstance* find(ModifierHandle handle);
        const ModifierInstance* find(ModifierHandle handle) const;
        std::uint32_t update(ModifierHandle handle, const ModifierValue& value);
        ParentDataModifierSemantics parentData() const;
        float zIndex() const;

    private:
        std::vector<ModifierInstance> elements_;
    };

    inline EventSlotId modifierEventSlot(const ModifierValue& value) {
        if (const auto* input = std::get_if<InputModifierSemantics>(&value)) return input->eventSlot;
        if (const auto* layout = std::get_if<LayoutModifierSemantics>(&value)) return layout->eventSlot;
        return {};
    }

    std::string_view modifierKindName(const ModifierValue& value);
    bool sameModifierKind(const ModifierValue& left, const ModifierValue& right);
    void validateModifierDescriptors(const ModifierDescriptors& descriptors);
    void validateModifierValue(const ModifierValue& value);
    std::uint32_t modifierInvalidation(const ModifierValue& before, const ModifierValue& after);
} // namespace arrange::core
