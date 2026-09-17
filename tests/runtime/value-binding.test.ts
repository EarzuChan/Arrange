import test from 'node:test'
import assert from 'node:assert/strict'
import * as runtime from '../../packages/runtime/src/index.ts'
import {compile} from '../../packages/arrange-vue-compiler-arrange/src/index.ts'
import type {NativeTransactionTarget, NativePropValue, Modifier} from '../../packages/runtime/src/index.ts'

function nativeTarget() {
    let identity = 1n
    const bindings = new Map<bigint, {node: number; input: string}>()
    const values = new Map<string, unknown>()
    const writes: string[] = []
    const nodes = new Map<number, {type: string; children: number[]}>()
    const removeNode = (id: number) => {
        for (const child of nodes.get(id)?.children ?? []) removeNode(child)
        assert.ok(![...bindings.values()].some(binding => binding.node === id), 'delete before binding retirement')
        nodes.delete(id)
    }
    const target: NativeTransactionTarget = {
        createNode(id, type) {
            assert.ok(!nodes.has(id), 'duplicate native node')
            assert.ok(['Root', 'Column', 'Row', 'Box', 'Text', 'Input', 'Spacer'].includes(type), `unexpected native type ${type}`)
            nodes.set(id, {type, children: []})
        },
        insertChild(parent, child, index) {
            assert.ok(nodes.has(parent) && nodes.has(child))
            for (const node of nodes.values()) node.children = node.children.filter(id => id !== child)
            nodes.get(parent)!.children.splice(index, 0, child)
        },
        removeChild(parent, child) {
            const node = nodes.get(parent)!
            node.children = node.children.filter(id => id !== child)
        },
        deleteNode: removeNode,
        unmount() { bindings.clear(); nodes.clear() },
        registerBinding(node, input) {
            const handle = {identity: identity++, generation: 1n}
            bindings.set(handle.identity, {node, input})
            return handle
        },
        updateBinding(handle, value) {
            const binding = bindings.get(handle.identity)
            assert.ok(binding, 'write to disposed native binding')
            const key = `${binding.node}:${binding.input}`
            values.set(key, value)
            writes.push(key)
        },
        releaseBinding(handle) { bindings.delete(handle.identity) },
    }
    return {target, bindings, values, writes, nodes}
}

async function flush() { await runtime.nextTick(); await Promise.resolve() }

test('value expressions cross component props and computed without structural renders', async () => {
    const native = nativeTarget()
    const color = runtime.ref(1)
    let parentRenders = 0, childRenders = 0, setups = 0
    const Child = runtime.defineComponent({
        props: ['color'],
        setup(props: {color: number}) {
            setups++
            const doubled = runtime.computed(() => props.color * 2)
            return () => {
                childRenders++
                return runtime.h(runtime.Text, {text: runtime.arrangeValue(() => `color ${doubled.value}`)})
            }
        },
    })
    const app = runtime.createApp({setup() {
        return () => {
            parentRenders++
            return runtime.createVNode(Child, {color: runtime.arrangeValue(() => color.value)})
        }
    }})
    app.mount(native.target)
    assert.equal(native.values.get('2:text'), 'color 2')
    native.writes.length = 0
    color.value = 4
    await flush()
    assert.equal(native.values.get('2:text'), 'color 8')
    assert.equal(parentRenders, 1)
    assert.equal(childRenders, 1)
    assert.equal(setups, 1)
    assert.deepEqual(native.writes, ['2:text'])
    app.unmount()
})

test('compiler places ordinary template reads in independent bindings', async () => {
    const native = nativeTarget()
    const color = runtime.ref(2)
    let structures = 0
    const {code} = compile('<Text :text="label(color)" />', {
        mode: 'function', prefixIdentifiers: true, isCustomElement: tag => tag === 'Text',
    })
    assert.match(code, /arrangeValue/)
    const render = new Function('Vue', code)(runtime)
    const app = runtime.createApp({setup() {
        return () => { structures++; return render({color, label: (value: {value: number}) => `value ${value.value}`}) }
    }})
    app.mount(native.target)
    assert.equal(native.values.get('2:text'), 'value 2')
    color.value = 7
    await flush()
    assert.equal(native.values.get('2:text'), 'value 7')
    assert.equal(structures, 1)
    app.unmount()
})

