import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { HotRuntime, type HotMessage } from '../../packages/framework/src/hotRuntime.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import { applyArrangableHmr } from '../../packages/framework/src/runtime/arrangableHmr.ts'
import { createApp, type ArrangableDefinition } from '../../packages/framework/src/index.ts'
import { requireSfaModule } from './sfaModules.ts'
import { recordingNative, mountFrame, advanceFrames } from './recordingNative.ts'

test('同批 HMR 保存旧 accept 边界，dispose/data 在新模块执行前交接', async () => {
    const events: string[] = []
    const sent: unknown[] = []
    const runtime: HotRuntime = new HotRuntime({ send: (...args) => sent.push(args), reload: () => events.push('reload'), report: error => { throw error } }, async url => {
        events.push(url)
        const hot = runtime.context('/counter.ts')
        assert.equal(hot.data.count, 42)
        hot.accept(() => events.push('new accept'))
        return { count: hot.data.count }
    })
    const old = runtime.context('/counter.ts')
    old.dispose(data => {
        data.count = 42
        events.push('dispose')
    })
    old.accept(module => events.push('old accept ' + module?.count))
    await runtime.receive({ type: 'update', updates: [{ type: 'js-update', path: '/counter.ts', acceptedPath: '/counter.ts', timestamp: 123 }] })
    assert.deepEqual(events, ['dispose', '/counter.ts?t=123', 'old accept 42'])
    old.invalidate('contract changed')
    assert.deepEqual(sent, [['vite:invalidate', { path: '/counter.ts', message: 'contract changed', firstInvalidatedBy: '/counter.ts' }]])
})

test('依赖 accept、custom off、prune 与 full reload 遵循独立生命周期', async () => {
    const events: unknown[] = []
    const runtime = new HotRuntime({ send() { }, reload: () => events.push('reload'), report: error => { throw error } }, async () => ({ value: 2 }))
    const parent = runtime.context('/parent')
    parent.accept(['/dep', '/other'], modules => events.push(modules))
    const dep = runtime.context('/dep')
    dep.dispose(data => { data.disposed = true })
    dep.prune(data => { events.push(data.disposed) })
    const listener = () => { events.push('custom') }
    parent.on('test', listener)
    await runtime.receive({ type: 'custom', event: 'test', data: {} })
    parent.off('test', listener)
    await runtime.receive({ type: 'custom', event: 'test', data: {} })
    await runtime.receive({ type: 'update', updates: [{ type: 'js-update', path: '/parent', acceptedPath: '/dep', timestamp: 1 }] })
    await runtime.receive({ type: 'prune', paths: ['/dep'] })
    await runtime.receive({ type: 'full-reload' })
    assert.deepEqual(events, ['custom', [{ value: 2 }, undefined], true, 'reload'])
})

test('模块执行失败保留旧 accept 边界，下一次修复能够接收更新', async () => {
    let broken = true
    const values: unknown[] = []
    const errors: unknown[] = []
    const runtime: HotRuntime = new HotRuntime({ send() { }, reload() { }, report: error => { errors.push(error) } }, async () => {
        runtime.context('/state')
        if (broken) throw new Error('坏模块')
        return { value: 3 }
    })
    runtime.context('/state').accept(next => { values.push(next?.value) })
    const message: HotMessage = { type: 'update', updates: [{ type: 'js-update', path: '/state', acceptedPath: '/state', timestamp: 1 }] }
    await runtime.receive(message)
    broken = false
    await runtime.receive(message)
    assert.deepEqual(values, [undefined, 3])
    assert.equal(errors.length, 1)
})

test('HotRuntime 通过 Arrange logger 记录更新接收与应用', async () => {
    const previous = globalThis.__ARRANGE_NATIVE__
    const events: unknown[][] = []
    globalThis.__ARRANGE_NATIVE__ = { diagnosticsLog: (...args: unknown[]) => { events.push(args) } } as never
    try {
        const runtime = new HotRuntime({
            send() { }, reload() { }, report: error => { throw error },
        }, async () => ({ value: 2 }))
        runtime.context('/logged').accept(module => assert.equal(module?.value, 2))
        await runtime.receive({ type: 'update', updates: [{ type: 'js-update', path: '/logged', acceptedPath: '/logged', timestamp: 1 }] })
    } finally {
        globalThis.__ARRANGE_NATIVE__ = previous
    }
    assert.deepEqual(events.map(event => [event[0], (event[1] as { code: string }).code]), [
        ['info', 'hmr.update.received'],
        ['info', 'hmr.update.applied'],
    ])
})

