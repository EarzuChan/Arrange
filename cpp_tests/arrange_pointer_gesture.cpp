#include <arrange/core/HitTest.h>
#include <arrange/core/Layout.h>
#include <arrange/core/PointerGesture.h>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

namespace {
    void check(bool value, const char* message) {
        if (!value) throw std::runtime_error(message);
    }

    LayoutModifierSemantics size(float width, float height) {
        LayoutModifierSemantics value;
        value.kind = LayoutModifierKind::Size;
        value.width = width;
        value.height = height;
        return value;
    }

    InputModifierSemantics input(InputModifierKind kind, NodeId node, EventSlotKind slot) {
        InputModifierSemantics value;
        value.kind = kind;
        value.eventSlot = makeEventSlotId(node, slot);
        return value;
    }

    void create(LayoutTree& tree, NodeId id, ModifierDescriptors modifiers) {
        tree.apply({CreateNodeMutation{id, NodeType::Layout}, SetPropMutation{id, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("MinSize")}})}, SetModifierMutation{id, std::move(modifiers)}});
    }

    struct Fixture {
        LayoutTree tree;
        HitTestSnapshot snapshot;
        PointerGestureSession session;

        explicit Fixture(bool pointerLock = false, bool startImmediately = false) {
            create(tree, 1, {{size(400, 200)}});
            auto hover = input(InputModifierKind::Hoverable, 2, EventSlotKind::None);
            hover.eventSlot = {};
            hover.enter = makeEventSlotId(2, EventSlotKind::HoverEnter);
            hover.exit = makeEventSlotId(2, EventSlotKind::HoverExit);
            InputModifierSemantics icon;
            icon.kind = InputModifierKind::PointerIcon;
            icon.icon = PointerIcon::Hand;
            auto click = input(InputModifierKind::Clickable, 2, EventSlotKind::Click);
            click.doubleClick = makeEventSlotId(2, EventSlotKind::DoubleClick);
            auto drag = input(InputModifierKind::Draggable, 2, EventSlotKind::DragDelta);
            drag.axis = DragAxis::Horizontal;
            drag.dragStart = makeEventSlotId(2, EventSlotKind::DragStart);
            drag.dragStop = makeEventSlotId(2, EventSlotKind::DragStop);
            drag.pointerLock = pointerLock;
            drag.startImmediately = startImmediately;
            create(tree, 2, {{size(100, 50)}, {hover}, {icon}, {click}, {drag}});
            OffsetModifier offset;
            offset.x = 200;
            create(tree, 3, {{offset}, {size(100, 50)}, {input(InputModifierKind::ContextClick, 3, EventSlotKind::ContextClick)}});
            tree.apply({InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}});
            relayout();
        }

        void relayout() {
            LayoutEngine{}.layout(tree, 1, {0, 400, 0, 200});
            snapshot = buildHitTestSnapshot(tree, 1);
        }

        PointerSample at(float x, float y, double time = 0, bool shift = false) const {
            PointerSample sample{{x, y}, {}, time};
            sample.modifiers.shift = shift;
            return sample;
        }
    };

    std::vector<EventSlotKind> kinds(const PointerGestureOutput& out) {
        std::vector<EventSlotKind> result;
        for (const auto& event : out.events) result.push_back(event.slot.kind);
        return result;
    }

    void verifyHoverAndIcon() {
        Fixture fixture;
        PointerGestureOutput out;
        fixture.session.move(fixture.tree, fixture.snapshot, fixture.at(10, 10), out);
        check(kinds(out) == std::vector{EventSlotKind::HoverEnter} && fixture.session.icon() == PointerIcon::Hand, "进入悬停受体未发出 enter 或未切换光标");
        out = {};
        fixture.session.move(fixture.tree, fixture.snapshot, fixture.at(20, 20), out);
        check(out.events.empty(), "受体内移动重复发出 enter");
        fixture.session.move(fixture.tree, fixture.snapshot, fixture.at(350, 150), out);
        check(kinds(out) == std::vector{EventSlotKind::HoverExit} && fixture.session.icon() == PointerIcon::Default, "离开悬停受体未发出 exit 或未恢复光标");
    }

    void verifyClickWithinSlop() {
        Fixture fixture;
        PointerGestureOutput out;
        fixture.session.primaryDown(fixture.tree, fixture.snapshot, fixture.at(10, 10), 1, out);
        check(out.consumed, "按下 clickable 未被消费");
        fixture.session.drag(fixture.tree, fixture.at(12, 11), out);
        out = {};
        fixture.session.primaryUp(fixture.tree, fixture.snapshot, fixture.at(12, 11), out);
        check(kinds(out) == std::vector{EventSlotKind::Click} && std::holds_alternative<std::monostate>(out.events[0].payload), "阈值内移动的会话未识别为点击");
        out = {};
        fixture.session.primaryDown(fixture.tree, fixture.snapshot, fixture.at(10, 10), 2, out);
        fixture.session.primaryUp(fixture.tree, fixture.snapshot, fixture.at(10, 10), out);
        check(kinds(out) == std::vector{EventSlotKind::DoubleClick}, "第二次点击未交给 onDoubleClick");
    }

    void verifyDragSession() {
        Fixture fixture;
        PointerGestureOutput out;
        fixture.session.primaryDown(fixture.tree, fixture.snapshot, fixture.at(10, 10, 0), 1, out);
        check(kinds(out) == std::vector{EventSlotKind::HoverEnter}, "按下未同步悬停");
        out = {};
        fixture.session.drag(fixture.tree, fixture.at(20, 10, 10), out);
        check(kinds(out) == std::vector{EventSlotKind::DragStart, EventSlotKind::DragDelta} && fixture.session.dragging(), "越过阈值未开始拖动");
        const auto& start = std::get<DragStartPayload>(out.events[0].payload);
        check(start.x == 10 && start.y == 10 && start.width == 100 && start.height == 50, "拖动开始没有按下点本地坐标与受体尺寸");
        check(std::get<DragDeltaPayload>(out.events[1].payload).deltaX == 6, "首段位移没有扣除阈值");
        out = {};
        fixture.session.drag(fixture.tree, fixture.at(25, 13, 20, true), out);
        const auto& delta = std::get<DragDeltaPayload>(out.events[0].payload);
        check(delta.deltaX == 5 && delta.deltaY == 0 && delta.modifiers.shift, "横向拖动未投影到主轴或未附带修饰键");
        out = {};
        fixture.session.primaryUp(fixture.tree, fixture.snapshot, fixture.at(25, 13, 30), out);
        check(kinds(out) == std::vector{EventSlotKind::DragStop} && !std::get<DragStopPayload>(out.events[0].payload).cancelled, "拖动结束未停止或误发点击");
        check(!fixture.session.dragging() && !fixture.session.pressed(), "拖动结束后会话未清空");
    }

    void verifyCancelAndRevalidate() {
        Fixture fixture;
        PointerGestureOutput out;
        fixture.session.primaryDown(fixture.tree, fixture.snapshot, fixture.at(10, 10), 1, out);
        fixture.session.drag(fixture.tree, fixture.at(40, 10), out);
        out = {};
        fixture.session.cancel(fixture.tree, out);
        check(kinds(out) == std::vector{EventSlotKind::DragStop} && std::get<DragStopPayload>(out.events[0].payload).cancelled, "取消未以 cancelled 停止拖动");
        out = {};
        fixture.session.cancel(fixture.tree, out);
        fixture.session.primaryUp(fixture.tree, fixture.snapshot, fixture.at(40, 10), out);
        check(out.events.empty(), "停止回调被调用不止一次或取消后仍点击");

        fixture.session.primaryDown(fixture.tree, fixture.snapshot, fixture.at(10, 10), 1, out);
        fixture.session.drag(fixture.tree, fixture.at(40, 10), out);
        fixture.tree.apply({SetModifierMutation{2, {{size(100, 50)}}}});
        fixture.relayout();
        out = {};
        fixture.session.revalidate(fixture.tree, out);
        check(!fixture.session.pressed() && out.events.empty(), "受体退休后拖动未取消");
    }

    void verifyContextClick() {
        Fixture fixture;
        PointerGestureOutput out;
        fixture.session.contextClick(fixture.tree, fixture.snapshot, fixture.at(210, 20), out);
        check(kinds(out) == std::vector{EventSlotKind::ContextClick}, "上下文点击未路由到 onContextClick");
        const auto& pointer = std::get<PointerEventPayload>(out.events[0].payload);
        check(pointer.x == 10 && pointer.y == 20, "上下文点击坐标不是受体本地坐标");
        out = {};
        fixture.session.contextClick(fixture.tree, fixture.snapshot, fixture.at(10, 10), out);
        check(out.events.empty() && !out.consumed, "没有 onContextClick 的节点消费了上下文点击");
    }

    void verifyPointerLockAndImmediate() {
        Fixture locked(true);
        PointerGestureOutput out;
        locked.session.primaryDown(locked.tree, locked.snapshot, locked.at(10, 10), 1, out);
        check(!out.lockPointer, "阈值内就锁定了指针");
        locked.session.drag(locked.tree, locked.at(30, 10), out);
        check(out.lockPointer, "拖动开始未要求无界移动");
        out = {};
        locked.session.primaryUp(locked.tree, locked.snapshot, locked.at(500, 10), out);
        check(out.unlockPointer && out.restorePoint.x == 10 && out.restorePoint.y == 10, "拖动结束未解除锁定或未回到按下点");

        Fixture immediate(false, true);
        out = {};
        immediate.session.primaryDown(immediate.tree, immediate.snapshot, immediate.at(10, 10), 1, out);
        check(kinds(out) == std::vector{EventSlotKind::HoverEnter, EventSlotKind::DragStart}, "startImmediately 未在按下时开始");
        out = {};
        immediate.session.drag(immediate.tree, immediate.at(12, 10), out);
        check(kinds(out) == std::vector{EventSlotKind::DragDelta}, "startImmediately 阈值内位移未交付");
        out = {};
        immediate.session.primaryUp(immediate.tree, immediate.snapshot, immediate.at(12, 10), out);
        check(kinds(out) == std::vector{EventSlotKind::DragStop, EventSlotKind::Click}, "阈值内的立即拖动未保留点击");
    }
}

int main() {
    try {
        verifyHoverAndIcon();
        verifyClickWithinSlop();
        verifyDragSession();
        verifyCancelAndRevalidate();
        verifyContextClick();
        verifyPointerLockAndImmediate();
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