test('branch deletion stops queued binding effects and retires native handles', async () => {
    const native = nativeTarget()
    const shown = runtime.ref(true)
    const label = runtime.ref('before')
    let reads = 0
    const app = runtime.createApp({setup: () => () => runtime.h(runtime.Column, null,
        shown.value ? [runtime.h(runtime.Text, {text: runtime.arrangeValue(() => { reads++; return label.value })})] : [],
    )})
    app.mount(native.target)
    const active = native.bindings.size
    native.writes.length = 0
    label.value = 'after'
    shown.value = false
    await flush()
    assert.equal(reads, 1)
    assert.ok(native.bindings.size < active)
    assert.ok(!native.writes.includes('3:text'))
    app.unmount()
})


test('one ref may drive both structure and values while bindings follow keyed instances', async () => {
    const native = nativeTarget()
    const color = runtime.ref(1)
    const rows = runtime.ref([{id: 'a', text: 'A'}, {id: 'b', text: 'B'}])
    const switchRead = runtime.ref(true)
    const secondary = runtime.ref(8)
    let structures = 0, evaluations = 0
    const app = runtime.createApp({setup: () => () => {
        structures++
        return runtime.h(runtime.Column, null, rows.value.map((item, index) => runtime.h(runtime.Text, {
            key: item.id,
            text: runtime.arrangeValue(() => `${item.text}:${index}:${color.value}`),
            modifier: runtime.arrangeValue(() => {
                evaluations++
                return runtime.m.background(switchRead.value ? color.value : secondary.value)
            }),
        })))
    }})
    app.mount(native.target)
    const originalHandles = [...native.bindings.keys()]
    rows.value = [{id: 'b', text: 'new B'}, {id: 'a', text: 'new A'}]
    await flush()
    assert.equal(native.values.get('3:text'), 'new A:1:1')
    assert.equal(native.values.get('4:text'), 'new B:0:1')
    assert.deepEqual([...native.bindings.keys()], originalHandles)
    const renders = structures
    color.value = 3
    await flush()
    assert.equal(structures, renders)
    assert.equal(native.values.get('3:text'), 'new A:1:3')
    switchRead.value = false
    await flush()
    const afterSwitch = evaluations
    color.value = 5
    await flush()
    assert.equal(evaluations, afterSwitch)
    secondary.value = 10
    await flush()
    assert.equal(evaluations, afterSwitch + 2)
    app.unmount()
})

test('compiled object literals, interpolation and native v-model keep value dependencies out of structure', async () => {
    const native = nativeTarget()
    const model = runtime.ref('first')
    const color = runtime.ref(10)
    let renders = 0
    const {code} = compile('<Column><Text :text-style="{color: color.value}" >Hello {{ model.value }}</Text><Input v-model="model.value" /></Column>', {mode: 'function', prefixIdentifiers: true})
    const render = new Function('Vue', code)(runtime)
    const app = runtime.createApp({setup: () => () => { renders++; return render({model, color}, []) }})
    app.mount(native.target)
    assert.equal(native.values.get('3:text'), 'Hello first', code + JSON.stringify([...native.values]))
    assert.deepEqual(native.values.get('3:text-style'), {color: 10})
    const update = native.values.get('4:onUpdate:modelValue') as (value: string) => void
    assert.equal(typeof update, 'function')
    update('second')
    color.value = 20
    await flush()
    assert.equal(native.values.get('3:text'), 'Hello second')
    assert.equal(native.values.get('4:modelValue'), 'second')
    assert.deepEqual(native.values.get('3:text-style'), {color: 20})
    assert.equal(renders, 1)
    app.unmount()
})