function evaluate(source: string, id: string, state: object = {}): ArrangableDefinition {
    Object.defineProperty(state, '__esModule', { value: true, configurable: true })
    const { code } = compileArrangeSfa(source, id, true)
    const output = ts.transpileModule(code.replaceAll('import.meta.hot', 'undefined'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: { default?: ArrangableDefinition } = {}
    new Function('require', 'exports', output)((name: string) => name === './state' ? state : requireSfaModule(name), exports)
    return exports.default!
}

test('SFA 拒绝 console API 并要求使用 Arrange logger', () => {
    assert.throws(() => compileArrangeSfa('<script>console.log("禁止")</script>', 'console.sfa'), /禁止使用 console；请使用 Arrange logger/)
    assert.throws(() => compileArrangeSfa('<script>console.warn("禁止")</script>', 'console.sfa'), /禁止使用 console；请使用 Arrange logger/)
})

test('SFA 模板更新保留 ref、setup 生命周期与 native 节点，新增模板引用可读取既有局部变量', () => {
    const id = 'hmr-template.sfa'
    let count: any
    let setups = 0
    const state = {
        capture: (value: any) => {
            count = value
            setups++
        }
    }
    const script = `<script>import {ref} from '@arrange/framework'\nimport {capture} from './state'\nconst count = ref(1)\nconst extra = ref('!')\ncapture(count)</script>`
    const root = evaluate(script + '<template><Text :text="String(count)" /></template>', id, state)
    assert.equal(root.__hmrId, id)
    const native = recordingNative()
    const app = createApp(root)
    mountFrame(app, native.target)
    count.value = 9
    advanceFrames()
    const initial = native.textNodes()[0]
    const next = evaluate(script + '<template><Text :text="String(count) + extra" /></template>', id, state)
    applyArrangableHmr(id, next)
    advanceFrames()
    assert.deepEqual(native.textNodes(), [{ id: initial.id, text: '9!' }])
    assert.equal(setups, 1)
    app.unmount()
})

test('SFA 模板更新会刷新静态参数且复用 native 节点', () => {
    const id = 'hmr-static-prop.sfa'
    const app = createApp(evaluate('<template><Text text="旧文案" /></template>', id))
    const native = recordingNative()
    mountFrame(app, native.target)
    const initial = native.textNodes()[0]
    applyArrangableHmr(id, evaluate('<template><Text text="新文案" /></template>', id))
    advanceFrames()
    assert.deepEqual(native.textNodes(), [{ id: initial.id, text: '新文案' }])
    app.unmount()
})

test('SFA 接受依赖模块更新时重建 setup，模板更新仍复用原 setup', () => {
    const id = 'hmr-dependency.sfa'
    const source = `<script>import { read } from './state'\nconst text = read()</script><template><Text :text="text" /></template>`
    const app = createApp(evaluate(source, id, { read: () => '旧依赖' }))
    const native = recordingNative()
    mountFrame(app, native.target)
    const node = native.textNodes()[0].id
    applyArrangableHmr(id, evaluate(source, id, { read: () => '新依赖' }))
    advanceFrames()
    assert.deepEqual(native.textNodes(), [{ id: node, text: '新依赖' }])
    app.unmount()
})

test('SFA 脚本更新迁移显式 ref，重建 computed 与 setup 清理，不兼容 props 则重置状态', () => {
    const id = 'hmr-script.sfa'
    let count: any
    let disposed = 0
    const state = { capture: (value: any) => { count = value }, dispose: () => { disposed++ } }
    const source = (factor: number, props = '') => `<script>import {ref, computed, onScopeDispose} from '@arrange/framework'\nimport {capture, dispose} from './state'\n${props}\nconst count = ref(1)\nconst display = computed(() => count.value * ${factor})\ncapture(count)\nonScopeDispose(dispose)</script><template><Text :text="String(display)" /></template>`
    const app = createApp(evaluate(source(2), id, state))
    const native = recordingNative()
    mountFrame(app, native.target)
    count.value = 9
    advanceFrames()
    const previous = count
    const previousNode = native.textNodes()[0].id
    applyArrangableHmr(id, evaluate(source(3), id, state))
    advanceFrames()
    assert.equal(native.textNodes()[0].text, '27')
    assert.equal(count, previous)
    assert.equal(native.textNodes()[0].id, previousNode)
    assert.equal(disposed, 1)
    applyArrangableHmr(id, evaluate(source(4, "defineProps<{ title?: string }>()"), id, state))
    advanceFrames()
    assert.equal(native.textNodes()[0].text, '4')
    assert.notEqual(count, previous)
    app.unmount()
    assert.equal(disposed, 3)
})

for (const failure of ['setup', 'native'] as const) test(`SFA ${failure} 失败回滚候选状态表，修复后重新初始化新增状态`, () => {
    const id = `hmr-rollback-${failure}.sfa`
    let count: any
    const errors: unknown[] = []
    const state = { capture: (value: any) => { count = value } }
    const source = (bonus?: number, broken = false) => `<script>import {ref} from '@arrange/framework'\nimport {capture} from './state'\nconst count = ref(1)\ncapture(count)\n${bonus === undefined ? '' : `const bonus = ref(${bonus})`}\n${broken ? "throw new Error('候选 setup 失败')" : ''}</script><template><Text :text="String(count${bonus === undefined ? '' : ' + bonus'})" /></template>`
    const app = createApp(evaluate(source(), id, state))
    app.config.errorHandler = error => { errors.push(error) }
    const native = recordingNative(false)
    mountFrame(app, native.target)
    native.finish()
    const previous = count
    const initial = native.textNodes()[0]
    applyArrangableHmr(id, evaluate(source(10, failure === 'setup'), id, state))
    advanceFrames()
    if (failure === 'native') native.finish('候选 native 失败')
    assert.equal(errors.length, 1)
    assert.deepEqual(native.textNodes(), [initial])
    applyArrangableHmr(id, evaluate(source(20), id, state))
    advanceFrames()
    native.finish()
    assert.deepEqual(native.textNodes(), [{ id: initial.id, text: '21' }])
    assert.equal(count, previous)
    app.unmount()
})
