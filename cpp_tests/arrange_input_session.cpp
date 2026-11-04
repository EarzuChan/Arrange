#include <arrange/core/Focus.h>
#include <arrange/core/InputSession.h>
#include <arrange/core/HitTest.h>
#include <arrange/core/Layout.h>
#include <algorithm>
#include <string>
#include <iostream>
#include <stdexcept>

using namespace arrange::core;

// 只链接 arrange_core：输入语义不依赖 JUCE 即可驱动
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

    FocusModifier requester(std::uint32_t identity) {
        FocusModifier value;
        value.kind = FocusModifierKind::Requester;
        value.requester = identity;
        return value;
    }

    void create(LayoutTree& tree, NodeId id, ModifierDescriptors modifiers) {
        tree.apply({CreateNodeMutation{id, NodeType::Layout}, SetPropMutation{id, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("MinSize")}})}, SetModifierMutation{id, std::move(modifiers)}});
    }

    KeyInput key(int code, std::string name, std::string text = {}, KeyModifierState modifiers = {}) {
        return {code, std::move(name), std::move(text), modifiers};
    }

    void verifyKeys() {
        LayoutTree tree;
        InputModifierSemantics keys;
        keys.kind = InputModifierKind::KeyEvent;
        keys.eventSlot = makeEventSlotId(1, EventSlotKind::Key);
        create(tree, 1, {{size(400, 200)}, {keys}});
        InputModifierSemantics click;
        click.eventSlot = makeEventSlotId(2, EventSlotKind::Click);
        create(tree, 2, {{size(40, 30)}, {requester(1)}, {click}});
        OffsetModifier offset;
        offset.x = 100;
        InputModifierSemantics focusable;
        focusable.kind = InputModifierKind::Focusable;
        create(tree, 3, {{offset}, {size(40, 30)}, {requester(2)}, {focusable}});
        tree.apply({InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}});
        LayoutEngine{}.layout(tree, 1, {0, 400, 0, 200});

        InputSession session;
        TextInputBridge text;
        InputCallbacks callbacks;
        int clicks = 0;
        callbacks.invokeEvent = [&](const auto&) {
            ++clicks;
        };
        std::vector<KeyEventPayload> seen;
        auto consume = false;
        callbacks.dispatchKeyEvent = [&](const auto& slot, const auto& payload) {
            seen.push_back(payload);
            return slot.node == 1 && consume;
        };
        session.synchronizePublishedFocus(tree, true, text, {{FocusCommandKind::Request, 1}});
        session.dispatchCommittedFocus(tree, text, callbacks);
        check(session.focusedNode() == 2, "焦点请求未落到请求器节点");

        KeyModifierState shift;
        shift.shift = true;
        consume = true;
        check(session.keyDown(tree, true, key('A', "A", "A", shift), text, callbacks) && seen.size() == 1 && seen[0].key == "A" && seen[0].modifiers.shift, "onKeyEvent 未从焦点受体冒泡到祖先");
        check(session.keyStateChanged(tree, true, [](int) { return false; }, callbacks) && seen.size() == 2 && seen[1].up, "key up 未交付给已交付 key down 的键");
        consume = false;

        check(session.keyDown(tree, true, key(13, "Enter"), text, callbacks) && clicks == 0, "Enter 按下就激活了 clickable");
        check(session.keyStateChanged(tree, true, [](int) { return false; }, callbacks) && clicks == 1, "Enter 抬起没有激活 clickable");
        check(session.keyDown(tree, true, key(' ', " ", " "), text, callbacks) && session.keyStateChanged(tree, true, {}, callbacks) && clicks == 1, "失焦补发的抬起激活了 clickable");

        check(session.keyDown(tree, true, key(9, "Tab"), text, callbacks) && session.focusedNode() == 3, "Tab 没有转移焦点");
        (void)session.keyStateChanged(tree, true, {}, callbacks);
        KeyModifierState back;
        back.shift = true;
        check(session.keyDown(tree, true, key(9, "Tab", {}, back), text, callbacks) && session.focusedNode() == 2, "Shift+Tab 没有反向转移焦点");
        (void)session.keyStateChanged(tree, true, {}, callbacks);

        auto candidate = session;
        check(candidate.moveFocus(tree, FocusDirection::Next, text, callbacks) && candidate.focusedNode() == 3 && session.focusedNode() == 2, "帧候选会话与已提交会话共享了焦点");
        session.commitState(std::move(candidate));
        check(session.focusedNode() == 3, "候选会话提交后焦点未更新");
    }

    // 按下到抬起之间链条插入或移除其它元素，clickable 受体身份不变，点击照常触发
    void verifyClickSurvivesChainShapeChange() {
        PaintStyleSemantics background;
        background.color = 0xffffffff;
        PaintStyleSemantics border;
        border.kind = PaintStyleKind::Border;
        border.color = 0xff007aff;
        LayoutModifierSemantics padding;
        padding.kind = LayoutModifierKind::Padding;
        padding.padding = {4, 4, 4, 4};
        InputModifierSemantics click;
        click.eventSlot = makeEventSlotId(1, EventSlotKind::Click);
        const std::vector<std::pair<ModifierDescriptors, ModifierDescriptors>> cases{
            {{{size(100, 60)}, {background}, {click}}, {{size(100, 60)}, {background}, {border}, {click}}},
            {{{size(100, 60)}, {background}, {click}, {padding}}, {{size(100, 60)}, {padding}, {background}, {click}, {padding}}},
            {{{size(100, 60)}, {click}, {background}}, {{size(100, 60)}, {background}, {click}, {background}}},
            {{{size(100, 60)}, {background}, {border}, {click}, {padding}}, {{size(100, 60)}, {background}, {click}, {padding}}},
        };
        for (std::size_t index = 0; index < cases.size(); ++index) {
            LayoutTree tree;
            create(tree, 1, cases[index].first);
            LayoutEngine{}.layout(tree, 1, {0, 400, 0, 200});
            InputSession session;
            TextInputBridge text;
            InputCallbacks callbacks;
            const auto before = buildHitTestSnapshot(tree, 1);
            (void)session.pointerDown(tree, before, {{20, 20}}, text, callbacks);
            const auto handle = tree.node(1).modifier.elements()[index == 2 ? 1 : index == 3 ? 3 : 2].handle;
            tree.apply({SetModifierMutation{1, cases[index].second}});
            LayoutEngine{}.layout(tree, 1, {0, 400, 0, 200});
            session.synchronizePublishedInput(tree, true, text);
            const auto after = buildHitTestSnapshot(tree, 1);
            const auto released = session.pointerUp(tree, after, {{20, 20}}, text);
            const auto& elements = tree.node(1).modifier.elements();
            const auto kept = std::any_of(elements.begin(), elements.end(), [&](const auto& item) { return item.handle == handle; });
            if (!kept) throw std::runtime_error("链条形状变化第 " + std::to_string(index) + " 例重建了 clickable 受体");
            if (!released.clickTriggered) throw std::runtime_error("链条形状变化第 " + std::to_string(index) + " 例丢失了点击");
        }
    }
}

int main() {
    try {
        verifyKeys();
        verifyClickSurvivesChainShapeChange();
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    std::cout << "arrange_input_session 通过\n";
    return 0;
}