test('one ref drives branch structure and color without duplicate value evaluation', async () => {
    const native = nativeTarget()
    const value = runtime.ref(1)
    let evaluations = 0, renders = 0
    const app = runtime.createApp({setup: () => () => {
        renders++
        return runtime.h(runtime.Column, null, value.value > 0 ? [runtime.h(runtime.Text, {
            text: runtime.arrangeValue(() => { evaluations++; return String(value.value) }),
        })] : [])
    }})
    app.mount(native.target)
    value.value = 2
    await flush()
    assert.equal(renders, 2)
    assert.equal(evaluations, 2)
    assert.equal(native.values.get('3:text'), '2')
    value.value = 0
    await flush()
    assert.equal(evaluations, 2)
    app.unmount()
})

test('attribute fallthrough crosses two wrapper components without their render effects', async () => {
    const native = nativeTarget()
    const label = runtime.ref('before')
    let outer = 0, inner = 0
    const Inner = {setup: () => () => { inner++; return runtime.h(runtime.Text) }}
    const Outer = {setup: () => () => { outer++; return runtime.h(Inner) }}
    const app = runtime.createApp({setup: () => () => runtime.h(Outer, {text: runtime.arrangeValue(() => label.value)})})
    app.mount(native.target)
    assert.equal(native.values.get('2:text'), 'before')
    label.value = 'after'
    await flush()
    assert.equal(native.values.get('2:text'), 'after')
    assert.equal(outer, 1)
    assert.equal(inner, 1)
    app.unmount()
})

test('cloned mounted vnodes retain expression sources and do not write the original host during mounting', async () => {
    const native = nativeTarget()
    const label = runtime.ref('before')
    const duplicate = runtime.ref(false)
    const cached = runtime.h(runtime.Text, {text: runtime.arrangeValue(() => label.value)})
    const app = runtime.createApp({setup: () => () => runtime.h(runtime.Column, null, duplicate.value
        ? [cached, runtime.cloneVNode(cached, {key: 'copy'})] : [cached])})
    app.mount(native.target)
    duplicate.value = true
    await flush()
    native.writes.length = 0
    label.value = 'after'
    await flush()
    assert.equal(native.values.get('3:text'), 'after')
    assert.equal(native.values.get('4:text'), 'after')
    assert.deepEqual(native.writes.sort(), ['3:text', '4:text'])
    app.unmount()
})

test('native compiler rejects browser semantics at their source location', () => {
    for (const source of ['<div />', '<Text class="foo" />', '<Text :style="value" />', '<Input @change.stop="handler" />']) {
        assert.throws(() => compile(source), error => error instanceof SyntaxError && !!(error as SyntaxError & {loc?: unknown}).loc)
    }
})

test('spread values stay independent while key changes coordinate and removed inputs reset', async () => {
    const native = nativeTarget()
    const color = runtime.ref(1)
    const fields = runtime.ref({placeholder: 'before'} as Record<string, unknown>)
    const nodeKey = runtime.ref('a')
    let renders = 0
    const {code} = compile('<Input :key="nodeKey.value" v-bind="fields.value" :text-style="{color: color.value}" />', {mode: 'function', prefixIdentifiers: true})
    const render = new Function('Vue', code)(runtime)
    const app = runtime.createApp({setup: () => () => { renders++; return render({color, fields, nodeKey}, []) }})
    app.mount(native.target)
    color.value = 2
    fields.value.placeholder = 'after'
    await flush()
    assert.equal(renders, 1)
    assert.deepEqual(native.values.get('2:text-style'), {color: 2})
    assert.equal(native.values.get('2:placeholder'), 'after')
    delete fields.value.placeholder
    await flush()
    assert.equal(renders, 2)
    assert.equal(native.values.get('2:placeholder'), null)
    nodeKey.value = 'b'
    await flush()
    assert.equal(renders, 3)
    assert.ok(!native.nodes.has(2))
    assert.deepEqual(native.nodes.get(1)?.children, [3])
    app.unmount()
    assert.equal(native.bindings.size, 0)
})

