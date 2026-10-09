#include "JuceTestApplication.h"
#include "TextFixtures.h"
#include <arrange/core/Focus.h>
#include <arrange/core/InputEditing.h>
#include <arrange/core/Layout.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/juce/InteractionStateOwner.h>
#include <arrange/juce/ArrangeRuntime.h>
#include <arrange/juce/DiagnosticsState.h>
#include <arrange/juce/FramePumpDriver.h>
#include <arrange/juce/JuceTextServices.h>
#include <arrange/juce/PassivePaintRenderer.h>
#include <arrange/juce/RuntimeSessionState.h>
#include <arrange/juce/TextInputMutationSink.h>
#include <arrange/juce/TextInputOwner.h>
#include <arrange/quickjs/QuickJsScriptHost.h>
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

    FocusModifier requester(std::uint32_t identity) {
        FocusModifier value;
        value.kind = FocusModifierKind::Requester;
        value.requester = identity;
        return value;
    }

    InputModifierSemantics focusable() {
        InputModifierSemantics value;
        value.kind = InputModifierKind::Focusable;
        return value;
    }

    void create(LayoutTree& tree, NodeId id, ModifierDescriptors modifiers) {
        tree.apply({CreateNodeMutation{id, NodeType::Layout}, SetPropMutation{id, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("MinSize")}})}, SetModifierMutation{id, std::move(modifiers)}});
    }

    ::juce::KeyPress command(char value, bool shift = false) {
        return {value, ::juce::ModifierKeys(::juce::ModifierKeys::commandModifier | (shift ? ::juce::ModifierKeys::shiftModifier : 0)), 0};
    }

    void verifyFocus() {
        LayoutTree tree;
        FocusModifier parentObserver;
        parentObserver.kind = FocusModifierKind::Observer;
        parentObserver.eventSlot = makeEventSlotId(1, EventSlotKind::FocusChanged);
        create(tree, 1, {{size(400, 200)}, {parentObserver}});
        FocusModifier observer;
        observer.kind = FocusModifierKind::Observer;
        observer.eventSlot = makeEventSlotId(2, EventSlotKind::FocusChanged);
        InputModifierSemantics click;
        click.eventSlot = makeEventSlotId(2, EventSlotKind::Click);
        create(tree, 2, {{size(40, 30)}, {requester(1)}, {observer}, {click}});
        OffsetModifier offset;
        offset.x = 100;
        create(tree, 3, {{offset}, {size(40, 30)}, {requester(2)}, {focusable()}});
        offset.x = 200;
        create(tree, 4, {{offset}, {size(40, 30)}, {requester(3)}, {focusable()}});
        tree.apply({InsertChildMutation{1, 2, 0}, InsertChildMutation{1, 3, 1}, InsertChildMutation{1, 4, 2}});
        LayoutEngine{}.layout(tree, 1, {0, 400, 0, 200});
        auto snapshot = buildFocusSnapshot(tree);
        check(snapshot.size() == 3 && searchFocus(snapshot, snapshot[0], FocusDirection::Right)->node.id == 3, "方向焦点没有按真实矩形搜索");
        check(searchFocus(snapshot, snapshot[0], FocusDirection::Previous)->node.id == 4, "Shift Tab没有根内循环");
        snapshot[0].directions[static_cast<std::size_t>(FocusDirection::Right)] = 3;
        check(searchFocus(snapshot, snapshot[0], FocusDirection::Right)->node.id == 4, "显式方向没有优先于几何");
        snapshot[0].directions = {};
        snapshot[0].groups = {9};
        snapshot[2].groups = {9};
        check(searchFocus(snapshot, snapshot[0], FocusDirection::Right)->node.id == 4, "方向搜索跳出了当前focusGroup");
        arrange::juce::FocusOwner ordered;
        ordered.synchronize(tree, true, {{FocusCommandKind::Request, 1}, {FocusCommandKind::Move, 0, FocusDirection::Next}, {FocusCommandKind::Request, 3}});
        check(ordered.focusedNode() == 4 && ordered.takeMoves().empty(), "同帧焦点命令没有按顺序执行");
        ordered.synchronize(tree, true, {{FocusCommandKind::Request, 99}, {FocusCommandKind::Cancel, 99}});
        check(!ordered.hasPendingRequest() && ordered.focusedNode() == 4, "请求器取消丢失焦点或遗留请求");
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService service(measurer);
        arrange::juce::InteractionStateOwner interaction(service);
        std::vector<bool> changes;
        std::vector<std::pair<bool, bool>> parentChanges;
        int clicks = 0;
        arrange::juce::TextInputCallbacks callbacks;
        callbacks.invokeFocusEvent = [&](const auto& slot, bool value, bool hasFocus) {
            if (slot == parentObserver.eventSlot)
                parentChanges.emplace_back(value, hasFocus);
            else
                changes.push_back(value);
        };
        callbacks.invokeEvent = [&](const auto&) {
            ++clicks;
        };
        interaction.synchronizePublishedFocus(tree, true, {{FocusCommandKind::Request, 1}});
        check(interaction.focusedNode() == 2 && changes.empty(), "候选焦点提前发送了回调");
        interaction.dispatchCommittedFocus(tree, callbacks);
        check(changes == std::vector<bool>{true}, "成功提交没有发送焦点回调");
        check(parentChanges == std::vector<std::pair<bool, bool>>{{false, true}}, "父Layout没有收到后代hasFocus");
        check(interaction.keyPressed(tree, true, ::juce::KeyPress(::juce::KeyPress::spaceKey), callbacks) && clicks == 1, "clickable焦点无法键盘触发");
        check(interaction.keyPressed(tree, true, ::juce::KeyPress(::juce::KeyPress::tabKey), callbacks) && interaction.focusedNode() == 3, "Tab没有转移通用焦点");
        check(changes == std::vector<bool>({true, false}), "原焦点没有blur回调");
        check(parentChanges.size() == 1, "同一父Layout内转焦点触发了假blur");
        tree.apply({RemoveChildMutation{1, 4}, InsertChildMutation{1, 4, 0}});
        interaction.synchronizePublishedFocus(tree, true);
        check(interaction.moveFocus(tree, FocusDirection::Previous, callbacks) && interaction.focusedNode() == 2, "keyed移动后的焦点顺序不正确");
        tree.setHostInput(1, HostInput::Enabled, PropValue::booleanValue(false));
        interaction.synchronizePublishedFocus(tree, true);
        check(!interaction.focusedNode(), "祖先禁用后仍持有焦点");
        tree.setHostInput(1, HostInput::Enabled, PropValue::booleanValue(true));
        const auto original = buildFocusSnapshot(tree)[0];
        tree.apply({DeleteNodeMutation{4}});
        create(tree, 4, {{size(40, 30)}, {requester(3)}, {focusable()}});
        tree.apply({InsertChildMutation{1, 4, 0}});
        check(!(original == buildFocusSnapshot(tree)[0]), "复用node id转移了旧焦点身份");
        tree.setModifierChain(3, {{size(40, 30)}, {requester(1)}, {focusable()}});
        bool duplicate = false;
        try {
            (void)buildFocusSnapshot(tree);
        } catch (const std::invalid_argument&) {
            duplicate = true;
        }
        check(duplicate, "一个Requester绑定多个目标未报错");
    }

    void verifyEditingState() {
        TextInputState text;
        text.begin("", false);
        text.setEditTime(0);
        text.insertCodepoint(U'中');
        text.setEditTime(100);
        text.insertCodepoint(U'文');
        check(text.undo().textChanged && text.text().empty(), "连续输入没有合并undo");
        check(text.redo().textChanged && text.text() == "中文", "redo没有恢复输入组");
        text.moveLeft();
        text.setEditTime(200);
        text.insertCodepoint(U'好');
        check(text.undo().textChanged && text.text() == "中文", "移动光标没有拆开undo组");
        text.moveCursorTo(text.text().size());
        text.setEditTime(2000);
        text.insertCodepoint(U'🙂');
        check(text.backspace().textChanged && text.text() == "中文", "非BMP删除破坏UTF8边界");
        text.replaceExternal("x");
        check(!text.undo().consumed, "外部替换未清理undo历史");
    }

    void verifyImeAndClipboard() {
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService service(measurer);
        LayoutTree tree;
        auto field = test_support::textField("ab");
        field.presentation.singleLine = true;
        field.onValueChange = makeEventSlotId(1, EventSlotKind::InputUpdate);
        create(tree, 1, {{size(200, 35)}, {field, "edit"}});
        LayoutEngine(service).layout(tree, 1, {0, 200, 0, 100});
        arrange::juce::TextInputOwner input(service);
        std::vector<std::string> edits;
        std::string clipboard;
        arrange::juce::TextInputCallbacks callbacks;
        callbacks.invokeStringEvent = [&](const auto&, const auto& value) {
            edits.push_back(value);
        };
        callbacks.readClipboard = [&] {
            return clipboard;
        };
        callbacks.writeClipboard = [&](const auto& value) {
            clipboard = value;
        };
        input.focus(tree, 1, tree.node(1).modifier.elements()[1].handle, callbacks);
        (void)input.setHighlightedRegion(tree, true, {1, 2}, callbacks);
        // JUCE/Windows 的 composition start 会先空插入，再在另一平台消息中给出候选。
        (void)input.insertTextAtCaret(tree, true, "", callbacks);
        input.dispatchPendingTextEdits(tree, callbacks);
        check(edits.empty(), "Windows composition start 提前提交了选区删除");
        (void)input.insertTextAtCaret(tree, true, "z", callbacks);
        ::juce::Array<::juce::Range<int>> marked;
        marked.add({1, 2});
        (void)input.setTemporaryUnderlining(tree, true, marked, callbacks);
        input.dispatchPendingTextEdits(tree, callbacks);
        check(edits.empty(), "IME候选文字提前修改业务value");
        (void)input.setHighlightedRegion(tree, true, {1, 2}, callbacks);
        (void)input.insertTextAtCaret(tree, true, "zhong", callbacks);
        marked.clear();
        marked.add({1, 6});
        (void)input.setTemporaryUnderlining(tree, true, marked, callbacks);
        (void)input.setHighlightedRegion(tree, true, {1, 6}, callbacks);
        (void)input.insertTextAtCaret(tree, true, ::juce::String::fromUTF8("中"), callbacks);
        (void)input.setTemporaryUnderlining(tree, true, {}, callbacks);
        check(edits == std::vector<std::string>{"a中"}, "IME提交未原子回写");
        check(input.keyPressed(tree, true, command('z'), callbacks) && edits.back() == "ab", "IME一次undo未恢复组合前选区替换");
        check(input.keyPressed(tree, true, command('z', true), callbacks) && edits.back() == "a中", "IME redo失败");
        (void)input.setHighlightedRegion(tree, true, {1, 2}, callbacks);
        (void)input.insertTextAtCaret(tree, true, "wrong", callbacks);
        marked.clear();
        marked.add({1, 6});
        (void)input.setTemporaryUnderlining(tree, true, marked, callbacks);
        (void)input.setHighlightedRegion(tree, true, {1, 6}, callbacks);
        (void)input.insertTextAtCaret(tree, true, "", callbacks);
        (void)input.setTemporaryUnderlining(tree, true, {}, callbacks);
        check(input.textInRange(tree, true, {0, input.totalNumChars(tree, true)}).toStdString() == "a中" && edits.size() == 3, "取消composition未还原原文或发送了新业务value");
        check(input.keyPressed(tree, true, command('a'), callbacks) && input.keyPressed(tree, true, command('c'), callbacks) && clipboard == "a中", "全选复制失败");
        clipboard = "A\r\nB\rC";
        check(input.keyPressed(tree, true, command('v'), callbacks) && edits.back() == "A B C", "单行粘贴换行没有正规化");
        check(input.keyPressed(tree, true, command('z'), callbacks) && edits.back() == "a中", "整次粘贴不是一个undo");
        auto receipt = field;
        receipt.value = "a中";
        tree.setModifierInput(1, tree.node(1).modifier.elements()[1].handle, receipt);
        input.synchronizePublishedInput(tree, true);
        check(input.keyPressed(tree, true, command('z'), callbacks) && edits.back() == "ab", "value编辑回执清除了撤销历史");
    }

    void verifyMultiline() {
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService service(measurer);
        LayoutTree tree;
        auto field = test_support::textField("one\ntwo\nthree\nfour");
        field.presentation.singleLine = false;
        field.presentation.maxLines = 2;
        field.presentation.style = {14, 18};
        field.onValueChange = makeEventSlotId(1, EventSlotKind::InputUpdate);
        create(tree, 1, {{size(120, 36)}, {field}});
        LayoutEngine(service).layout(tree, 1, {0, 120, 0, 100});
        check(tree.node(1).modifier.elements()[1].textLayout->lines.size() == 4, "InputmaxLines截断了编辑正文");
        arrange::juce::TextInputOwner input(service);
        input.focus(tree, 1, tree.node(1).modifier.elements()[1].handle, {});
        check(input.viewportY() > 0, "多行光标没有纵向滚入");
        const auto caret = input.caretRectangleForCharIndex(tree, true, input.totalNumChars(tree, true));
        check(caret.getBottom() <= 37 && input.charIndexForPoint(tree, true, caret.getCentre()) == input.totalNumChars(tree, true), "纵向viewport使IME与点击索引不一致");
        check(input.keyPressed(tree, true, ::juce::KeyPress(::juce::KeyPress::upKey), {}) && input.caretPosition(tree, true) < input.totalNumChars(tree, true), "多行Up未沿视觉行移动");
        check(input.keyPressed(tree, true, ::juce::KeyPress(::juce::KeyPress::homeKey), {}) && input.caretPosition(tree, true) == 8, "视觉行Home未移动到行首");
        check(input.keyPressed(tree, true, ::juce::KeyPress(::juce::KeyPress::upKey, ::juce::ModifierKeys(::juce::ModifierKeys::shiftModifier), 0), {}) && !input.highlightedRegion(tree, true).isEmpty(), "Shift Up未跨行选择");
        const auto ops = input.buildFocusedInputOps(tree, true);
        check(std::any_of(ops.begin(), ops.end(), [](const auto& op) { return op.type == DrawOpType::DrawText && op.maxLines == 0 && op.textLayout->lines.size() == 4; }), "覆盖层未保留完整多行排版");
    }

    void verifyScrollIntoView() {
        LayoutTree tree;
        LayoutModifierSemantics scroll;
        scroll.kind = LayoutModifierKind::VerticalScroll;
        scroll.eventSlot = makeEventSlotId(1, EventSlotKind::VerticalScroll);
        create(tree, 1, {{size(100, 100)}, {scroll, "scroll"}});
        create(tree, 2, {{size(100, 500)}});
        tree.apply({SetPropMutation{1, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Box")}})}, SetPropMutation{2, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("Box")}})}});
        OffsetModifier offset;
        offset.y = 300;
        create(tree, 3, {{offset}, {size(50, 40)}, {requester(1)}, {focusable()}});
        tree.apply({InsertChildMutation{1, 2, 0}, InsertChildMutation{2, 3, 0}});
        LayoutEngine{}.layout(tree, 1, {0, 100, 0, 100});
        const auto target = findFocusRequester(buildFocusSnapshot(tree), 1);
        check(target.has_value(), "滚动容器中的焦点候选缺失");
        const auto changes = focusScrollIntoView(tree, *target);
        check(changes.size() == 1 && std::abs(changes.front().second.value - 240) < .01f, "scrollIntoView没有最小滚入");
        check(ScrollDispatcher::verticalScrollValue(tree.node(1)) == 0, "scrollIntoView提前修改已发布几何");
        const auto page = focusKeyboardScroll(tree, 3, 1);
        const auto end = focusKeyboardScroll(tree, 3, 2);
        check(page && page->second.value == 100 && end && end->second.value == 400, "键盘页或End没有使用最近滚动祖先");
        auto transform = TransformModifierSemantics{};
        transform.scaleY = 2;
        tree.setModifierChain(1, {{transform}, {size(100, 100)}, {scroll, "scroll"}});
        LayoutEngine{}.layout(tree, 1, {0, 100, 0, 100});
        const auto scaled = focusScrollIntoView(tree, *findFocusRequester(buildFocusSnapshot(tree), 1));
        check(scaled.size() == 1 && std::abs(scaled.front().second.value - 240) < .01f, "graphicsLayer把滚入距离放大了");
    }

    void verifyQuickJsFocus() {
        arrange::quickjs::QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("M3-focus.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            const rejects = f => { try { f() } catch { return }; throw new Error('无效焦点载荷未拒绝') }
            n.createNode(1, 'LayoutNode')
            n.setModifier(1, {elements: [
                {type:'focusRequester', value:{requester:9}},
                {type:'onFocusChanged', key:'observer', value:{callback: state => {
                    if (typeof state.isFocused !== 'boolean' || typeof state.hasFocus !== 'boolean') throw new Error('焦点不是typed object')
                    n.setProp(1, 'contentDescription', `${state.isFocused}/${state.hasFocus}`)
                }}},
                {type:'focusProperties',value:{canFocus:true, next:9}},
                {type:'focusGroup',value:{}},
                {type:'focusable',value:{enabled:true}}
            ]})
            rejects(() => n.focusCommand('request', 0))
            rejects(() => n.focusCommand('request', -1))
            rejects(() => n.focusCommand('move', 0, 'diagonal'))
            rejects(() => n.focusCommand('unknown', 0))
            rejects(() => n.setModifier(1, {elements:[{type:'focusRequester',value:{requester:1.5}}]}))
            rejects(() => n.setModifier(1, {elements:[{type:'focusRequester',value:{requester:4294967296}}]}))
            rejects(() => n.setModifier(1, {elements:[{type:'onFocusChanged',value:{callback:1}}]}))
            n.focusCommand('request', 9)
        )JS");
        check(loaded.ok, loaded.error.c_str());
        check(host.hasPendingFocusCommands(), "无视觉写入的focus命令未登记待办");
        const auto commands = host.takeFocusCommands();
        check(commands.size() == 1 && commands[0].requester == 9 && !host.hasPendingFocusCommands(), "无效焦点命令进入了队列");
        const auto apply = [&] {
            auto submission = host.takePendingTransaction();
            check(submission.has_value(), "QuickJS焦点测试未提交修改");
            const auto result = pipeline.run(scene, 1, {0, 100, 0, 100}, &*submission, true, published);
            check(!result.error, result.error ? result.error->c_str() : "");
            host.publishScene(scene);
            const auto receipt = host.completeRearrange(submission->rearrange);
            check(receipt.ok, receipt.error.c_str());
        };
        apply();
        const auto target = findFocusRequester(buildFocusSnapshot(scene.tree()), 9);
        check(target && target->observers.size() == 1 && target->directions[0] == 9, "QuickJS焦点Modifier未进入原生结构");
        const auto invoked = host.invokeEventSlot(target->observers[0].slot, {.hasFocusArgument = true, .focused = false, .hasFocus = true});
        check(invoked.ok, invoked.error.c_str());
        apply();
        check(scene.node(1).props.at("contentDescription").stringOr() == "false/true", "QuickJS丢失了祖先hasFocus字段");
    }

    void verifyLazyFocus() {
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService service(measurer);
        LayoutTree tree;
        LayoutModifierSemantics scroll;
        scroll.kind = LayoutModifierKind::VerticalScroll;
        scroll.eventSlot = makeEventSlotId(1, EventSlotKind::VerticalScroll);
        create(tree, 1, {{size(100, 100)}, {scroll, "scroll"}});
        LazyMeasurePolicy policy;
        policy.estimate = 50;
        std::vector<std::string> keys, types;
        std::vector<int> spans;
        for (int index = 0; index < 40; ++index) {
            keys.push_back("n:" + std::to_string(index));
            types.push_back("");
            spans.push_back(1);
        }
        policy.keys = std::move(keys);
        policy.contentTypes = std::move(types);
        policy.spans = std::move(spans);
        tree.node(1).measurePolicy = policy;
        LayoutEngine engine(service);
        engine.setMaterializer([&](NodeId id, const std::vector<int>& selected) {
            auto next = std::get<LazyMeasurePolicy>(tree.node(id).measurePolicy);
            const auto previousChildren = tree.node(id).children;
            for (const auto child : previousChildren)
                if (std::find(selected.begin(), selected.end(), static_cast<int>(child - 100)) == selected.end()) tree.apply({DeleteNodeMutation{child}});
            for (std::size_t position = 0; position < selected.size(); ++position) {
                const auto child = static_cast<NodeId>(100 + selected[position]);
                if (!tree.contains(child)) {
                    if (selected[position] == 0) {
                        auto field = test_support::textField("保留");
                        field.presentation.singleLine = true;
                        create(tree, child, {{size(100, 50)}, {requester(1)}, {field}});
                    } else
                        create(tree, child, {{size(100, 50)}, {requester(selected[position] + 1)}, {focusable()}});
                }
                if (tree.parentOf(child)) tree.apply({RemoveChildMutation{id, child}});
                tree.apply({InsertChildMutation{id, child, static_cast<std::uint32_t>(position)}});
            }
            next.indices = selected;
            tree.node(id).measurePolicy = std::move(next);
            tree.markInputDirty(id, dirtyMask(DirtyFlag::Layout));
        });
        engine.layout(tree, 1, {0, 100, 0, 100});
        arrange::juce::InteractionStateOwner interaction(service);
        arrange::juce::TextInputCallbacks callbacks;
        callbacks.invalidateNativeState = [&](NodeId id, DirtyFlag flag, const auto&) {
            tree.markInputDirty(id, dirtyMask(flag));
        };
        check(interaction.requestFocus(tree, 100, callbacks), "Lazy首项无法获得通用焦点");
        (void)interaction.insertTextAtCaret(tree, true, "z", callbacks);
        ::juce::Array<::juce::Range<int>> marked;
        marked.add({2, 3});
        (void)interaction.setTemporaryUnderlining(tree, true, marked, callbacks);
        auto candidate = tree;
        interaction.prepareLazyInteraction(candidate);
        check(candidate.node(1).lazy->pinnedKeys == std::vector<std::string>{"n:0"} && tree.node(1).lazy->pinnedKeys.empty(), "Lazy pin改写了发布状态或丢失稳定key");
        tree = std::move(candidate);
        scroll.scrollValue = 1500;
        tree.setModifierChain(1, {{size(100, 100)}, {scroll, "scroll"}});
        interaction.prepareLazyInteraction(tree);
        engine.layout(tree, 1, {0, 100, 0, 100});
        check(tree.contains(100), "离屏焦点项被Lazy退休");
        check(interaction.isTextInputActive(tree, true) && interaction.textInRange(tree, true, {0, 3}).toStdString() == "保留z", "离屏 pin 未保留 Input/IME 正文会话");
        check(!tree.contains(101), "Lazy夹具未产生真正的按需越界目标");
        check(interaction.moveFocus(tree, FocusDirection::Next, callbacks) && interaction.hasPendingLazyFocus() && interaction.focusedNode() == 100, "Lazy Tab未留下发布前的材料化请求");
        interaction.prepareLazyInteraction(tree);
        engine.layout(tree, 1, {0, 100, 0, 100});
        auto failedCandidate = interaction;
        failedCandidate.synchronizePublishedFocus(tree, true);
        check(failedCandidate.focusedNode() == 101 && interaction.focusedNode() == 100, "失败焦点候选污染了旧焦点");
        interaction.commitState(std::move(failedCandidate));
        interaction.dispatchCommittedFocus(tree, callbacks);
        check(!interaction.hasPendingLazyFocus() && interaction.focusedNode() == 101, "Lazy新目标未在成功提交后获得焦点");
        check(!interaction.isTextInputActive(tree, true), "Lazy 转到普通受体未释放旧 IME 会话");
        interaction.prepareLazyInteraction(tree);
        check(tree.node(1).lazy->pinnedKeys == std::vector<std::string>{"n:1"} && tree.node(1).lazy->focusRequestKey.empty(), "Lazy转焦点后未转移pin或退休请求");
        interaction.clearFocus(tree, callbacks);
        interaction.prepareLazyInteraction(tree);
        check(tree.node(1).lazy->pinnedKeys.empty(), "Lazy清焦点未释放pin");
        InputModifierSemantics click;
        click.kind = InputModifierKind::Clickable;
        click.focusable = false;
        click.eventSlot = makeEventSlotId(101, EventSlotKind::Click);
        tree.setModifierChain(101, {{size(100, 50)}, {click}});
        engine.layout(tree, 1, {0, 100, 0, 100});
        const auto bounds = tree.node(101).modifier.elements().back().bounds;
        const auto hit = buildHitTestSnapshot(tree, 1);
        check(HitTester{}.hitTestClickable(hit, {bounds.x + 10, bounds.y + 10}).node == 101, "capture pin夹具未测量或命中真实clickable");
        interaction.pointerDown(tree, hit, bounds.x + 10, bounds.y + 10, callbacks);
        interaction.prepareLazyInteraction(tree);
        check(!interaction.focusedNode() && tree.node(1).lazy->pinnedKeys == std::vector<std::string>{"n:1"}, "不可聚焦clickable的pointer capture未独立pin");
        (void)interaction.pointerUp(tree, hit, bounds.x + 10, bounds.y + 10);
        interaction.prepareLazyInteraction(tree);
        check(tree.node(1).lazy->pinnedKeys.empty(), "pointer up未释放Lazy capture pin");
    }

    void verifyPublishedOverlayResource() {
        arrange::juce::JuceTextMeasurer measurer;
        TextLayoutService service(measurer);
        arrange::juce::ArrangeRuntime runtime{SceneFramePipeline{LayoutEngine{service}}};
        arrange::juce::RuntimeSessionState session;
        arrange::juce::DiagnosticsState diagnostics;
        arrange::juce::InteractionStateOwner interaction(service);
        arrange::juce::PassivePaintRenderer paint(service);
        arrange::juce::FramePumpDriver driver;
        session.resize(100, 50, runtime);
        session.markLoaded();
        auto field = test_support::textField("旧");
        field.presentation.singleLine = true;
        MutationTransaction initial;
        initial.operations = {CreateNodeMutation{1, NodeType::Layout}, SetPropMutation{1, "measurePolicy", PropValue::objectValue({{"kind", PropValue::stringValue("MinSize")}})}, SetModifierMutation{1, {{size(100, 50)}, {field}}}};
        runtime.enqueue(std::move(initial));
        const auto pump = [&](double time) {
            (void)driver.pumpFrame(runtime, session, diagnostics, interaction, paint, 1, {}, {0, 0, 100, 50}, true, {}, time);
            check(!diagnostics.hasError(), "覆盖层生产帧失败");
        };
        pump(0);
        const auto callbacks = arrange::juce::TextInputMutationSink{}.callbacks(runtime);
        check(interaction.requestFocus(runtime.scene().tree(), 1, callbacks), "生产覆盖层没有文本焦点");
        pump(16);
        (void)interaction.setHighlightedRegion(runtime.scene().tree(), true, {0, 1}, callbacks);
        (void)interaction.insertTextAtCaret(runtime.scene().tree(), true, ::juce::String::fromUTF8("新"), callbacks);
        pump(32);
        const auto& ops = runtime.publishedFrame().content.overlayDrawOps;
        const auto text = std::find_if(ops.begin(), ops.end(), [](const auto& op) { return op.type == DrawOpType::DrawText; });
        check(text != ops.end() && text->text == "新" && text->textLayout && text->textLayout->text == "新", "生产finalizer把更新正文换成了上一帧字形资源");
    }

    int run() {
        try {
            verifyFocus();
            verifyEditingState();
            verifyImeAndClipboard();
            verifyMultiline();
            verifyScrollIntoView();
            verifyQuickJsFocus();
            verifyLazyFocus();
            verifyPublishedOverlayResource();
            std::cout << "Focus 搜索、提交、生命周期、滚入、Lazy按需导航及 IME、撤销、剪贴板、多行、QuickJS和生产覆盖层验证通过\n";
            return 0;
        } catch (const std::exception& error) {
            std::cerr << error.what() << '\n';
            return 1;
        }
    }
}

using FocusInputApplication = arrange::test::JuceTestApplication<run>;
START_JUCE_APPLICATION(FocusInputApplication)
