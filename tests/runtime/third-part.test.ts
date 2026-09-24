import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { checkSfaProject } from '../../packages/vite-plugin/src/typecheck.ts'
import { createApp, ref, provide, nextTick, onMounted, onScopeDispose, watch, watchPostEffect } from '@arrange/framework'
import { Layout, Text, Input, DynamicArrangable, KeepAlive } from '@arrange/framework/foundation'
import { M, createDensity, DensityKey, MinSizeMeasurePolicy, rounded } from '@arrange/framework/ui'
import { defineArrangable } from '@arrange/framework/internal'
import { animatedNumberAsRef, linearEasing, tween } from '@arrange/framework/animation'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import { recordingNative } from './recordingNative.ts'
import { frameScope } from './frameScope.ts'
import { requireSfaModule } from './sfaModules.ts'

test('首次挂载与后续视觉失效都只由宿主帧授权，挂载通知写状态进入下一帧', async () => {
    const count = ref(0)
    const native = recordingNative()
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            onMounted(() => { count.value = 1 })
            return () => call(0, Text, { text: () => String(count.value) })
        }
    }))
    app.mount(native.target)
    await nextTick()
    assert.equal(native.nodes.size, 0)
    native.frame()
    assert.equal(count.value, 1)
    assert.equal(native.textNodes()[0].text, '0')
    await nextTick()
    assert.equal(native.textNodes()[0].text, '0')
    native.frame()
    assert.equal(native.textNodes()[0].text, '1')
    app.unmount()
})

test('共享声明按各 Layout 的 Density 转换，DP、SP 独立且 PX 不订阅倍率', () => {
    const a = createDensity(2, 3)
    const b = createDensity(4, 5)
    const declaration = M.width(8, 0).width(114, 514).clip(rounded(2, 0)).text('单位', { style: { fontSize: 10, lineHeight: 12 } }).graphicsLayer({ translationX: 7 })
    const Page = defineArrangable({
        setup(_props, { call }) {
            provide(DensityKey, b)
            return () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy, modifier: () => declaration })
        }
    })
    const native = recordingNative()
    const app = createApp(defineArrangable({
        setup: (_props, { call }) => () => {
            call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy, modifier: () => declaration })
            call(1, Page, {})
        }
    })).provide(DensityKey, a)
    app.mount(native.target)
    native.frame()
    const chains = () => [...native.nodes.values()].filter(node => node.inputs.has('modifier')).map(node => (node.inputs.get('modifier') as typeof declaration).elements)
    assert.deepEqual(chains().map(chain => chain[0].value.value), [16, 32])
    assert.deepEqual(chains().map(chain => chain[1].value.value), [742, 970])
    assert.deepEqual(chains().map(chain => (chain[3].value.style as { fontSize: number }).fontSize), [30, 50])
    assert.deepEqual(chains().map(chain => chain[4].value.translationX), [7, 7])
    assert.deepEqual(declaration.elements[0].value, { valueDp: 8, valuePx: 0 })
    assert.deepEqual(declaration.elements[1].value, { valueDp: 114, valuePx: 514 })
    a.dpScale = 3
    native.frame()
    assert.deepEqual(chains().map(chain => chain[0].value.value), [24, 32])
    assert.deepEqual(chains().map(chain => chain[1].value.value), [856, 970])
    const writes = native.writes
    a.dpScale = 3
    native.frame()
    assert.equal(native.writes, writes)
    app.unmount()
})