test('compiled keyed fragments, empty branches and root replacement preserve native order', async () => {
    const native = nativeTarget()
    const rows = runtime.ref([{id: 'a', name: 'A'}, {id: 'b', name: 'B'}])
    const shown = runtime.ref(true)
    const {code} = compile('<Column v-if="shown.value"><Text v-for="row in rows.value" :key="row.id">{{ row.name }}</Text></Column><Input v-else model-value="replacement" />', {mode: 'function', prefixIdentifiers: true})
    const render = new Function('Vue', code)(runtime)
    const app = runtime.createApp({setup: () => () => render({rows, shown}, [])})
    app.mount(native.target)
    assert.deepEqual(native.nodes.get(2)?.children, [3, 4])
    rows.value.reverse()
    await flush()
    assert.deepEqual(native.nodes.get(2)?.children, [4, 3])
    shown.value = false
    await flush()
    assert.deepEqual(native.nodes.get(1)?.children, [5])
    assert.deepEqual([...native.nodes.keys()], [1, 5])
    shown.value = true
    rows.value = []
    await flush()
    assert.equal(native.nodes.size, 2)
    rows.value.push({id: 'c', name: 'C'})
    await flush()
    const root = native.nodes.get(1)!.children[0]
    assert.equal(native.nodes.get(root)!.children.length, 1)
    app.unmount()
})

test('branch churn releases effects from the living owner scope', async () => {
    const native = nativeTarget()
    const shown = runtime.ref(true)
    const label = runtime.ref('label')
    let owner: ReturnType<typeof runtime.getCurrentInstance>
    const app = runtime.createApp({setup() {
        owner = runtime.getCurrentInstance()
        return () => runtime.h(runtime.Column, null, shown.value ? [runtime.h(runtime.Text, {text: runtime.arrangeValue(() => label.value)})] : [])
    }})
    app.mount(native.target)
    const active = owner!.scope.effects.length
    for (let index = 0; index < 20; index++) {
        shown.value = !shown.value
        await flush()
        assert.ok(owner!.scope.effects.length <= active)
    }
    app.unmount()
    assert.equal(owner!.scope.effects.length, 0)
})

test('scoped slot destructuring, aliases and defaults defer to the consuming value scope', async () => {
    const native = nativeTarget()
    const color = runtime.ref<number | undefined>(3)
    let parentRenders = 0, outletRenders = 0, labels = 0
    const outletCode = compile('<Column><slot :color="color" /></Column>', {mode: 'function', prefixIdentifiers: true}).code
    const outletRender = new Function('Vue', outletCode)(runtime)
    const Outlet = {props: ['color'], setup(props: Record<string, unknown>, {slots}: {slots: unknown}) {
        return () => { outletRenders++; return outletRender(new Proxy(props, {get: (target, key) => key === '$slots' ? slots : target[key as string]}), []) }
    }}
    const parentCode = compile('<Outlet :color="color.value"><template #default="{color: ink = 9}"><Text :text="label(ink)" /></template></Outlet>', {mode: 'function', prefixIdentifiers: true}).code
    const parentRender = new Function('Vue', parentCode)(runtime)
    const app = runtime.createApp({components: {Outlet}, setup: () => () => {
        parentRenders++
        return parentRender({color, label(value: unknown) { assert.equal(typeof value, 'number'); labels++; return `ink ${value}` }}, [])
    }})
    app.mount(native.target)
    assert.equal(native.values.get('3:text'), 'ink 3', parentCode)
    color.value = 7
    await flush()
    assert.equal(native.values.get('3:text'), 'ink 7')
    color.value = undefined
    await flush()
    assert.equal(native.values.get('3:text'), 'ink 9')
    assert.equal(labels, 3)
    assert.equal(parentRenders, 1)
    assert.equal(outletRenders, 1)
    app.unmount()
})

