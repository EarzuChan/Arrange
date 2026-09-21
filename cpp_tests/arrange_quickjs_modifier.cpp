#include "TextFixtures.h"
#include <arrange/core/HitTest.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <iostream>
#include <stdexcept>

using namespace arrange::core;
using arrange::quickjs::QuickJsScriptHost;

namespace {
    void check(bool condition, const char* message) {
        if (!condition) throw std::runtime_error(message);
    }

    void frame(QuickJsScriptHost& host, NativeScene& scene, SceneFramePipeline& pipeline, PublishedFrame& published) {
        auto submission = host.takePendingTransaction();
        check(submission.has_value(), "QuickJS did not submit changes");
        const auto result = pipeline.run(scene, 1, {0, 400, 0, 300}, &*submission, true, published);
        if (result.error) throw std::runtime_error(*result.error);
        host.publishScene(scene);
        const auto receipt = host.completeRearrange(submission->rearrange);
        if (!receipt.ok) throw std::runtime_error(receipt.error);
    }

    void verifyExplicitBindings() {
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("显式绑定.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            const rejects = fn => { try { fn() } catch { return }; throw new Error('无效输入未拒绝') }
            n.createNode(1, 'LayoutNode')
            n.createNode(2, 'LayoutNode')
            n.insertChild(1, 2, 0)
            const old = n.registerBinding(2, 'modifier')
            const text = value => ({elements: [{type: 'text', value: {text: value}}]})
            n.updateBinding(old, text('修改前'))
            const current = n.registerBinding(2, 'modifier')
            let decoded = false
            rejects(() => n.updateBinding(old, {get elements() { decoded = true; return [] }}))
            if (decoded) throw new Error('退休绑定读取了载荷')
            rejects(() => n.updateBinding({...current, identity: current.identity + (1n << 64n)}, text('溢出')))
            rejects(() => n.updateBinding({...current, generation: -1n}, text('负代际')))
            rejects(() => n.updateBinding({...current, identity: Number(current.identity)}, text('数字身份')))
            rejects(() => n.updateBinding(current, {elements: [{type: 'text', value: {text: 5}}]}))
            rejects(() => n.updateBinding(current, {elements: [{type: 'text', value: {text: '内容', style: {fontSize: Infinity}}}]}))
            n.updateBinding(current, text('修改后'))
            n.createNode(3, 'LayoutNode')
            n.insertChild(1, 3, 1)
            const removed = n.registerBinding(3, 'modifier')
            n.removeChild(1, 3)
            n.deleteNode(3)
            n.createNode(3, 'LayoutNode')
            n.insertChild(1, 3, 1)
            const recreated = n.registerBinding(3, 'modifier')
            rejects(() => n.updateBinding(removed, text('旧代际')))
            n.updateBinding(recreated, text('新代际'))
        )JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        frame(host, scene, pipeline, published);
        check(test_support::textOf(scene.node(2)) == "修改后", "正式文本绑定没有交付结果");
        check(test_support::textOf(scene.node(3)) == "新代际" && scene.bindingCount() == 2, "删除后存在旧绑定或旧代际写入");
    }

