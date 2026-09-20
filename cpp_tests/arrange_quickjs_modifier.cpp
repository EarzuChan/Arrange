#include <arrange/core/HitTest.h>
#include <arrange/core/SceneFramePipeline.h>
#include <arrange/quickjs/QuickJsScriptHost.h>

#include <iostream>
#include <stdexcept>

using namespace arrange::core;
using arrange::quickjs::QuickJsScriptHost;

namespace {
    void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
    void frame(QuickJsScriptHost& host, NativeScene& scene, SceneFramePipeline& pipeline, PublishedFrame& published) {
        auto submission = host.takePendingTransaction();
        check(submission.has_value(), "QuickJS did not submit changes");
        const auto result = pipeline.run(scene, 1, {0, 400, 0, 300}, &*submission, true, published);
        if (result.error) throw std::runtime_error(*result.error);
        host.publishScene(scene);
    }
    void verifyExplicitBindings() {
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("explicit-binding.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            const rejects = (fn, name) => {
                try { fn() } catch (error) { if (error instanceof Error) return }
                throw new Error(`Expected rejection: ${name}`)
            }
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
            rejects(() => n.setProp(1, 'notAnInput', 3), 'caught native schema error')
            void (n.createNode(2, 'LayoutNode'), n.updateBinding(n.registerBinding(2, 'measurePolicy'), {kind: 'Text'}), n.updateBinding(n.registerBinding(2, 'textPresentation'), 'display'))
            n.insertChild(1, 2, 0)
            const old = n.registerBinding(2, 'text')
            n.updateBinding(old, 'before')
            const current = n.registerBinding(2, 'text')
            let decoded = false
            rejects(() => n.updateBinding(old, {get bad() { decoded = true; return 1 }}), 'retired writer')
            if (decoded) throw new Error('Retired input payload was decoded')
            rejects(() => n.updateBinding({...current, identity: current.identity + (1n << 64n)}, 'wrapped'), 'overflow')
            rejects(() => n.updateBinding({...current, generation: -1n}, 'negative'), 'negative generation')
            rejects(() => n.updateBinding({...current, identity: Number(current.identity)}, 'number'), 'numeric identity')
            n.releaseBinding(old)
            rejects(() => n.updateBinding(current, 5), 'invalid text')
            n.updateBinding(current, 'after')
            const style = n.registerBinding(2, 'text-style')
            n.updateBinding(style, {fontSize: 16, color: 0xffabcdef})
            rejects(() => n.updateBinding(style, []), 'array')
            rejects(() => n.updateBinding(style, () => {}), 'function')
            rejects(() => n.updateBinding(style, {fontSize: Infinity}), 'nonfinite')
            n.updateBinding(style, null)
            n.releaseBinding(style)
            rejects(() => n.updateBinding(style, {color: 1}), 'released')
            void (n.createNode(3, 'LayoutNode'), n.updateBinding(n.registerBinding(3, 'measurePolicy'), {kind: 'Text'}), n.updateBinding(n.registerBinding(3, 'textPresentation'), 'display'))
            n.insertChild(1, 3, 1)
            const removed = n.registerBinding(3, 'text')
            n.updateBinding(removed, 'old generation')
            n.removeChild(1, 3)
            n.deleteNode(3)
            void (n.createNode(3, 'LayoutNode'), n.updateBinding(n.registerBinding(3, 'measurePolicy'), {kind: 'Text'}), n.updateBinding(n.registerBinding(3, 'textPresentation'), 'display'))
            n.insertChild(1, 3, 1)
            const recreated = n.registerBinding(3, 'text')
            rejects(() => n.updateBinding(removed, 'late'), 'deleted node')
            n.updateBinding(recreated, 'new generation')
        )JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        frame(host, scene, pipeline, published);
        check(scene.node(2).text == "after" && !scene.node(2).props.contains("textStyle"), "Explicit binding failed to update/clear input");
        check(scene.node(3).text == "new generation" && scene.bindingCount() == 7, "删除后绑定泄漏或旧代际更新被接受");
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
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Text'}), n.updateBinding(n.registerBinding(1, 'textPresentation'), 'editable'))
            const background = color => ({type: 'background', key: 'bg', value: {color}})
            const click = (key, value) => ({type: 'clickable', key, value: {onClick: () => n.setText(1, value)}})
            const chain = n.registerBinding(1, 'modifier')
            n.updateBinding(chain, {elements: [background(0xff000000), click('outer', 'outer'), click('inner', 'inner')]})
            let bg, inner, old
            n.setProp(1, 'onSubmit', command => {
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
                    n.setText(1, 'retired')
                }
            })
        )JS");
        if (!loaded.ok) throw std::runtime_error(loaded.error);
        frame(host, scene, pipeline, published);
        const auto submit = scene.node(1).eventSlots.at(EventSlotKind::InputSubmit);
        const auto original = scene.node(1).modifier.elements()[0].handle;
        const auto send = [&](const char* command) {
            const auto result = host.invokeEventSlot(submit, {.hasStringArgument = true, .stringArgument = command});
            if (!result.ok) throw std::runtime_error(result.error);
            frame(host, scene, pipeline, published);
        };
        send("bind");
        check(scene.node(1).modifier.elements()[0].handle == original &&
              std::get<PaintStyleSemantics>(scene.node(1).modifier.elements()[0].descriptor.value).color == 0xff112233,
              "instance input did not preserve target identity");
        check(host.eventSlotCount() == 3 && scene.eventSlotCount() == 3, "direct callback updates leaked or retired a sibling");
        check(host.rejectedBindingUpdates() == 1, "QuickJS early stale rejection was not counted");
        const auto inner = modifierEventSlot(scene.node(1).modifier.elements()[2].descriptor.value);
        check(host.invokeEventSlot(inner).ok, "new instance callback unavailable");
        frame(host, scene, pipeline, published);
        check(scene.node(1).text == "changed again", "direct callback input retained obsolete closure");
        send("reorder");
        check(scene.node(1).modifier.elements()[1].handle == original, "keyed reorder changed instance handle");
        send("write");
        check(std::get<PaintStyleSemantics>(scene.node(1).modifier.elements()[1].descriptor.value).color == 0xffabcdef,
              "instance binding followed old chain index");
        send("remove");
        check(host.modifierInstanceCount() == 0 && host.bindingCount() == scene.bindingCount() && host.eventSlotCount() == 1,
              "retired instance retained JS/native resources");
        send("late");
        check(scene.node(1).text == "retired" && host.rejectedBindingUpdates() == 2, "late instance input accepted");
    }

    void verifyCallbackPublication() {
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("callback-publication.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Text'}), n.updateBinding(n.registerBinding(1, 'textPresentation'), 'editable'))
            n.setText(1, 'initial')
            n.setProp(1, 'onSubmit', () => n.setText(1, 'old callback'))
            n.setModifier(1, {elements: [{type: 'clickable', value: {onClick: () => {
                n.setProp(1, 'onSubmit', () => n.setText(1, 'new callback'))
            }}}]})
        )JS");
        check(loaded.ok, "publication test could not load");
        auto initial = host.takePendingTransaction();
        check(initial.has_value(), "publication test missing initial submission");
        EventSlotId original;
        for (const auto& op : initial->operations) {
            if (const auto* registration = std::get_if<RegisterEventSlot>(&op);
                registration && registration->slot.kind == EventSlotKind::InputSubmit) original = registration->slot;
        }
        check(original.valid() && !host.invokeEventSlot(original).ok, "unpublished callback became callable");
        check(!pipeline.run(scene, 1, {0, 400, 0, 300}, &*initial, true, published).error, "publication initial frame failed");
        host.publishScene(scene);
        const auto trigger = std::get<InputModifierSemantics>(scene.node(1).modifier.elements()[0].descriptor.value).eventSlot;
        check(host.invokeEventSlot(trigger).ok, "replacement trigger failed");
        auto replacement = host.takePendingTransaction();
        check(replacement.has_value(), "callback replacement missing submission");
        EventSlotId next;
        for (const auto& op : replacement->operations) {
            if (const auto* registration = std::get_if<RegisterEventSlot>(&op)) next = registration->slot;
        }
        check(next.valid() && next != original, "node callback replacement reused resource identity");
        check(!host.invokeEventSlot(next).ok, "replacement callable before publication");
        auto invalid = *replacement;
        invalid.operations.emplace_back(InsertChildMutation{1, 1, 0});
        const auto revision = published.revision;
        check(pipeline.run(scene, 1, {0, 400, 0, 300}, &invalid, true, published).error.has_value(), "invalid frame succeeded");
        check(published.revision == revision && scene.hasEventSlot(original) && !scene.hasEventSlot(next), "failed callback frame changed live resources");
        check(host.invokeEventSlot(original).ok && !host.invokeEventSlot(next).ok, "failed publication lost old callback or exposed new one");
        auto oldInvocation = host.takePendingTransaction();
        check(oldInvocation.has_value(), "old callback did not run after failed frame");
        bool calledOld = false;
        for (const auto& op : oldInvocation->operations) {
            const auto* update = std::get_if<SlotUpdate>(&op);
            const auto* value = update ? std::get_if<PropValue>(&update->value) : nullptr;
            calledOld = calledOld || (value && value->stringOr() == "old callback");
        }
        check(calledOld, "old token called the replacement closure");
        replacement->append(std::move(*oldInvocation));
        check(!pipeline.run(scene, 1, {0, 400, 0, 300}, &*replacement, true, published).error, "valid callback frame failed");
        host.publishScene(scene);
        check(!host.invokeEventSlot(original).ok && host.eventSlotCount() == 2, "published replacement retained old resource");
        check(host.invokeEventSlot(next).ok, "published new callback unavailable");
        frame(host, scene, pipeline, published);
        check(scene.node(1).text == "new callback", "new callback did not run");
    }

}

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
                void (n.createNode(3, 'LayoutNode'), n.updateBinding(n.registerBinding(3, 'measurePolicy'), {kind: 'Text'}), n.updateBinding(n.registerBinding(3, 'textPresentation'), 'editable'))
                n.insertChild(1, 3, 1)
                const scale = n.registerBinding(2, 'textAlign')
                n.updateBinding(scale, 'left')
                n.setProp(3, 'onSubmit', value => n.updateBinding(scale, value))
            )JS");
            if (!loaded.ok) throw std::runtime_error(loaded.error);
            frame(host, scene, pipeline, published);
            const auto revision = published.revision;
            const auto bindings = scene.bindingCount();

            EventSlotId submit;
            for (const auto& slot : scene.activeEventSlots()) if (slot.kind == EventSlotKind::InputSubmit) submit = slot;
            const auto invalid = host.invokeEventSlot(submit, {true, "middel"});
            if (invalid.ok || invalid.error.find("textAlign") == std::string::npos || invalid.error.find("middel") == std::string::npos || invalid.error.find("enum-schema.js") == std::string::npos) throw std::runtime_error("枚举错误必须包含字段、输入值和脚本来源：" + invalid.error);
            check(scene.node(2).props.at("textAlign").string == "left" && published.revision == revision, "非法枚举污染了已发布状态");

            const auto recovered = host.invokeEventSlot(submit, {true, "center"});
            if (!recovered.ok) throw std::runtime_error(recovered.error);
            frame(host, scene, pipeline, published);
            check(scene.node(2).props.at("textAlign").string == "center" && scene.bindingCount() == bindings, "枚举拒绝后有效值应正常恢复且复用绑定");
        }
        {
            QuickJsScriptHost unstable;
            const auto result = unstable.executeModule("unstable-jobs.js", R"JS(
                void (globalThis.__ARRANGE_NATIVE__.createNode(1, 'LayoutNode'), globalThis.__ARRANGE_NATIVE__.updateBinding(globalThis.__ARRANGE_NATIVE__.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
                const again = () => Promise.resolve().then(again)
                again()
            )JS");
            check(!result.ok && result.error.find("did not stabilize") != std::string::npos,
                  "unbounded microtask loop escaped the frame work budget");
        }
        QuickJsScriptHost host;
        NativeScene scene;
        SceneFramePipeline pipeline;
        PublishedFrame published;
        const auto loaded = host.executeModule("modifier-onion.js", R"JS(
            const n = globalThis.__ARRANGE_NATIVE__
            void (n.createNode(1, 'LayoutNode'), n.updateBinding(n.registerBinding(1, 'measurePolicy'), {kind: 'Box'}))
            const size = {type: 'size', value: {width: 100, height: 80}}
            const outer = () => n.setText(1, 'outer')
            const inner = () => {
                n.setText(1, 'inner')
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
        check(scene.node(1).text == "outer", "wrong outer callback ran");
        check(host.invokeEventSlot(innerHit.eventSlot).ok, "inner callback could not execute");
        frame(host, scene, pipeline, published);
        check(scene.node(1).text == "inner" && host.eventSlotCount() == 0 && scene.eventSlotCount() == 0, "chain replacement leaked retired callbacks");
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