test('slot aliases preserve inner callback lexical shadowing', () => {
    const {code} = compile('<Outlet #default="{color}"><Text :text="[1, 2].map(color => color * 2).join() + color" /></Outlet>', {mode: 'function', prefixIdentifiers: true})
    assert.match(code, /color => color \* 2/)
    const native = nativeTarget()
    const Outlet = runtime.defineComponent({setup(_props, {slots}) { return () => slots.default?.({color: 5}) }})
    const render = new Function('Vue', code)(runtime)
    const app = runtime.createApp({components: {Outlet}, setup: () => () => render({}, [])})
    app.mount(native.target)
    assert.equal(native.values.get('2:text'), '2,45')
    app.unmount()
})

test('ordinary render prop changes update child consumers and defaults without forcing its structure', async () => {
    const native = nativeTarget()
    const value = runtime.ref<number | undefined>(1)
    let childRenders = 0
    const Child = runtime.defineComponent({props: {value: {type: Number, default: 7}}, setup(props) {
        return () => { childRenders++; return runtime.h(runtime.Text, {text: runtime.arrangeValue(() => String(props.value))}) }
    }})
    const app = runtime.createApp({setup: () => () => runtime.h(Child, {value: value.value})})
    app.mount(native.target)
    value.value = 2
    await flush()
    assert.equal(native.values.get('2:text'), '2')
    value.value = undefined
    await flush()
    assert.equal(native.values.get('2:text'), '7')
    assert.equal(childRenders, 1)
    app.unmount()
})

test('structural child prop reads and pre watchers still update before value consumers', async () => {
    const native = nativeTarget()
    const value = runtime.ref(1)
    const order: string[] = []
    const Child = runtime.defineComponent({props: ['value'], setup(props) {
        const derived = runtime.ref('initial')
        runtime.watch(() => props.value, current => { order.push('pre'); derived.value = `watched ${current}` })
        runtime.watch(() => props.value, () => { order.push('post') }, {flush: 'post'})
        return () => {
            order.push('structure')
            return runtime.h(props.value > 1 ? runtime.Input : runtime.Text, props.value > 1
                ? {modelValue: runtime.arrangeValue(() => { order.push('value'); return derived.value })}
                : {text: 'initial'})
        }
    }})
    const app = runtime.createApp({setup: () => () => runtime.h(Child, {value: value.value})})
    app.mount(native.target)
    order.length = 0
    value.value = 2
    await flush()
    assert.deepEqual(order, ['pre', 'structure', 'value', 'post'])
    assert.equal(native.values.get('3:modelValue'), 'watched 2')
    app.unmount()
})

test('local and fallthrough event expressions compose without structural rerenders', async () => {
    const native = nativeTarget()
    const calls: string[] = []
    const external = runtime.ref(() => calls.push('external one'))
    let renders = 0
    const Child = {setup: () => () => {
        renders++
        return runtime.h(runtime.Input, {onSubmit: runtime.arrangeValue(() => () => calls.push('local'))})
    }}
    const app = runtime.createApp({setup: () => () => runtime.h(Child, {onSubmit: runtime.arrangeValue(() => external.value)})})
    app.mount(native.target)
    ;(native.values.get('2:onSubmit') as () => void)()
    external.value = () => calls.push('external two')
    await flush()
    ;(native.values.get('2:onSubmit') as () => void)()
    assert.deepEqual(calls, ['local', 'external one', 'local', 'external two'])
    assert.equal(renders, 1)
    app.unmount()
})

