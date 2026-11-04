import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref } from '@arrange/reactivity'
import { createApp } from '@arrange/framework'
import { defineArrangable } from '@arrange/framework/internal'
import { Canvas } from '@arrange/framework/foundation'
import { M, createCanvasController, type DrawScope } from '@arrange/framework/ui'
import { DrawInstance, type PreparedDraw } from '../../packages/framework/src/draw.ts'
import { DataSourceState, sourceView } from '../../packages/framework/src/dataSource.ts'
import { bindFrameScheduler } from '../../packages/framework/src/runtime/animationOwner.ts'
import { FrameScheduler } from '../../packages/framework/src/runtime/scheduler.ts'
import { decodeDraw } from '../helpers/drawCommands.ts'
import { recordingNative } from './recordingNative.ts'

test('Canvas auto 失效登记响应式依赖与读过的数据源，manual 只由 controller 触发', () => {
    const scope = effectScope(), level = ref(0.5)
    const meter = new DataSourceState('meter', 'out', new Float32Array(1)), view = sourceView(meter)
    const auto = scope.run(() => new DrawInstance('drawBehind', { draw(draw: DrawScope) { draw.drawRect({ color: 0xff000000, width: level.value * 100 + view.read()[0] }) } }))!
    assert.equal(decodeDraw(auto.prepare(100, 10))[0].width, 50)
    level.value = 0.25
    assert.equal(auto.revision.value, 1)
    meter.array[0] = 4
    meter.publish()
    assert.equal(auto.revision.value, 2)
    assert.equal(decodeDraw(auto.prepare(100, 10))[0].width, 29)

    const controller = createCanvasController()
    const manual = scope.run(() => new DrawInstance('drawBehind', { draw(draw: DrawScope) { draw.drawRect({ color: 0xff000000, width: level.value * 100 + view.read()[0] }) }, invalidation: 'manual', controller }))!
    manual.prepare(100, 10)
    level.value = 0.75
    meter.publish()
    assert.equal(manual.revision.value, 0)
    controller.invalidate()
    assert.equal(manual.revision.value, 1)
    assert.equal(decodeDraw(manual.prepare(100, 10))[0].width, 79)
    manual.stop()
    controller.invalidate()
    assert.equal(manual.revision.value, 1)
    // 停止后不再订阅数据源
    auto.stop()
    const before = auto.revision.value
    meter.publish()
    assert.equal(auto.revision.value, before)
    scope.stop()
})

test('Canvas frame 失效逐帧重录，停用与停止后退出逐帧', () => {
    let requested = false
    const scheduler = new FrameScheduler(pending => { requested = pending })
    const scope = effectScope()
    bindFrameScheduler(scope, scheduler)
    let draws = 0
    const instance = scope.run(() => new DrawInstance('drawBehind', {
        draw(draw: DrawScope) {
            draws++
            draw.drawRect({ color: 0xff000000 })
        }, invalidation: 'frame'
    }))!
    assert.ok(requested)
    instance.prepare(10, 10)
    const frame = (time: number) => {
        scheduler.prepare(time)
        scheduler.complete()
    }
    frame(16)
    frame(32)
    assert.equal(instance.revision.value, 2)
    scope.pause()
    frame(48)
    assert.equal(instance.revision.value, 2)
    scope.resume()
    instance.stop()
    frame(64)
    assert.equal(instance.revision.value, 2)
    assert.equal(draws, 1)
    scope.stop()
})

test('Canvas 以 drawBehind 降解进节点修饰器，onDraw 读取的状态只重录绘制', () => {
    const color = ref(0xff112233)
    let renders = 0
    const native = recordingNative()
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            return () => {
                renders++
                call(0, Canvas, { modifier: () => M.size(40, 0, 20, 0).pointerInput(() => { }), onDraw: () => (draw: DrawScope) => draw.drawRect({ color: color.value }) })
            }
        }
    }))
    app.mount(native.target)
    native.frame()
    const node = [...native.nodes.values()].find(node => (node.inputs.get('modifier') as { elements?: readonly { type: string }[] } | undefined)?.elements?.some(element => element.type === 'drawBehind'))!
    type Lowered = { elements: readonly { type: string; value: { prepare: (width: number, height: number) => PreparedDraw; revision: number } }[] }
    const element = () => (native.nodes.get(node.id)!.inputs.get('modifier') as Lowered).elements.find(item => item.type === 'drawBehind')!
    assert.equal(decodeDraw(element().value.prepare(40, 20))[0].color, color.value)
    assert.ok((native.nodes.get(node.id)!.inputs.get('modifier') as Lowered).elements.some(item => item.type === 'pointerInput'), '可与 pointerInput 组合')
    color.value = 0xff445566
    native.frame()
    assert.equal(renders, 1)
    assert.equal(element().value.revision, 1)
    assert.equal(decodeDraw(element().value.prepare(40, 20))[0].color, color.value)
    app.unmount()
})

test('drawNative 写入名称与冻结参数引用，非法参数在录制时拒绝', () => {
    const scope = effectScope()
    const record = (draw: (scope: DrawScope) => void) => scope.run(() => new DrawInstance('drawBehind', { draw }))!.prepare(10, 10)
    const prepared = record(draw => draw.drawNative('meter', { width: 8, height: 4, params: { level: 0.5, color: 0xff00ff00, peak: true, source: 'out' } }))
    const [command] = decodeDraw(prepared)
    assert.deepEqual({ ...command }, { kind: 'native', name: 'meter', x: 0, y: 0, width: 8, height: 4, params: { level: 0.5, color: 0xff00ff00, peak: true, source: 'out' }, revision: 0 })
    assert.ok(Object.isFrozen(command.params))
    assert.throws(() => record(draw => draw.drawNative('')), /名称/)
    assert.throws(() => record(draw => draw.drawNative('meter', { params: { level: Number.NaN } })), /有限/)
    assert.throws(() => record(draw => draw.drawNative('meter', { params: { level: {} as never } })), /数值、布尔、字符串或数据源/)
    scope.stop()
})

test('drawNative 的数据源参数按名称传递并登记读取，数据推进即重录且命令不同', () => {
    const scope = effectScope()
    const meter = new DataSourceState('meter', 'out', new Float32Array(1)), view = sourceView(meter)
    const instance = scope.run(() => new DrawInstance('drawBehind', { draw(draw: DrawScope) { draw.drawNative('meter', { width: 8, height: 4, params: { source: view } }) } }))!
    const [first] = decodeDraw(instance.prepare(10, 10))
    assert.equal((first.params as { source: string }).source, 'out')
    assert.equal(first.revision, 0)
    meter.publish()
    assert.equal(instance.revision.value, 1, '读过的数据源推进没有触发重录')
    const [second] = decodeDraw(instance.prepare(10, 10))
    assert.equal(second.revision, 1)
    instance.stop()
    scope.stop()
})
