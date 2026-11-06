import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from '@arrange/reactivity'
import { createApp } from '@arrange/framework'
import { defineArrangable, getArrangeExecutionStats } from '@arrange/framework/internal'
import { Layout } from '@arrange/framework/foundation'
import { M, MinSizeMeasurePolicy, createDensity, linearGradient, verticalGradient, radialGradient, sweepGradient, roundedCorners, rounded, solidColor, painter, filmstrip, createPixelBuffer } from '@arrange/framework/ui'
import { createFakeNative } from '../helpers/fakeNative.ts'
import { painterSnapshot } from '../../packages/framework/src/painter.ts'
import { DrawInstance, Path, type DrawScope, type PreparedDraw } from '../../packages/framework/src/draw.ts'
import { decodeDraw, encodeDraw } from '../helpers/drawCommands.ts'
import { ModifierLowering } from '../../packages/framework/src/modifierLowering.ts'
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
    assert.equal(decodeDraw(instance.prepare(100, 40))[0].width, 14)
    color.value = 0xff445566
    assert.equal(instance.revision.value, 1)
    assert.equal(decodeDraw(instance.prepare(100, 40))[0].color, color.value)
    assert.equal(builds, 1)
    geometry.value = 8
    assert.equal(decodeDraw(instance.prepare(100, 40))[0].width, 16)
    density.dpScale = 3
    assert.equal(decodeDraw(instance.prepare(100, 40))[0].width, 24)
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
        const first = new ModifierLowering(createDensity()), second = new ModifierLowering(createDensity())
        const a = first.modifier(declaration).elements[0].value.prepare as (width: number, height: number) => PreparedDraw
        const b = second.modifier(declaration).elements[0].value.prepare as typeof a
        assert.notEqual(a, b)
        assert.equal(decodeDraw(a(100, 40))[0].width, 100)
        assert.equal(decodeDraw(b(200, 40))[0].width, 200)
        assert.equal(builds, 2)
        const moved = first.modifier(M.background(0xff000000).then(declaration))
        assert.equal(moved.elements[1].value.prepare, a)
        first.modifier(M)
        assert.throws(() => a(100, 40), /退休/)
        dependency.value = 2
        assert.equal(decodeDraw(b(200, 40))[0].width, 400)
    })
    scope.stop()
})

