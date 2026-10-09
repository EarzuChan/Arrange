import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from '@arrange/reactivity'
import { createApp } from '@arrange/framework'
import { defineArrangable, getArrangeExecutionStats } from '@arrange/framework/internal'
import { Layout } from '@arrange/framework/foundation'
import { M, MinSizeMeasurePolicy, createDensity } from '@arrange/framework/ui'
import { DrawInstance, type DrawScope } from '../../packages/framework/src/draw.ts'
import { UnitResolver } from '../../packages/framework/src/resolveUnits.ts'
import { recordingNative } from './recordingNative.ts'
import { evaluateSfa } from './sfaModules.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'

test('绘制缓存分别追踪构建与绘制依赖，尺寸与实际读取的 Density 更新缓存', () => {
    const scope = effectScope(), color = ref(0xff112233), geometry = ref(7), density = createDensity(2)
    let builds = 0, draws = 0
    const instance = scope.run(() => new DrawInstance('drawWithCache', {
        draw(cache: Readonly<{ size: { width: number; height: number } }>) {
            builds++
            const width = density.dpToPx(geometry.value)
            assert.ok(Object.isFrozen(cache.size))
            return {
                onDrawBehind(draw: DrawScope) {
                    draws++
                    draw.drawRect({ color: color.value, width })
                }
            }
        }
    }))!
    assert.equal(builds, 0)
    assert.equal(instance.prepare(100, 40)[0].width, 14)
    color.value = 0xff445566
    assert.equal(instance.revision.value, 1)
    assert.equal(instance.prepare(100, 40)[0].color, color.value)
    assert.equal(builds, 1)
    geometry.value = 8
    assert.equal(instance.prepare(100, 40)[0].width, 16)
    density.dpScale = 3
    assert.equal(instance.prepare(100, 40)[0].width, 24)
    instance.prepare(110, 40)
    assert.equal(builds, 4)
    assert.equal(draws, 5)
    const revision = instance.revision.value
    scope.stop()
    color.value = 0xffabcdef
    geometry.value = 9
    density.dpScale = 4
    assert.equal(instance.revision.value, revision)
    assert.throws(() => instance.prepare(110, 40), /退休/)
})

test('同一声明交给不同受体时缓存独立，keyed 移动保留，移除退订', () => {
    const scope = effectScope(), dependency = ref(1)
    let builds = 0
    const declaration = M.drawWithCache(({ size }) => {
        builds++
        const width = size.width * dependency.value
        return { onDrawBehind(draw) { draw.drawRect({ color: 0xff123456, width }) } }
    }).keyed('绘制')
    scope.run(() => {
        const first = new UnitResolver(createDensity()), second = new UnitResolver(createDensity())
        const a = first.modifier(declaration).elements[0].value.prepare as (width: number, height: number) => readonly Record<string, unknown>[]
        const b = second.modifier(declaration).elements[0].value.prepare as typeof a
        assert.notEqual(a, b)
        assert.equal(a(100, 40)[0].width, 100)
        assert.equal(b(200, 40)[0].width, 200)
        assert.equal(builds, 2)
        const moved = first.modifier(M.background(0xff000000).then(declaration))
        assert.equal(moved.elements[1].value.prepare, a)
        first.modifier(M)
        assert.throws(() => a(100, 40), /退休/)
        dependency.value = 2
        assert.equal(b(200, 40)[0].width, 400)
    })
    scope.stop()
})

test('无 key 绘制实例按完整 Modifier 链的原生顺序协调', () => {
    const scope = effectScope()
    scope.run(() => {
        const units = new UnitResolver(createDensity())
        const drawing = M.drawBehind(scope => scope.drawRect({ color: 0xff112233 }))
        const before = units.modifier(drawing.background(0xff000000).then(drawing))
        const first = before.elements[0].value.prepare as (width: number, height: number) => readonly Record<string, unknown>[]
        const second = before.elements[2].value.prepare as typeof first
        const after = units.modifier(M.background(0xff000000).then(drawing).then(drawing))
        assert.equal(after.elements[1].value.prepare, second)
        assert.notEqual(after.elements[2].value.prepare, first)
        assert.throws(() => first(20, 20), /退休/)
    })
    scope.stop()
})

