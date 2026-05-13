#include <arrange/core/Modifier.h>

#include <cmath>

namespace arrange::core {
    namespace {
        bool sameSlot(const EventSlotId& left, const EventSlotId& right) {
            return left.node == right.node && left.kind == right.kind && left.path == right.path;
        }

        bool samePadding(const ModifierPadding& left, const ModifierPadding& right) {
            return left.start == right.start && left.top == right.top && left.end == right.end && left.bottom == right.bottom;
        }

        bool sameLayout(const LayoutModifierSemantics& left, const LayoutModifierSemantics& right) {
            return left.kind == right.kind &&
                samePadding(left.padding, right.padding) &&
                left.value == right.value &&
                left.width == right.width &&
                left.height == right.height &&
                left.fraction == right.fraction &&
                left.minWidth == right.minWidth &&
                left.maxWidth == right.maxWidth &&
                left.minHeight == right.minHeight &&
                left.maxHeight == right.maxHeight &&
                left.scrollValue == right.scrollValue;
        }

        bool samePaintStyle(const PaintStyleSemantics& left, const PaintStyleSemantics& right) {
            return left.kind == right.kind &&
                left.inset.x == right.inset.x &&
                left.inset.y == right.inset.y &&
                left.inset.width == right.inset.width &&
                left.inset.height == right.inset.height &&
                left.color == right.color &&
                left.brush == right.brush &&
                left.strokeWidth == right.strokeWidth &&
                left.shapeType == right.shapeType &&
                left.cornerRadius == right.cornerRadius &&
                left.alpha == right.alpha &&
                left.shadowOffset.x == right.shadowOffset.x &&
                left.shadowOffset.y == right.shadowOffset.y;
        }

        bool samePaintChainOp(const PaintChainOp& left, const PaintChainOp& right) {
            return left.kind == right.kind && samePaintStyle(left.style, right.style) && samePadding(left.padding, right.padding);
        }

        template <typename T, typename Equal>
        bool sameVector(const std::vector<T>& left, const std::vector<T>& right, Equal equal) {
            if (left.size() != right.size()) return false;
            for (std::size_t i = 0; i < left.size(); ++i) {
                if (!equal(left[i], right[i])) return false;
            }
            return true;
        }
    } // namespace
    CompiledModifierDiff diffCompiledModifier(const CompiledModifier& before, const CompiledModifier& after) {
        std::uint32_t mask = 0;
        if (!sameVector(before.layout, after.layout, sameLayout) ||
            !sameVector(before.paintContentPadding, after.paintContentPadding, samePadding) ||
            before.parentData.weight != after.parentData.weight ||
            before.parentData.weightFill != after.parentData.weightFill ||
            before.parentData.align != after.parentData.align ||
            before.scroll.vertical != after.scroll.vertical ||
            before.scroll.horizontal != after.scroll.horizontal ||
            before.scroll.verticalValue != after.scroll.verticalValue ||
            before.scroll.horizontalValue != after.scroll.horizontalValue) {
            mask |= dirtyMask(DirtyFlag::Layout) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        if (!sameVector(before.paint.chain, after.paint.chain, samePaintChainOp) ||
            !sameVector(before.paint.styles, after.paint.styles, samePaintStyle) ||
            !sameVector(before.paint.clips, after.paint.clips, samePaintStyle)) {
            mask |= dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        if (before.transform.layoutOffsetX != after.transform.layoutOffsetX ||
            before.transform.layoutOffsetY != after.transform.layoutOffsetY ||
            before.transform.translationX != after.transform.translationX ||
            before.transform.translationY != after.transform.translationY ||
            before.transform.scaleX != after.transform.scaleX ||
            before.transform.scaleY != after.transform.scaleY ||
            before.transform.rotationZ != after.transform.rotationZ ||
            before.transform.transformOriginX != after.transform.transformOriginX ||
            before.transform.transformOriginY != after.transform.transformOriginY ||
            before.transform.hasPaintTransform != after.transform.hasPaintTransform) {
            mask |= dirtyMask(DirtyFlag::Transform) | dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        if (before.input.clickable != after.input.clickable ||
            before.input.hoverable != after.input.hoverable ||
            before.input.pointerInput != after.input.pointerInput ||
            !sameSlot(before.input.clickEventSlot, after.input.clickEventSlot) ||
            !sameSlot(before.scroll.verticalEventSlot, after.scroll.verticalEventSlot) ||
            !sameSlot(before.scroll.horizontalEventSlot, after.scroll.horizontalEventSlot)) {
            mask |= dirtyMask(DirtyFlag::HitTest) | dirtyMask(DirtyFlag::EventSlot);
        }
        if (before.input.focusable != after.input.focusable) {
            mask |= dirtyMask(DirtyFlag::Focus) | dirtyMask(DirtyFlag::HitTest);
        }
        if (before.zIndex != after.zIndex) {
            mask |= dirtyMask(DirtyFlag::Paint) | dirtyMask(DirtyFlag::HitTest);
        }
        return {mask};
    }

} // namespace arrange::core