test('dynamic slots and nested destructuring follow branch ownership and slot list order', async () => {
    const native = nativeTarget()
    const value = runtime.ref(3)
    const shown = runtime.ref(true)
    const names = runtime.ref(['one', 'two'])
    const outletCode = compile('<Column><slot name="one" :payload="{nested: {value: value}}" /><slot name="two" :payload="{nested: {value: value + 1}}" /></Column>', {mode: 'function', prefixIdentifiers: true}).code
    const outletRender = new Function('Vue', outletCode)(runtime)
    let structures = 0
    const Outlet = runtime.defineComponent({props: ['value'], setup(props, {slots}) {
        const context = {get value() { return props.value }, $slots: slots}
        return () => { structures++; return outletRender(context, []) }
    }})
    const code = compile('<Outlet :value="value.value"><template v-for="name in names.value" #[name]="{payload: {nested: {value: number = 9}}}"><Text v-if="shown.value" :text="name + number" /></template></Outlet>', {mode: 'function', prefixIdentifiers: true}).code
    const render = new Function('Vue', code)(runtime)
    const app = runtime.createApp({components: {Outlet}, setup: () => () => render({value, shown, names}, [])})
    const liveText = () => [...native.nodes].filter(([, node]) => node.type === 'Text').map(([id]) => native.values.get(`${id}:text`))
    app.mount(native.target)
    const baseline = runtime.getArrangeExecutionStats().activeValueBindings
    assert.deepEqual(liveText(), ['one3', 'two4'])
    value.value = 5
    await flush()
    assert.deepEqual(liveText(), ['one5', 'two6'])
    assert.equal(structures, 1)
    shown.value = false
    await flush()
    assert.deepEqual(liveText(), [])
    names.value = ['two', 'one']
    shown.value = true
    await flush()
    assert.deepEqual(liveText(), ['one5', 'two6'])
    assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, baseline)
    app.unmount()
})

test('dynamic component replacement cancels old value jobs and releases scopes', async () => {
    const native = nativeTarget()
    const value = runtime.ref('old')
    const selected = runtime.shallowRef(runtime.defineComponent({setup: () => () => runtime.h(runtime.Text, {text: runtime.arrangeValue(() => value.value)})}))
    const baseline = runtime.getArrangeExecutionStats().activeValueBindings
    const app = runtime.createApp({setup: () => () => runtime.h(selected.value)})
    app.mount(native.target)
    native.writes.length = 0
    value.value = 'new'
    selected.value = runtime.defineComponent({setup: () => () => runtime.h(runtime.Input, {modelValue: runtime.arrangeValue(() => value.value)})})
    await flush()
    assert.ok(!native.nodes.has(2))
    assert.ok(!native.writes.includes('2:text'))
    assert.equal(native.values.get('3:modelValue'), 'new')
    assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, baseline + 1)
    app.unmount()
    assert.equal(runtime.getArrangeExecutionStats().activeValueBindings, baseline)
})

test('value getter and native events use component error boundaries and recover on new dependencies', async () => {
    const native = nativeTarget()
    const value = runtime.ref(1)
    const errors: string[] = []
    const Child = runtime.defineComponent({setup() {
        return () => runtime.h(runtime.Input, {
            modelValue: runtime.arrangeValue(() => {
                if (value.value === 2) throw new Error('getter failed')
                return String(value.value)
            }),
            onSubmit: () => { throw new Error('event failed') },
        })
    }})
    const app = runtime.createApp({setup() {
        runtime.onErrorCaptured(error => { errors.push((error as Error).message); return false })
        return () => runtime.h(Child)
    }})
    app.mount(native.target)
    value.value = 2
    await flush()
    assert.equal(native.values.get('2:modelValue'), '1')
    value.value = 3
    await flush()
    assert.equal(native.values.get('2:modelValue'), '3')
    ;(native.values.get('2:onSubmit') as () => void)()
    assert.deepEqual(errors, ['getter failed', 'event failed'])
    app.unmount()
})

test('recursive watchers fail a flush instead of blocking the native frame indefinitely', async () => {
    const value = runtime.ref(0)
    const stop = runtime.watch(value, () => { value.value++ })
    value.value++
    try {
        await assert.rejects(runtime.nextTick(), /Maximum recursive updates exceeded/)
        assert.ok(value.value < 200)
    } finally { stop() }
    await runtime.nextTick()
})