test('drawContent 可省略或重复，作用域状态完整退出，回调外不能继续绘制', () => {
    const owner = effectScope()
    let escaped: DrawScope | undefined
    const instance = owner.run(() => new DrawInstance('drawWithContent', {
        draw(scope, content) {
            escaped = scope
            scope.drawRect({ color: 0xff000001 })
            scope.clipRoundRect({ radius: 5 }, () => {
                content()
                scope.withTransform({ translationX: 20 }, () => content())
            })
            scope.drawCircle({ color: 0xff000002, radius: 10 })
        }
    }))!
    assert.deepEqual(instance.prepare(100, 80).map(command => command.kind), ['rect', 'clip', 'content', 'transform', 'content', 'popTransform', 'popClip', 'oval'])
    assert.throws(() => escaped!.drawRect({ color: 0xff112233 }), /退出/)
    const hidden = owner.run(() => new DrawInstance('drawWithContent', { draw() { } }))!
    assert.deepEqual(hidden.prepare(100, 80), [])
    assert.throws(() => M.drawBehind(undefined as never), /函数/)
    const invalid = owner.run(() => new DrawInstance('drawBehind', { draw(scope: DrawScope) { scope.drawLine({ color: 0xff000000, startX: 0, startY: 0, endX: 1, endY: 1, strokeWidth: 0 }) } }))!
    assert.throws(() => invalid.prepare(10, 10), /线宽/)
    owner.stop()
})

test('绘制反应式依赖通过既有 Modifier 值提交，独立于结构重排', () => {
    const color = ref(0xff112233)
    let renders = 0
    const native = recordingNative()
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            const modifier = M.size(100, 0, 40, 0).drawBehind(scope => scope.drawRect({ color: color.value }))
            return () => {
                renders++
                call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy, modifier: () => modifier })
            }
        }
    }))
    app.mount(native.target)
    native.frame()
    const node = [...native.nodes.values()].find(node => node.inputs.has('modifier'))!
    const commands = () => {
        const modifier = native.nodes.get(node.id)!.inputs.get('modifier') as MType
        return (modifier.elements[1].value.prepare as (width: number, height: number) => readonly Record<string, unknown>[])(100, 40)
    }
    type MType = ReturnType<typeof M.drawBehind>
    assert.equal(commands()[0].color, color.value)
    const before = native.writes
    color.value = 0xff556677
    assert.equal(native.writes, before)
    native.frame()
    assert.equal(renders, 1)
    assert.equal(commands()[0].color, color.value)
    assert.equal((native.nodes.get(node.id)!.inputs.get('modifier') as MType).elements[1].value.revision, 1)
    app.unmount()
    assert.throws(commands, /undefined|inputs/)
})

test('KeepAlive 式作用域停用冻结准备和依赖工作，恢复读取最新值', () => {
    const scope = effectScope(), color = ref(0xff112233)
    const instance = scope.run(() => new DrawInstance('drawBehind', { draw(scope: DrawScope) { scope.drawRect({ color: color.value }) } }))!
    instance.prepare(20, 20)
    scope.pause()
    color.value = 0xff445566
    assert.equal(instance.revision.value, 0)
    assert.throws(() => instance.prepare(20, 20), /停用/)
    scope.resume()
    assert.equal(instance.revision.value, 1)
    assert.equal(instance.prepare(20, 20)[0].color, color.value)
    scope.stop()
})

test('失败绘制候选恢复之前的缓存与依赖，候选订阅不会泄漏', () => {
    const scope = effectScope(), first = ref(1), second = ref(2)
    let chooseSecond = false
    const instance = scope.run(() => new DrawInstance('drawWithCache', {
        draw(_cache: Readonly<{ size: { width: number; height: number } }>) {
            const width = chooseSecond ? second.value : first.value
            return { onDrawBehind(draw: DrawScope) { draw.drawRect({ color: 0xff112233, width }) } }
        }
    }))!
    assert.equal(instance.prepare(30, 20, 'prepare')[0].width, 1)
    instance.prepare(30, 20, 'commit')
    chooseSecond = true
    assert.equal(instance.prepare(40, 20, 'prepare')[0].width, 2)
    instance.prepare(40, 20, 'rollback')
    const revision = instance.revision.value
    second.value = 4
    assert.equal(instance.revision.value, revision)
    assert.equal(instance.prepare(30, 20)[0].width, 1)
    first.value = 3
    assert.equal(instance.revision.value, revision + 1)
    assert.equal(instance.prepare(30, 20)[0].width, 4)
    assert.equal(scope.effects.length, 2)
    scope.stop()
})