    void verifyModifierInstanceBindings() {
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("instance-input.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            const reject = fn => { try { fn() } catch { return }; throw new Error('Expected rejection') }
            for (const id of [-1, 0, 1.5, NaN, Infinity, 4294967297, '1']) reject(() => void (n.createNode(id, 'LayoutNode'), n.updateBinding(n.registerBinding(id, 'measurePolicy'), {kind: 'Box'})))
            n.createNode(1, 'LayoutNode')
            const background = color => ({type: 'background', key: 'bg', value: {color}})
            const click = (key, value) => ({type: 'clickable', key, value: {onClick: () => n.setProp(1, 'contentDescription', value)}})
            const chain = n.registerBinding(1, 'modifier')
            n.updateBinding(chain, {elements: [background(0xff000000), click('outer', 'outer'), click('inner', 'inner')]})
            let bg, inner, old
            n.createNode(2, 'LayoutNode')
            n.insertChild(1, 2, 0)
            n.setModifier(2, {elements: [{type: 'textField', value: {value: '', onSubmit: command => {
                if (command === 'bind') {
                    const instances = n.modifierInstances(1)
                    if (instances.length !== 3) throw new Error('Missing published instances')
                    const target = instances.find(item => item.key === 'bg')
                    bg = n.registerModifierBinding(1, target)
                    old = n.registerModifierBinding(1, target)
                    reject(() => n.updateBinding(bg, background(1)))
                    bg = old
                    inner = n.registerModifierBinding(1, instances.find(item => item.key === 'inner'))
                    reject(() => n.updateBinding(bg, {type: 'width', value: {value: 40}}))
                    n.updateBinding(bg, background(0xff112233))
                    n.updateBinding(inner, click('inner', 'changed'))
                    n.updateBinding(inner, click('inner', 'changed again'))
                } else if (command === 'reorder') {
                    n.updateBinding(chain, {elements: [click('inner', 'moved'), background(0xff112233), click('outer', 'outer')]})
                } else if (command === 'write') {
                    n.updateBinding(bg, background(0xffabcdef))
                } else if (command === 'remove') {
                    n.updateBinding(chain, {elements: []})
                } else {
                    let decoded = false
                    reject(() => n.updateBinding(bg, {get type() { decoded = true }}))
                    if (decoded) throw new Error('Retired instance payload decoded')
                    n.setProp(1, 'contentDescription', 'retired')
                }
            }}}]})
        )JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        frame(host, scene, pipeline, published);
        const auto submit = test_support::event(scene.node(2), EventSlotKind::InputSubmit);
        const auto original = scene.node(1).modifier.elements()[0].handle;
        const auto send = [&](const char* command) {
            const auto result = host.invokeEventSlot(submit, {.hasStringArgument = true, .stringArgument = command});
            if (!result.ok) throw std::runtime_error(result.error);
            frame(host, scene, pipeline, published);
        };
        send("bind");
        check(scene.node(1).modifier.elements()[0].handle == original && std::get<PaintStyleSemantics>(scene.node(1).modifier.elements()[0].descriptor.value).color == 0xff112233, "instance input did not preserve target identity");
        check(host.eventSlotCount() == 3 && scene.eventSlotCount() == 3, "direct callback updates leaked or retired a sibling");
        check(host.rejectedBindingUpdates() == 1, "QuickJS early stale rejection was not counted");
        const auto inner = modifierEventSlot(scene.node(1).modifier.elements()[2].descriptor.value);
        check(host.invokeEventSlot(inner).ok, "new instance callback unavailable");
        frame(host, scene, pipeline, published);
        check(scene.node(1).props.at("contentDescription").stringOr() == "changed again", "direct callback input retained obsolete closure");
        send("reorder");
        check(scene.node(1).modifier.elements()[1].handle == original, "keyed reorder changed instance handle");
        send("write");
        check(std::get<PaintStyleSemantics>(scene.node(1).modifier.elements()[1].descriptor.value).color == 0xffabcdef, "instance binding followed old chain index");
        send("remove");
        check(host.modifierInstanceCount() == 1 && host.bindingCount() == scene.bindingCount() && host.eventSlotCount() == 1, "retired instance retained JS/native resources");
        send("late");
        check(scene.node(1).props.at("contentDescription").stringOr() == "retired" && host.rejectedBindingUpdates() == 2, "late instance input accepted");
    }

