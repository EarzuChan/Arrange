import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, watch } from '../../packages/framework/src/index.ts'
import { hasInterop, invokeNative, onNativeEvent, useHost, useMeter, useParameter, useSpectrum, useTransport, useWaveform } from '@arrange/framework/interop'
import type { NativeInterop, NativeInteropDriver, NativeTransactionTarget, NativeTransport } from '../../packages/framework/src/native.ts'

const stopped: NativeTransport = { playing: false, recording: false, looping: false, bpm: null, timeSignature: null, positionPpq: null, positionSeconds: null }

// 记录脚本对原生互操作入口的调用；driver 由测试直接驱动，模拟语义检查点交付
function fakeInterop() {
    const values = [0.25, 0]
    const calls: string[] = []
    const subscriptions = new Map<number, string>()
    let nextId = 1
    let driver: NativeInteropDriver | undefined
    const api: NativeInterop = {
        install: value => { driver = value },
        parameters: () => [
            { index: 0, id: 'gain', name: 'Gain', label: 'dB', defaultNormalized: 0.5, steps: 0, discrete: false, boolean: false, minimum: -60, maximum: 0, value: values[0] },
            { index: 1, id: 'mode', name: 'Mode', label: '', defaultNormalized: 0, steps: 3, discrete: true, boolean: false, minimum: 0, maximum: 2, value: values[1] },
        ],
        parameterValue: index => values[index],
        toPlain: (index, normalized) => index === 0 ? -60 + 60 * normalized : 2 * normalized,
        toNormalized: (index, value) => index === 0 ? (value + 60) / 60 : value / 2,
        text: (index, normalized) => `${Math.round(api.toPlain(index, normalized))}`,
        parse: (index, text) => api.toNormalized(index, Number(text)),
        gesture: (index, phase) => { calls.push(`${phase} ${index}`) },
        set: (index, normalized, complete) => {
            values[index] = normalized
            calls.push(`set ${index} ${normalized} ${complete}`)
        },
        host: () => ({ name: 'Fake DAW', format: 'vst3', sampleRate: 48000, blockSize: 256 }),
        transport: () => stopped,
        subscribe: (kind, name, size) => {
            const id = nextId++
            subscriptions.set(id, `${kind}:${name}:${size ?? ''}`)
            return id
        },
        unsubscribe: id => { subscriptions.delete(id) },
        invoke: (name, args) => {
            calls.push(`invoke ${name} ${JSON.stringify(args)}`)
            return nextId++
        },
    }
    const native = { interop: api } as unknown as NativeTransactionTarget
    globalThis.__ARRANGE_NATIVE__ = native
    return { api, values, calls, subscriptions, get driver() { return driver! } }
}

afterEach(() => { globalThis.__ARRANGE_NATIVE__ = undefined })

test('参数以 value / normalized / text 被依赖追踪，多处使用共享同一状态', () => {
    const host = fakeInterop()
    assert.equal(hasInterop(), true)
    const gain = useParameter('gain')
    assert.equal(useParameter('gain'), gain)
    assert.equal(gain.normalized, 0.25)
    assert.equal(gain.value, -45)
    assert.equal(gain.text, '-45')
    assert.deepEqual({ ...gain.descriptor }, { id: 'gain', name: 'Gain', label: 'dB', defaultNormalized: 0.5, steps: 0, discrete: false, boolean: false, minimum: -60, maximum: 0 })

    const seen: number[] = []
    const stop = watch(() => gain.value, value => seen.push(value), { flush: 'sync' })
    host.driver.parameters([0], [0.75])
    assert.deepEqual(seen, [-15])
    host.driver.parameters([0], [0.75])
    assert.deepEqual(seen, [-15], '宿主回传同值不应再次触发')
    stop()
    assert.throws(() => useParameter('missing'), RangeError)
})