test('SFA 混合长度合并为双通道，保留表达式和局部遮蔽', () => {
    const source = `<template><Text :modifier="M.width(read().dp * 2 + 4.dp + 5.px)" /></template><script>
import { M } from '@arrange/framework/ui'
import { read } from './state'
function local(unit: (value: number) => number) { return unit(9) }
</script>`
    const result = compileArrangeSfa(source, '单位表达式.sfa')
    assert.match(result.code, /read.*2.*4.*5/s)
    assert.match(result.code, /return unit\(9\)/)

    const exact = (expression: string) => compileArrangeSfa(`<template><Text :modifier="M.width(${expression})" /></template><script>import { M } from '@arrange/framework/ui'</script>`, '单位双通道.sfa').code
    assert.match(exact('114.dp + 514.px'), /\[114, 514\]/)
    assert.match(exact('1919.px + 114.dp * 2 + 810.px'), /\[228, 2729\]/)
    const template = compileArrangeSfa('<script>const label = `尺寸 ${8.dp}`\nconst nested = `${{ value: 2.dp }.value}`</script>', '单位插值.sfa')
    assert.match(template.code, /尺寸 \$\{8\}/)
    assert.match(template.code, /\$\{\{ value: 2 \}\.value\}/)
    const objects = compileArrangeSfa(`<template><Text :modifier="M.offset(offset).padding(padding)" /></template><script>import { M } from '@arrange/framework/ui'
const offset = { x: 114.dp, y: 514.px }
const padding = { horizontal: 8.dp, vertical: 2.px }
</script>`, '单位对象.sfa')
    assert.match(objects.code, /xDp: 114, xPx: 0, yDp: 0, yPx: 514/)
    assert.match(objects.code, /horizontalDp: 8, horizontalPx: 0, verticalDp: 0, verticalPx: 2/)
    const reactiveObjects = compileArrangeSfa(`<template><Text :modifier="M.offset(offset.value).padding(unref(padding))" /></template><script>import { M } from '@arrange/framework/ui'
import { ref, unref } from '@arrange/framework'
const offset = ref({ x: 8.dp, y: 2.px })
const padding = ref({ horizontal: 4.dp, vertical: 3.px })
</script>`, '单位响应式对象.sfa')
    assert.match(reactiveObjects.code, /xDp: 8, xPx: 0, yDp: 0, yPx: 2/)
    assert.match(reactiveObjects.code, /horizontalDp: 4, horizontalPx: 0, verticalDp: 0, verticalPx: 3/)
    const scalarRef = compileArrangeSfa(`<template><Text :modifier="M.width(width)" /></template><script>import { M } from '@arrange/framework/ui'
import { ref } from '@arrange/framework'
const width = ref(8.dp)
</script>`, '单位响应式长度.sfa')
    assert.match(scalarRef.code, /\[8, 0\]/)

    let reads = 0
    const exports: { default?: Parameters<typeof createApp>[0] } = {}
    const js = ts.transpileModule(result.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'exports', js)((name: string) => name === './state' ? {
        read: () => {
            reads++
            return 8
        }
    } : requireSfaModule(name), exports)
    assert.equal(reads, 0)
    const native = recordingNative()
    const app = createApp(exports.default!).provide(DensityKey, createDensity(2))
    app.mount(native.target)
    native.frame()
    assert.equal(reads, 1)
    const chain = [...native.nodes.values()].find(node => node.inputs.has('modifier'))!.inputs.get('modifier') as typeof M
    assert.equal(chain.elements[0].value.value, 45)
    app.unmount()
})

test('SFA 已知裸数和错单位在编译入口拒绝，普通 TS 参数仍直接用数字', () => {
    const source = (value: string) => `<template><Text :modifier="M.width(${value})" /></template><script>import { M } from '@arrange/framework/ui'</script>`
    assert.throws(() => compileArrangeSfa(source('8'), '单位错误.sfa'), /要求 LENGTH/)
    assert.throws(() => compileArrangeSfa(source('8.sp'), '单位错误.sfa'), /实际为 SP/)
    assert.equal(M.width(8, 0).elements[0].value.valueDp, 8)
    const script = (body: string) => `<script>import { createScrollState, ref } from '@arrange/framework'\nimport { M, Color, solidColor, createDensity, type Dp } from '@arrange/framework/ui'\n${body}</script>`
    assert.doesNotThrow(() => compileArrangeSfa(script('const scroll = createScrollState({ initial: 4.px }); scroll.scrollTo(scroll.value); const density = createDensity(); M.width(density.pxToDp(scroll.value).dp, 0).background(solidColor(Color(0xff123456)))'), '单位边界.sfa'))
    assert.doesNotThrow(() => compileArrangeSfa(script('const scroll = createScrollState(); M.width(scroll.value)'), '单位边界.sfa'))
    assert.throws(() => compileArrangeSfa(script('createScrollState({ initial: 4 })'), '单位边界.sfa'), /要求 PX/)
    assert.throws(() => compileArrangeSfa(script('function wrong(): Dp { return 4.sp }'), '单位边界.sfa'), /实际为 SP/)
    assert.throws(() => compileArrangeSfa(script('const value = ref(1.dp); value.value = 4.sp'), '单位边界.sfa'), /实际为 SP/)
})