    void verifyCallbackReceiverIdentity() {
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("回调受体身份.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            n.createNode(1, 'Root')
            n.createNode(2, 'LayoutNode')
            n.createNode(3, 'LayoutNode')
            n.createNode(4, 'LayoutNode')
            n.insertChild(1, 2, 0)
            n.insertChild(2, 3, 0)
            n.insertChild(3, 4, 0)
            const chain = n.registerBinding(4, 'modifier')
            const callback = () => n.setProp(1, 'contentDescription', '正式回调')
            const field = key => ({type: 'textField', key, value: {value: '', onSubmit: callback}})
            n.updateBinding(chain, {elements: [field('旧受体')]})
            n.setModifier(1, {elements: [{type: 'textField', value: {value: '', onSubmit: command => {
                if (command === '移动') n.updateBinding(chain, {elements: [{type: 'padding', value: {start: 3, top: 3, end: 3, bottom: 3}}, field('旧受体')]})
                if (command === '替换') n.updateBinding(chain, {elements: [field('新受体')]})
                if (command === '重建') {
                    n.updateBinding(chain, {elements: []})
                    n.updateBinding(chain, {elements: [field('新受体')]})
                }
                if (command === '删除') {
                    n.deleteNode(2)
                    let rejected = false
                    try { n.updateBinding(chain, {elements: []}) } catch { rejected = true }
                    if (!rejected) throw new Error('后代绑定未随子树退休')
                }
            }}}]})
        )JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        frame(host, scene, pipeline, published);
        const auto control = test_support::event(scene.node(1), EventSlotKind::InputSubmit);
        const auto oldSlot = test_support::event(scene.node(4), EventSlotKind::InputSubmit);
        const auto oldHandle = test_support::editable(scene.node(4))->handle;
        const auto send = [&](const char* command) {
            const auto result = host.invokeEventSlot(control, {.hasStringArgument = true, .stringArgument = command});
            if (!result.ok) throw std::runtime_error(result.error);
            frame(host, scene, pipeline, published);
        };

        send("移动");
        check(test_support::editable(scene.node(4))->handle == oldHandle && test_support::event(scene.node(4), EventSlotKind::InputSubmit) == oldSlot, "同一 key 的移动没有保留实例与回调");
        send("替换");
        const auto nextSlot = test_support::event(scene.node(4), EventSlotKind::InputSubmit);
        check(test_support::editable(scene.node(4))->handle != oldHandle && nextSlot != oldSlot, "同一函数错误复用了已退休受体的回调资源");
        check(!host.invokeEventSlot(oldSlot).ok && host.invokeEventSlot(nextSlot).ok, "回调退休没有区分旧受体与新受体");
        frame(host, scene, pipeline, published);
        check(scene.node(1).props.at("contentDescription").stringOr() == "正式回调", "新受体回调没有执行");

        send("重建");
        check(!host.invokeEventSlot(nextSlot).ok, "同事务删除再创建沿用了旧回调身份");
        const auto recreatedSlot = test_support::event(scene.node(4), EventSlotKind::InputSubmit);
        send("删除");
        check(!scene.contains(2) && !scene.contains(3) && !scene.contains(4), "子树退休遗漏了后代节点");
        check(host.bindingCount() == scene.bindingCount() && host.eventSlotCount() == 1 && scene.eventSlotCount() == 1, "子树退休遗漏绑定或回调");
        check(!host.invokeEventSlot(recreatedSlot).ok, "子树退休后仍接受迟到回调");
    }

    void verifyCallbackPublication() {
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("回调发布.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            n.beginRearrange()
            n.createNode(1, 'LayoutNode')
            const chain = n.registerBinding(1, 'modifier')
            const content = label => ({elements: [{type: 'textField', value: {value: label, onSubmit: () => n.setProp(1, 'contentDescription', label)}}]})
            n.updateBinding(chain, content('旧回调'))
            n.submitRearrange(error => {
                if (error) throw new Error(error)
                n.beginRearrange()
                n.updateBinding(chain, content('候选回调'))
                n.submitRearrange(error => { if (!error) throw new Error('必须拒绝非法候选') })
            })
        )JS");
        check(loaded.ok, "回调发布夹具执行失败");
        auto initial = host.takePendingTransaction();
        EventSlotId original;
        for (const auto& op : initial->operations)
            if (const auto* registration = std::get_if<RegisterEventSlot>(&op)) original = registration->slot;
        check(original.valid() && !host.invokeEventSlot(original).ok, "未发布回调提前可调用");
        check(!pipeline.run(scene, 1, {0, 400, 0, 300}, &*initial, true, published).error, "首轮发布失败");
        host.publishScene(scene);
        check(host.completeRearrange(initial->rearrange).ok, "首轮回执失败");
        auto replacement = host.takePendingTransaction();
        EventSlotId next;
        for (const auto& op : replacement->operations)
            if (const auto* registration = std::get_if<RegisterEventSlot>(&op)) next = registration->slot;
        check(next.valid() && next != original && !host.invokeEventSlot(next).ok, "候选回调身份或调用资格错误");
        replacement->operations.emplace_back(InsertChildMutation{1, 1, 0});
        const auto revision = published.revision;
        const auto failed = pipeline.run(scene, 1, {0, 400, 0, 300}, &*replacement, true, published);
        check(failed.error.has_value(), "非法候选未被拒绝");
        check(host.completeRearrange(replacement->rearrange, *failed.error).ok, "失败回执清理失败");
        check(published.revision == revision && scene.hasEventSlot(original) && !scene.hasEventSlot(next), "失败候选污染已发布资源");
        check(host.invokeEventSlot(original).ok && !host.invokeEventSlot(next).ok, "失败后旧回调不能继续使用");
        frame(host, scene, pipeline, published);
        check(scene.node(1).props.at("contentDescription").stringOr() == "旧回调" && host.eventSlotCount() == 1, "回滚没有保留旧回调或泄漏候选");
    }

}  // namespace