test('AnimatedVisibility retains exiting structure, disables interaction immediately and cancels on unmount', async () => {
    const native = nativeTarget(), clock = runtime.createManualAnimationClock(), visible = runtime.ref(true)
    const baseline = runtime.animationStats.activeAnimations
    const app = runtime.createApp({setup: () => () => runtime.h(runtime.AnimatedVisibility, {
        visible: runtime.arrangeValue(() => visible.value), clock,
        animationSpec: runtime.tween({durationMillis: 100, easing: runtime.linearEasing}),
    }, {default: () => runtime.h('Text', {text: 'retained'})})})
    app.mount(native.target)
    const count = native.nodes.size
    visible.value = false; await flush()
    assert.equal(native.nodes.size, count)
    assert.equal(native.values.get('2:enabled'), false)
    clock.advanceBy(40); await flush()
    assert.equal(native.nodes.size, count)
    visible.value = true; await flush()
    clock.advanceBy(100); await flush()
    assert.equal(native.nodes.size, count)
    visible.value = false; await flush()
    clock.advanceBy(100); await flush()
    assert.equal(native.nodes.size, 1)
    assert.equal(native.bindings.size, 0)
    visible.value = true; await flush()
    app.unmount()
    assert.equal(clock.pendingFrames, 0)
    assert.equal(runtime.animationStats.activeAnimations, baseline)
})

test('Crossfade preserves outgoing state and resurrects interrupted content without duplicate instances', async () => {
    const native = nativeTarget(), clock = runtime.createManualAnimationClock(), selection = runtime.ref('A')
    const app = runtime.createApp({setup: () => () => runtime.h(runtime.Crossfade, {
        targetState: runtime.arrangeValue(() => selection.value), clock,
        animationSpec: runtime.tween({durationMillis: 100, easing: runtime.linearEasing}),
    }, {default: ({state}: {state: string}) => runtime.h('Text', {text: state})})})
    app.mount(native.target); await flush()
    const count = native.nodes.size
    selection.value = 'B'; await flush()
    assert.equal(native.nodes.size, count + 2)
    clock.advanceBy(40); await flush()
    selection.value = 'A'; await flush()
    assert.equal(native.nodes.size, count + 2)
    clock.advanceBy(100); await flush()
    assert.equal(native.nodes.size, count)
    selection.value = 'C'; await flush()
    app.unmount()
    assert.equal(clock.pendingFrames, 0)
})

test('proven Modifier chain isolates parameter reads while helpers and dynamic chains keep ordinary evaluation', async () => {
    const color = runtime.ref(1), width = runtime.ref(20), native = nativeTarget()
    const options = {mode: 'function' as const, prefixIdentifiers: true, bindingMetadata: {
        __arrangeModifierRoots: ['m'], m: 'setup-const', color: 'setup-ref', width: 'setup-ref',
    } as never}
    const {code} = compile('<Box :modifier="m.width(width).height(20).background(color)" />', options)
    assert.match(code, /arrangeModifier/)
    const render = new Function('Vue', code)(runtime)
    const setup = {m: runtime.m, get width() {return width.value}, get color() {return color.value}}
    const app = runtime.createApp({setup: () => () => render({}, [], {}, setup)})
    app.mount(native.target)
    const evaluations = runtime.modifierStats.parameterEvaluations
    color.value = 2; await flush()
    assert.equal(runtime.modifierStats.parameterEvaluations - evaluations, 1)
    assert.equal((native.values.get('2:modifier') as runtime.Modifier).elements[2].value.brush, 2)
    const fallback = compile('<Box :modifier="m.width(helper(width)).background(color)" />', options).code
    assert.doesNotMatch(fallback, /arrangeModifier/)
    const dynamic = compile('<Box :modifier="m.width(width).then(extra).background(color)" />', options).code
    assert.doesNotMatch(dynamic, /arrangeModifier/)
    app.unmount()
})