test('跨 SFA、TS 转导出及脚本表达式保留正式单位契约', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-units-'))
    try {
        writeFileSync(join(directory, 'Child.sfa'), '<template><Text :modifier="M.width(width)" /></template><script>import { M, type Dp } from "@arrange/framework/ui"\ndefineProps<{ width: Dp }>()</script>')
        const constructorProps = compileArrangeSfa('<script>import { Dp } from "@arrange/framework/ui"\nconst value = 4.dp\ndefineProps({ width: { type: Dp, required: true } })</script>', join(directory, 'Constructor.sfa'))
        assert.match(constructorProps.code, /type: Number/)
        assert.doesNotMatch(constructorProps.code, /4\.dp/)
        const source = (value: string) => `<template><Child :width="${value}" /></template><script>import Child from './Child.sfa'\nconst width = 8.dp * 2 + 1.dp\n</script>`
        const file = join(directory, 'Parent.sfa')
        writeFileSync(file, source('width'))
        assert.doesNotThrow(() => compileArrangeSfa(source('width'), file))
        assert.deepEqual(checkSfaProject(resolve('tsconfig.json'), [file]), [])
        assert.throws(() => compileArrangeSfa(source('8.sp'), file), /实际为 SP/)
        assert.throws(() => compileArrangeSfa(source('8'), file), /要求 DP/)
        assert.throws(() => compileArrangeSfa(source('8.sp').replace('<Child :width="8.sp" />', '<DynamicArrangable :is="Child" :props="{ width: 8.sp }" />'), file), /实际为 SP/)
        assert.throws(() => compileArrangeSfa('<template><Text :style="{fontSize: 12}" /></template><script></script>', file), /要求 SP/)
        writeFileSync(file, '<template><Text :style="{fontSize: 12}" /></template><script></script>')
        assert.ok(checkSfaProject(resolve('tsconfig.json'), [file]).some(item => /要求 SP/.test(item.message)))
    } finally {
        rmSync(directory, { recursive: true })
    }
})

test('Input 未绑定的编辑值与 Density 最新配置跨停用保留', () => {
    const key = ref(0)
    const density = createDensity(2, 3)
    const native = recordingNative()
    const app = createApp(defineArrangable({ setup: (_props, { call }) => () => call(0, KeepAlive, { cacheKey: () => key.value }, { default: () => call(0, Input, { modifier: () => M.width(20, 0) }) }) })).provide(DensityKey, density)
    app.mount(native.target)
    native.frame()
    const input = () => [...native.nodes.values()].map(node => node.inputs.get('modifier') as typeof M | undefined).find(chain => chain?.elements.some(element => element.type === 'textField'))!
    const field = () => input().elements.find(element => element.type === 'textField')!.value;
    (field().onValueChange as (value: string) => void)('保留的编辑值')
    native.frame()
    key.value = 1
    native.frame()
    density.dpScale = 4
    key.value = 0
    native.frame()
    assert.equal(field().value, '保留的编辑值')
    assert.equal(input().elements[0].value.value, 80)
    app.unmount()
})

test('Density 解析失败保留旧帧，恢复有效倍率后只更新真实消费者', () => {
    const scale = ref(2)
    const errors: unknown[] = []
    let conversions = 0
    const post: number[] = []
    const native = recordingNative()
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            watch(scale, value => post.push(value), { flush: 'post' })
            return () => {
                call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy, modifier: () => M.width(10, 0) })
                call(1, Layout, { measurePolicy: () => MinSizeMeasurePolicy, modifier: () => M.graphicsLayer({ translationX: 5 }) })
            }
        }
    })).provide(DensityKey, {
        ...createDensity(), dpToPx(value: number) {
            conversions++
            if (scale.value < 0) throw new Error('测试转换失败')
            return value * scale.value
        }
    })
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    native.frame()
    const writes = native.writes
    const count = conversions
    scale.value = -1
    native.frame()
    assert.equal(errors.length, 1)
    assert.equal(native.writes, writes)
    assert.deepEqual(post, [])
    scale.value = 3
    native.frame()
    assert.equal(conversions, count + 2)
    assert.equal(native.writes, writes + 1)
    assert.deepEqual(post, [3])
    app.unmount()
})