int main() {
    try {
        {
            QuickJsScriptHost host;
            const auto caught = host.executeModule("caught-async.js", "void (globalThis.__ARRANGE_NATIVE__.createNode(1, 'LayoutNode'), globalThis.__ARRANGE_NATIVE__.updateBinding(globalThis.__ARRANGE_NATIVE__.registerBinding(1, 'measurePolicy'), {kind: 'Box'})); Promise.reject(new Error('handled')).catch(() => {})");
            check(caught.ok, "same-turn Promise rejection handler was ignored");
            const auto unhandled = host.executeModule("unhandled-async.js", "void (globalThis.__ARRANGE_NATIVE__.createNode(1, 'LayoutNode'), globalThis.__ARRANGE_NATIVE__.updateBinding(globalThis.__ARRANGE_NATIVE__.registerBinding(1, 'measurePolicy'), {kind: 'Box'})); Promise.resolve().then(() => { throw new Error('async value failure') })");
            check(!unhandled.ok && unhandled.error.find("async value failure") != std::string::npos, "unhandled scheduler-style Promise rejection was swallowed");
        }
        verifyExplicitBindings();
        verifyModifierInstanceBindings();
        verifyCallbackPublication();
        verifyCallbackReceiverIdentity();
        {
            QuickJsScriptHost schemaHost;
            const auto schema = schemaHost.executeModule("modifier-schema.js", R"JS(
                const n = globalThis.__ARRANGE_NATIVE__
                void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
                const rejects = (element, field) => {
                    try { n.setModifier(1, { elements: [element] }) }
                    catch (error) {
                        if (!String(error).includes(field)) throw new Error(`错误缺少字段定位：${field}`)
                        return
                    }
                    throw new Error(`无效参数被接受：${field}`)
                }
                rejects({ type: 'graphicsLayer', value: { translation: 30 } }, 'translation')
                rejects({ type: 'background', value: { brush: { type: 'solidColor', color: 1, extra: 2 } } }, 'extra')
                rejects({ type: 'clip', value: { shape: { type: 'rounded', radius: 8, extra: 2 } } }, 'extra')
                rejects({ type: 'graphicsLayer', value: { transformOrigin: 'Typo' } }, 'transformOrigin')
                rejects({ type: 'clickable', value: { onClick: 42 } }, 'onClick')
                rejects({ type: 'align', value: { alignment: 'Centre' } }, 'Centre')
                n.setModifier(1, { elements: [{ type: 'background', value: { brush: { type: 'solidColor', color: 0xff123456 } } }] })
            )JS");
            if (!schema.ok) throw std::runtime_error(schema.error);

            NativeScene schemaScene;
            SceneFramePipeline schemaPipeline;
            PublishedFrame schemaFrame;
            frame(schemaHost, schemaScene, schemaPipeline, schemaFrame);
            check(schemaHost.eventSlotCount() == 0 && exportDrawOps(schemaFrame.content.scenePaint).size() == 1, "参数拒绝后不能残留回调或污染下一次有效提交");
        }
        {
            QuickJsScriptHost host;
            NativeScene scene;
            SceneFramePipeline pipeline;
            PublishedFrame published;
            const auto loaded = host.executeModule("enum-schema.js", R"JS(
                const n = globalThis.__ARRANGE_NATIVE__
                void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
                void (n.createNode(2, 'LayoutNode'), n.updateBinding(n.registerBinding(2, 'measurePolicy'), {kind: 'MinSize'}))
                n.insertChild(1, 2, 0)
                n.createNode(3, 'LayoutNode')
                n.insertChild(1, 3, 1)
                const scale = n.registerBinding(2, 'modifier')
                const text = textAlign => ({elements: [{type: 'text', value: {text: '文本', textAlign}}]})
                n.updateBinding(scale, text('left'))
                n.setModifier(3, {elements: [{type: 'textField', value: {value: '', onSubmit: value => n.updateBinding(scale, text(value))}}]})
            )JS");
            if (!loaded.ok) throw std::runtime_error(loaded.error);
            frame(host, scene, pipeline, published);
            const auto revision = published.revision;
            const auto bindings = scene.bindingCount();

            EventSlotId submit;
            for (const auto& slot : scene.activeEventSlots())
                if (slot.kind == EventSlotKind::InputSubmit) submit = slot;
            const auto invalid = host.invokeEventSlot(submit, {true, "middel"});
            if (invalid.ok || invalid.error.find("textAlign") == std::string::npos || invalid.error.find("middel") == std::string::npos || invalid.error.find("enum-schema.js") == std::string::npos) throw std::runtime_error("枚举错误必须包含字段、输入值和脚本来源：" + invalid.error);
            check(std::get<TextModifier>(scene.node(2).modifier.elements()[0].descriptor.value).textAlign == "Start" && published.revision == revision, "非法枚举污染了已发布状态");

            const auto recovered = host.invokeEventSlot(submit, {true, "Center"});
            if (!recovered.ok) throw std::runtime_error(recovered.error);
            frame(host, scene, pipeline, published);
            check(std::get<TextModifier>(scene.node(2).modifier.elements()[0].descriptor.value).textAlign == "Center" && scene.bindingCount() == bindings, "枚举拒绝后有效值应正常恢复且复用绑定");
        }
        {
            QuickJsScriptHost unstable;
            const auto result = unstable.executeModule("unstable-jobs.js", R"JS(
                void (globalThis.__ARRANGE_NATIVE__.createNode(1, 'LayoutNode'), globalThis.__ARRANGE_NATIVE__.updateBinding(globalThis.__ARRANGE_NATIVE__.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
                const again = () => Promise.resolve().then(again)
                again()
            )JS");
            check(!result.ok && result.error.find("超过检查点数量预算") != std::string::npos, "unbounded microtask loop escaped the frame work budget");
        }
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("modifier-onion.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
            const size = {type: 'size', value: {width: 100, height: 80}}
            const outer = () => n.setProp(1, 'contentDescription', 'outer')
            const inner = () => {
                n.setProp(1, 'contentDescription', 'inner')
                n.setModifier(1, {elements: [size]})
            }
            n.setModifier(1, {elements: [
                size,
                {type: 'background', value: {color: 0xffff0000}},
                {type: 'clickable', key: 'outer', value: {onClick: outer}},
                {type: 'padding', value: {start: 10, top: 10, end: 10, bottom: 10}},
                {type: 'graphicsLayer', value: {translationX: 50}},
                {type: 'background', value: {color: 0xff0000ff}},
                {type: 'clickable', key: 'inner', value: {onClick: inner}}
            ]})
        )JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        frame(host, scene, pipeline, published);
        check(host.eventSlotCount() == 2 && scene.eventSlotCount() == 2, "repeated clickable did not own independent callbacks");
        const auto outerHit = HitTester().hitTestClickable(scene.tree(), 1, {5, 5});
        const auto innerHit = HitTester().hitTestClickable(scene.tree(), 1, {65, 15});
        check(outerHit.hit && innerHit.hit && outerHit.eventSlot != innerHit.eventSlot && outerHit.modifier != innerHit.modifier, "QuickJS descriptors collapsed interaction instances");
        check(exportDrawOps(published.content.scenePaint).size() == 4 && exportDrawOps(published.content.scenePaint)[2].rect == Rect{10, 10, 80, 60}, "QuickJS path lost ordered paint geometry");
        check(host.invokeEventSlot(outerHit.eventSlot).ok, "outer callback could not execute");
        frame(host, scene, pipeline, published);
        check(scene.node(1).props.at("contentDescription").stringOr() == "outer", "wrong outer callback ran");
        check(host.invokeEventSlot(innerHit.eventSlot).ok, "inner callback could not execute");
        frame(host, scene, pipeline, published);
        check(scene.node(1).props.at("contentDescription").stringOr() == "inner" && host.eventSlotCount() == 0 && scene.eventSlotCount() == 0, "chain replacement leaked retired callbacks");
        check(!host.invokeEventSlot(innerHit.eventSlot).ok, "retired callback accepted");
        const auto removedInOneSubmission = host.executeModule("retire-before-publish.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
            n.setModifier(1, {elements: [{type: 'clickable', value: {onClick: () => {}}}]})
            n.setModifier(1, {elements: []})
        )JS");
        check(removedInOneSubmission.ok, "same-submission retirement script failed");
        scene.reset();
        frame(host, scene, pipeline, published);
        check(host.eventSlotCount() == 0 && scene.eventSlotCount() == 0, "same-submission retirement resurrected callback");
        const auto bad = host.executeModule("invalid-modifier.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
            n.setModifier(1, {elements: [
                {type: 'clickable', value: {onClick: () => {}}},
                {type: 'size', value: {width: NaN, height: 20}}
            ]})
        )JS");
        check(!bad.ok && host.eventSlotCount() == 0, "invalid chain leaked callback before validation");
        const auto reloaded = host.executeModule("fresh-modifier.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
            n.setModifier(1, {elements: [{type: 'clickable', value: {onClick: () => {}}}]})
        )JS");
        check(reloaded.ok && !host.invokeEventSlot(outerHit.eventSlot).ok, "context reset accepted old callback token");
        std::cout << "QuickJS Modifier: ordered geometry, independent callbacks, retirement and reset passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