test('无 key 绘制实例按完整 Modifier 链的原生顺序协调', () => {
    const scope = effectScope()
    scope.run(() => {
        const units = new ModifierLowering(createDensity())
        const drawing = M.drawBehind(scope => scope.drawRect({ color: 0xff112233 }))
        const before = units.modifier(drawing.background(0xff000000).then(drawing))
        const first = before.elements[0].value.prepare as (width: number, height: number) => PreparedDraw
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
    assert.deepEqual(decodeDraw(instance.prepare(100, 80)).map(command => command.kind), ['rect', 'clip', 'content', 'transform', 'content', 'popTransform', 'popClip', 'oval'])
    assert.throws(() => escaped!.drawRect({ color: 0xff112233 }), /退出/)
    const hidden = owner.run(() => new DrawInstance('drawWithContent', { draw() { } }))!
    assert.deepEqual(decodeDraw(hidden.prepare(100, 80)), [])
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
        return decodeDraw((modifier.elements[1].value.prepare as (width: number, height: number) => PreparedDraw)(100, 40))
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
    assert.equal(decodeDraw(instance.prepare(20, 20))[0].color, color.value)
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
    assert.equal(decodeDraw(instance.prepare(30, 20, 'prepare'))[0].width, 1)
    instance.prepare(30, 20, 'commit')
    chooseSecond = true
    assert.equal(decodeDraw(instance.prepare(40, 20, 'prepare'))[0].width, 2)
    instance.prepare(40, 20, 'rollback')
    const revision = instance.revision.value
    second.value = 4
    assert.equal(instance.revision.value, revision)
    assert.equal(decodeDraw(instance.prepare(30, 20))[0].width, 1)
    first.value = 3
    assert.equal(instance.revision.value, revision + 1)
    assert.equal(decodeDraw(instance.prepare(30, 20))[0].width, 4)
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
    assert.equal(decodeDraw(instance.prepare(30, 20, 'prepare'))[0].width, 1)
    instance.prepare(30, 20, 'commit')
    chooseSecond = true
    assert.equal(decodeDraw(instance.prepare(40, 20, 'prepare'))[0].width, 2)
    first.value = 3
    instance.prepare(40, 20, 'rollback')
    chooseSecond = false
    assert.equal(decodeDraw(instance.prepare(30, 20))[0].width, 3)
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
        return decodeDraw((modifier.elements[1].value.prepare as (width: number, height: number) => PreparedDraw)(100, 40))
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

test('绘制命令编码为冻结的定长数值流，颜色精确保留', () => {
    const scope = effectScope()
    const instance = scope.run(() => new DrawInstance('drawBehind', {
        draw(draw: DrawScope) {
            draw.drawRect({ color: 0xfffefdfc, x: 1.5 })
            draw.clipOval({ width: 10 }, () => draw.drawLine({ color: 0x01020304, startX: 0, startY: 0, endX: 3, endY: 4 }))
        }
    }))!
    const prepared = instance.prepare(40, 20)
    assert.ok(Object.isFrozen(prepared) && prepared.ops instanceof Float64Array)
    assert.deepEqual(prepared.refs, [])
    const commands = decodeDraw(prepared)
    assert.deepEqual(commands.map(command => command.kind), ['rect', 'clip', 'line', 'popClip', 'content'])
    assert.equal(commands[0].color, 0xfffefdfc)
    assert.equal(commands[0].x, 1.5)
    assert.equal(commands[1].shape, 'circle')
    assert.equal(commands[2].color, 0x01020304)
    assert.deepEqual([...encodeDraw(commands).ops], [...prepared.ops])
    scope.stop()
})

test('路径、文字与渐变画笔写入数值流，非数值参数进引用表', () => {
    const scope = effectScope()
    const gradient = linearGradient([0xff000000, 0xffffffff])
    const triangle = new Path().moveTo(0, 0).lineTo(10, 0).arcTo({ x: 0, y: 0, width: 10, height: 10 }, 0, 90).close()
    triangle.fillType = 'evenOdd'
    const instance = scope.run(() => new DrawInstance('drawBehind', {
        draw(draw: DrawScope) {
            draw.drawPath(triangle, { brush: gradient, strokeWidth: 2, cap: 'round', join: 'bevel' })
            draw.clipPath(triangle, () => draw.drawText({ text: '刻度', x: 3, color: 0xff112233, fontSize: 12, textAlign: 'center', overflow: 'ellipsis', maxLines: 1 }))
            draw.drawRect({ brush: solidColor(0xff445566) })
        }
    }))!
    const prepared = instance.prepare(40, 20)
    const commands = decodeDraw(prepared)
    assert.deepEqual(commands.map(command => command.kind), ['path', 'clipPath', 'text', 'popClip', 'rect', 'content'])
    assert.equal(commands[0].brush, gradient)
    assert.equal(commands[0].color, undefined)
    assert.deepEqual([commands[0].strokeWidth, commands[0].cap, commands[0].join, commands[0].fillType], [2, 1, 2, 'evenOdd'])
    assert.deepEqual(commands[0].verbs, [['moveTo', 0, 0], ['lineTo', 10, 0], ['arcTo', 0, 0, 10, 10, 0, 90, 0], ['close']])
    assert.deepEqual(commands[1].verbs, commands[0].verbs)
    assert.deepEqual([commands[2].text, commands[2].x, commands[2].width, commands[2].fontSize, commands[2].textAlign, commands[2].overflow, commands[2].maxLines], ['刻度', 3, 0, 12, 1, 1, 1])
    // 未指定字体时不占引用表，字重 400、正体、允许伪造
    assert.deepEqual([commands[2].fontFamily, commands[2].fontWeight, commands[2].italic, commands[2].fontSynthesis], [undefined, 400, 0, 1])
    // 纯色 Brush 直接写为颜色，不占引用表
    assert.equal(commands[4].color, 0xff445566)
    assert.deepEqual(prepared.refs, [gradient, '刻度'])
    scope.stop()
})

test('绘制画笔与参数在录制时校验', () => {
    const scope = effectScope()
    const record = (draw: (scope: DrawScope) => void) => scope.run(() => new DrawInstance('drawBehind', { draw }))!.prepare(10, 10)
    assert.throws(() => record(draw => draw.drawRect({})), /二选一/)
    assert.throws(() => record(draw => draw.drawRect({ color: 0xff000000, brush: solidColor(0xff000000) })), /二选一/)
    assert.throws(() => record(draw => draw.drawPath(new Path().lineTo(1, 1), { color: 0xff000000, cap: 'flat' as 'butt' })), /线帽/)
    assert.throws(() => record(draw => draw.drawText({ text: 'a', color: 0xff000000, maxLines: 1.5 })), /maxLines/)
    assert.throws(() => record(draw => draw.drawPainter({} as never)), /Painter/)
    assert.throws(() => new Path().lineTo(Number.NaN, 0), /有限/)
    scope.stop()
})

test('渐变 Brush 的色标均匀分布或显式给出，几何为比例坐标', () => {
    const even = linearGradient([0xff000000, 0xff808080, 0xffffffff])
    assert.deepEqual([even.type, (even as { stops: readonly number[] }).stops], ['linearGradient', [0, 0.5, 1]])
    assert.ok(Object.isFrozen(even) && Object.isFrozen((even as { colors: readonly number[] }).colors))
    assert.deepEqual(verticalGradient([[0.2, 0xff000000], [0.8, 0xffffffff]]), { type: 'linearGradient', colors: [0xff000000, 0xffffffff], stops: [0.2, 0.8], start: { x: 0, y: 0 }, end: { x: 0, y: 1 } })
    assert.deepEqual(radialGradient([0xff000000, 0xffffffff], { radius: 0.5 }), { type: 'radialGradient', colors: [0xff000000, 0xffffffff], stops: [0, 1], center: { x: 0.5, y: 0.5 }, radius: 0.5 })
    assert.equal((sweepGradient([0xff000000, 0xffffffff], { startAngle: -90 }) as { startAngle: number }).startAngle, -90)
    assert.throws(() => linearGradient([0xff000000]), /2 到 64/)
    assert.throws(() => linearGradient([[0.6, 0xff000000], [0.4, 0xffffffff]]), /不递减/)
    assert.throws(() => linearGradient([0xff000000, [1, 0xffffffff]]), /全为颜色/)
    assert.throws(() => radialGradient([0xff000000, 0xffffffff], { radius: -1 }), /非负/)
})

test('分角圆角经 Modifier 降解为四个 PX 半径，统一圆角四角相同', () => {
    const units = new ModifierLowering(createDensity(2))
    const gradient = verticalGradient([0xff000000, 0xffffffff])
    const lowered = units.modifier(M.background(gradient, roundedCorners({ topStartDp: 4, topEndPx: 3, bottomEndDp: 1, bottomEndPx: 1 })).clip(rounded(2, 1)))
    assert.deepEqual(lowered.elements[0].value, { brush: gradient, shape: { type: 'rounded', topStart: 8, topEnd: 3, bottomEnd: 3, bottomStart: 0 } })
    assert.deepEqual(lowered.elements[1].value, { shape: { type: 'rounded', topStart: 5, topEnd: 5, bottomEnd: 5, bottomStart: 5 } })
    assert.throws(() => roundedCorners({ topStartDp: -1 }), /非负/)
})

test('阴影与模糊经 Modifier 降解为 PX 长度，偏移冻结，SFA 混合单位合并', () => {
    const units = new ModifierLowering(createDensity(2))
    const lowered = units.modifier(M.dropShadow({ radiusDp: 4, spreadPx: 1, offset: { yDp: 2, xPx: 3 }, color: 0x80000000, shape: rounded(2, 0) }).innerShadow({ radiusPx: 6, color: 0xff000000 }).blur(1, 1).backdropBlur(3, 0, roundedCorners({ topStartDp: 1 })))
    assert.deepEqual(lowered.elements[0].value, { shape: { type: 'rounded', topStart: 4, topEnd: 4, bottomEnd: 4, bottomStart: 4 }, radius: 8, spread: 1, offset: { x: 3, y: 4 }, color: 0x80000000 })
    assert.deepEqual(lowered.elements[1].value, { shape: undefined, radius: 6, spread: 0, offset: { x: 0, y: 0 }, color: 0xff000000 })
    assert.deepEqual(lowered.elements[2].value, { radius: 3 })
    assert.deepEqual(lowered.elements[3].value, { radius: 6, shape: { type: 'rounded', topStart: 2, topEnd: 0, bottomEnd: 0, bottomStart: 0 } })
    assert.deepEqual(lowered.elements.map(element => element.type), ['dropShadow', 'innerShadow', 'blur', 'backdropBlur'])
    const visual = (body: string) => `<script>import { M, Color, rounded } from '@arrange/framework/ui'\n${body}</script>`
    const sfa = compileArrangeSfa(visual('M.dropShadow({ radius: 4.dp + 1.px, offset: { y: 2.dp }, color: Color(0x80000000), shape: rounded(2.dp) }).blur(3.dp).backdropBlur(2.px)'), '阴影单位.sfa')
    assert.match(sfa.code, /radiusDp: 4, radiusPx: 1/)
    assert.match(sfa.code, /yDp: 2, yPx: 0/)
    assert.match(sfa.code, /blur\(3, 0\)/)
    assert.match(sfa.code, /backdropBlur\(0, 2\)/)
    assert.throws(() => compileArrangeSfa(visual('M.blur(3)'), '阴影单位.sfa'), /要求 LENGTH/)
})

test('filmstrip 视图按帧号或比例选帧，像素缓冲提交递增版本并可作 painter 绘制', () => {
    const committed: number[][] = []
    let complete: ((result: { contentVersion: number; width?: number; height?: number }) => void) | undefined
    globalThis.__ARRANGE_NATIVE__ = createFakeNative({
        acquirePainter: (_resource, done) => {
            complete = done
            return { identity: 7n, generation: 1n }
        },
        commitPixelBuffer: (_handle, pixels) => {
            committed.push([...pixels])
            return committed.length + 1
        },
    })
    const scope = effectScope()
    try {
        scope.run(() => {
            const knob = painter('knob.png')
            complete!({ contentVersion: 1, width: 64, height: 640 })
            const strip = filmstrip(knob, { frames: 10 })
            assert.deepEqual(strip.frame(3).intrinsicSize, { width: 64, height: 64 })
            assert.equal(strip.at(0.5), strip.frame(5))
            assert.equal(strip.at(2), strip.frame(9))
            assert.deepEqual(painterSnapshot(strip.frame(3)), { identity: 7n, generation: 1n, contentVersion: 1, frames: 10, frame: 3, horizontal: false, intrinsicSize: { width: 64, height: 64 } })
            assert.throws(() => strip.frame(10), /帧下标/)
            assert.throws(() => filmstrip(knob, { frames: 0 }), /帧数/)

            const buffer = createPixelBuffer(2, 1)
            buffer.data.set([0xffff0000, 0xff0000ff])
            buffer.commit()
            assert.deepEqual(committed, [[0xffff0000, 0xff0000ff]])
            assert.equal(buffer.contentVersion, 2)
            assert.deepEqual(buffer.intrinsicSize, { width: 2, height: 1 })
            assert.throws(() => createPixelBuffer(0, 1), /边长/)
            const prepared = new DrawInstance('drawBehind', {
                draw(draw: DrawScope) {
                    draw.drawPainter(buffer, { width: 20, height: 10, contentScale: 'FillBounds' })
                    draw.drawPainter(strip.frame(1), { width: 8, height: 8, ninePatch: { left: 1, top: 1, right: 1, bottom: 1 } })
                    draw.drawPainter(knob, { width: 8, height: 8, tile: true })
                }
            }).prepare(20, 10)
            // drawBehind 在末尾补内容标记
            const commands = decodeDraw(prepared).filter(command => command.kind === 'painter')
            assert.deepEqual(commands.map(command => command.repeat), [0, 2, 1])
            assert.deepEqual([commands[1].sliceLeft, commands[1].sliceBottom], [1, 1])
            assert.equal((prepared.refs[0] as { contentVersion: number }).contentVersion, 2)
            assert.throws(() => new DrawInstance('drawBehind', { draw(draw: DrawScope) { draw.drawPainter(knob, { tile: true, ninePatch: { left: 1, top: 1, right: 1, bottom: 1 } }) } }).prepare(1, 1), /不能同用/)
            buffer.dispose()
            assert.equal(buffer.status, 'disposed')
            assert.throws(() => buffer.commit(), /已释放/)
        })
    } finally {
        scope.stop()
        globalThis.__ARRANGE_NATIVE__ = undefined
    }
})