test('动态调用转交具名内容并按选中目标校验，失败保留旧帧', () => {
    const selected = ref(false)
    const errors: unknown[] = []
    const Page = defineArrangable({ slotNames: ['header'], setup: (_props, { slot }) => slot('header') })
    const Empty = defineArrangable({ setup: () => () => { } })
    const native = recordingNative()
    const app = createApp(defineArrangable({ setup: (_props, { call }) => () => call(0, DynamicArrangable, { is: () => selected.value ? Empty : Page }, { header: () => call(0, Text, { text: () => '标题' }) }) }))
    app.config.errorHandler = error => errors.push(error)
    app.mount(native.target)
    native.frame()
    assert.equal(native.textNodes()[0].text, '标题')
    selected.value = true
    native.frame()
    assert.equal(errors.length, 1)
    assert.equal(native.textNodes()[0].text, '标题')
    app.unmount()
})

test('KeepAlive 的有限缓存逐出整份内容，停用观察恢复时只消费最新状态', () => {
    const key = ref(0)
    const value = ref(0)
    const watched: number[] = []
    let disposed = 0
    const Child = defineArrangable({
        setup(_props, { call }) {
            watch(value, next => watched.push(next), { flush: 'sync' })
            onScopeDispose(() => { disposed++ })
            return () => call(0, Text, { text: () => String(value.value) })
        }
    })
    const native = recordingNative()
    const app = createApp(defineArrangable({ setup: (_props, { call }) => () => call(0, KeepAlive, { cacheKey: () => key.value, max: () => 2 }, { default: () => call(0, Child, {}) }) }))
    app.mount(native.target)
    native.frame()
    key.value = 1
    native.frame()
    value.value = 1
    value.value = 2
    assert.deepEqual(watched, [1, 2])
    native.frame()
    key.value = 0
    native.frame()
    assert.deepEqual(watched, [1, 2, 2])
    key.value = 2
    native.frame()
    assert.equal(disposed, 1)
    app.unmount()
    assert.equal(disposed, 3)
})

test('停用动画不采样，恢复首帧保留当前值并继续原进度', () => {
    const owner = frameScope()
    const target = ref(0)
    const value = owner.run(() => animatedNumberAsRef(target, { animationSpec: tween({ durationMillis: 100, easing: linearEasing }) }))
    target.value = 100
    owner.advanceBy(40)
    assert.equal(value.value, 40)
    owner.scope.pause()
    owner.advanceBy(1000)
    assert.equal(value.value, 40)
    owner.scope.resume()
    owner.advanceBy(1000)
    assert.equal(value.value, 40)
    owner.advanceBy(60)
    assert.equal(value.value, 100)
    owner.stop()
})

test('UI post 观察首跑等待成功提交，已排队观察在作用域暂停时不执行', async () => {
    const owner = frameScope()
    const value = ref(0)
    const observed: number[] = []
    owner.run(() => {
        watchPostEffect(() => observed.push(value.value))
        watch(value, next => observed.push(next * 10))
    })
    await nextTick()
    assert.deepEqual(observed, [])
    owner.advanceBy(16)
    assert.deepEqual(observed, [0])
    value.value = 1
    owner.scope.pause()
    owner.advanceBy(16)
    assert.deepEqual(observed, [0])
    value.value = 2
    owner.scope.resume()
    owner.advanceBy(16)
    assert.deepEqual(observed, [0, 20, 2])
    owner.stop()
})

test('动态定义的 props 与具名内容在真实 SFA 类型检查中按所选目标诊断', () => {
    const directory = mkdtempSync(resolve('tmp-refs/sfa-dynamic-'))
    try {
        writeFileSync(join(directory, 'Page.sfa'), '<template><Text :text="title" /><Slot name="header" /></template><script>defineProps<{ title: string }>()</script>')
        const file = join(directory, 'App.sfa')
        const source = (props: string, name: string) => `<template><DynamicArrangable :is="Page" :props="${props}"><Template #${name}><Text text="标题" /></Template></DynamicArrangable></template><script>import Page from './Page.sfa'</script>`
        writeFileSync(file, source("{ title: '正文' }", 'header'))
        assert.deepEqual(checkSfaProject(resolve('tsconfig.json'), [file]), [])
        writeFileSync(file, source('{ title: 123 }', 'footer'))
        const diagnostics = checkSfaProject(resolve('tsconfig.json'), [file])
        assert.ok(diagnostics.some(item => /string/.test(item.message)), JSON.stringify(diagnostics))
        assert.ok(diagnostics.some(item => /never/.test(item.message)), JSON.stringify(diagnostics))
    } finally {
        rmSync(directory, { recursive: true })
    }
})