test('候选回滚保留准备期间发生的原缓存数据失效', () => {
    const scope = effectScope(), first = ref(1), second = ref(2)
    let chooseSecond = false
    const instance = scope.run(() => new DrawInstance('drawWithCache', {
        draw() {
            const width = chooseSecond ? second.value : first.value
            return { onDrawBehind(draw: DrawScope) { draw.drawRect({ color: 0xff112233, width }) } }
        }
    }))!
    assert.equal(instance.prepare(30, 20, 'prepare')[0].width, 1)
    instance.prepare(30, 20, 'commit')
    chooseSecond = true
    assert.equal(instance.prepare(40, 20, 'prepare')[0].width, 2)
    first.value = 3
    instance.prepare(40, 20, 'rollback')
    chooseSecond = false
    assert.equal(instance.prepare(30, 20)[0].width, 3)
    const revision = instance.revision.value
    second.value = 4
    assert.equal(instance.revision.value, revision)
    assert.equal(scope.effects.length, 2)
    scope.stop()
})

test('异步绘制 callback 在候选准备阶段被拒绝', () => {
    const scope = effectScope()
    const instance = scope.run(() => new DrawInstance('drawBehind', { draw: async (draw: DrawScope) => { draw.drawRect({ color: 0xff112233 }) } }))!
    assert.throws(() => instance.prepare(20, 20), /同步完成/)
    const cached = scope.run(() => new DrawInstance('drawWithCache', { draw: async () => ({}) } as never))!
    assert.throws(() => cached.prepare(20, 20), /同步返回/)
    scope.stop()
})

test('真实 SFA 绘制方法保留 PX 与颜色契约，依赖变化不执行结构', () => {
    const source = `<template><Layout :measurePolicy="MinSizeMeasurePolicy" :modifier="drawing" /></template><script>
import { Layout } from '@arrange/framework/foundation'
import { M, MinSizeMeasurePolicy, Color } from '@arrange/framework/ui'
import { color } from './state'
const drawing = M.size(100.dp, 40.dp).drawWithContent((scope, drawContent) => {
    scope.drawRect({ color: Color(color.value), x: 2.px, width: scope.size.width / 2 })
    scope.drawRoundRect({ color: Color(0xff223344), radius: 3.px, height: 10.px })
    scope.drawCircle({ color: Color(0xff334455), centerX: 8.px, radius: 4.px })
    scope.drawLine({ color: Color(0xff445566), startX: 1.px, startY: 2.px, endX: 8.px, endY: 2.px, strokeWidth: 0.5.px })
    scope.clipRoundRect({ radius: 5.px }, () => scope.withTransform({ translationX: 3.px }, drawContent))
})
</script>`
    const color = ref(0xff112233), native = recordingNative()
    const app = createApp(evaluateSfa(source, { './state': { color } }, '绘制单位.sfa'))
    app.mount(native.target)
    native.frame()
    const node = [...native.nodes.values()].find(node => node.inputs.has('modifier'))!
    const prepare = () => {
        const modifier = native.nodes.get(node.id)!.inputs.get('modifier') as ReturnType<typeof M.drawBehind>
        return (modifier.elements[1].value.prepare as (width: number, height: number) => readonly Record<string, unknown>[])(100, 40)
    }
    const commands = prepare()
    assert.equal(commands[0].color, color.value)
    assert.equal(commands[0].x, 2)
    assert.equal(commands[0].width, 50)
    assert.equal(commands[3].strokeWidth, 0.5)
    assert.equal(commands[5].translationX, 3)
    const structures = getArrangeExecutionStats().structureRuns
    color.value = 0xffabcdef
    native.frame()
    assert.equal(prepare()[0].color, color.value)
    assert.equal(getArrangeExecutionStats().structureRuns, structures)
    app.unmount()
    assert.throws(() => compileArrangeSfa(source.replace('x: 2.px', 'x: 2.dp'), '绘制单位错误.sfa'), /要求 PX.*实际为 DP/)
    assert.throws(() => compileArrangeSfa(source.replace('Color(0xff223344)', '0xff223344'), '绘制颜色错误.sfa'), /要求 COLOR/)
})