test('赋值是一次完整操作；gesture 期间宿主回传不覆盖本地值，结束后对齐宿主', () => {
    const host = fakeInterop()
    const gain = useParameter('gain')
    gain.value = -30
    assert.deepEqual(host.calls, ['set 0 0.5 true'])
    assert.equal(gain.normalized, 0.5)
    gain.value = -30
    assert.equal(host.calls.length, 1, '同值写入不产生宿主操作')

    const drag = gain.gesture()
    drag.begin()
    drag.set(-6)
    assert.throws(() => { gain.normalized = 0.2 }, /gesture 进行中/)
    host.driver.parameters([0], [0.1])
    assert.equal(gain.normalized, 0.9, 'gesture 期间不被宿主值覆盖')
    host.values[0] = 0.8
    drag.end()
    assert.equal(gain.normalized, 0.8)
    assert.deepEqual(host.calls.slice(1), ['begin 0', 'set 0 0.9 false', 'end 0'])
    gain.reset()
    assert.equal(host.calls.at(-1), 'set 0 0.5 true')
    assert.equal(gain.textFor(1), '0')
    assert.equal(gain.parseText('-60'), 0)
})

test('gesture 随 scope 销毁自动结束', () => {
    const host = fakeInterop()
    const scope = effectScope()
    const drag = scope.run(() => useParameter('mode').gesture())!
    drag.begin()
    drag.setNormalized(1)
    scope.stop()
    assert.equal(drag.active, false)
    assert.deepEqual(host.calls, ['begin 1', 'set 1 1 false', 'end 1'])
})

test('宿主与走带为只读响应式快照，走带与观测流的订阅随 scope 退订', () => {
    const host = fakeInterop()
    const scope = effectScope()
    const { info, transport, level, scopeSamples, bins } = scope.run(() => ({ info: useHost(), transport: useTransport(), level: useMeter('out'), scopeSamples: useWaveform('scope', { size: 2 }), bins: useSpectrum('bins') }))!
    assert.equal(info.name, 'Fake DAW')
    assert.equal(transport.playing, false)
    assert.deepEqual([...host.subscriptions.values()], ['transport::', 'meter:out:', 'waveform:scope:2', 'spectrum:bins:'])

    const playing: boolean[] = []
    const stop = watch(() => transport.playing, value => playing.push(value), { flush: 'sync' })
    host.driver.transport({ ...stopped, playing: true, bpm: 120 })
    assert.deepEqual(playing, [true])
    assert.equal(transport.bpm, 120)
    stop()
    host.driver.host({ name: 'Fake DAW', format: 'vst3', sampleRate: 96000, blockSize: 64 })
    assert.equal(info.sampleRate, 96000)
    assert.throws(() => { (info as { name: string | null }).name = 'x' }, TypeError)

    host.driver.meter('out', 0.6)
    assert.equal(level.value, 0.6)
    host.driver.waveform('scope', new Float32Array([1, 2, 3, 4]))
    assert.deepEqual([...scopeSamples.value], [3, 4], '取最近 size 个样本')
    host.driver.spectrum('bins', new Float32Array([5, 6]))
    assert.deepEqual([...bins.value], [5, 6])

    scope.stop()
    assert.equal(host.subscriptions.size, 0)
})

test('原生消息按名称分发，调用以 Promise 交付结果与拒绝', async () => {
    const host = fakeInterop()
    const scope = effectScope()
    const received: unknown[] = []
    scope.run(() => onNativeEvent('presetLoaded', value => received.push(value)))
    host.driver.message('presetLoaded', { name: 'Warm' })
    host.driver.message('other', 1)
    assert.deepEqual(received, [{ name: 'Warm' }])
    scope.stop()
    host.driver.message('presetLoaded', { name: 'Cold' })
    assert.equal(received.length, 1)

    const saved = invokeNative<string>('save', ['a', 1])
    const failed = invokeNative('missing')
    assert.deepEqual(host.calls, ['invoke save ["a",1]', 'invoke missing null'])
    host.driver.reply(1, true, 'ok', '')
    host.driver.reply(2, false, null, '未登记的原生调用：missing')
    assert.equal(await saved, 'ok')
    await assert.rejects(failed, /未登记的原生调用/)
})

test('宿主未连接 Interop 时明确报错', () => {
    globalThis.__ARRANGE_NATIVE__ = {} as NativeTransactionTarget
    assert.equal(hasInterop(), false)
    assert.throws(() => useParameter('gain'), /未连接 Interop/)
})
