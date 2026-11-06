import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope } from '@arrange/reactivity'
import { DrawInstance, type DrawScope } from '../../packages/framework/src/draw.ts'
import { FontWeight, defineFontFamily, normalizeFontStyle } from '../../packages/framework/src/font.ts'
import type { NativeBindingHandle, NativeTransactionTarget } from '../../packages/framework/src/native.ts'
import type { PainterCompletion } from '../../packages/framework/src/painter.ts'
import { decodeDraw } from '../helpers/drawCommands.ts'
import { createFakeNative } from '../helpers/fakeNative.ts'

test('字重常量是 CSS 数值，样式字段归一并拒绝非法值', () => {
    assert.deepEqual(Object.values(FontWeight), [100, 200, 300, 400, 500, 600, 700, 800, 900])
    assert.deepEqual(normalizeFontStyle({ fontSize: 12, fontFamily: ' Inter ' }), { fontSize: 12, fontFamily: ['Inter'] })
    assert.deepEqual(normalizeFontStyle({ fontFamily: ['A', 'B'], fontWeight: 650, fontStyle: 'italic', fontSynthesis: false }), { fontFamily: ['A', 'B'], fontWeight: 650, fontStyle: 'italic', fontSynthesis: false })
    const untouched = { fontSize: 12 }
    assert.equal(normalizeFontStyle(untouched), untouched)
    assert.throws(() => normalizeFontStyle({ fontFamily: '' }), /fontFamily/)
    assert.throws(() => normalizeFontStyle({ fontFamily: [1] }), /fontFamily/)
    assert.throws(() => normalizeFontStyle({ fontFamily: new Array(17).fill('A') }), /fontFamily/)
    assert.throws(() => normalizeFontStyle({ fontWeight: 0 }), /fontWeight/)
    assert.throws(() => normalizeFontStyle({ fontWeight: 400.5 }), /fontWeight/)
    assert.throws(() => normalizeFontStyle({ fontStyle: 'oblique' }), /fontStyle/)
    assert.throws(() => normalizeFontStyle({ fontSynthesis: 1 }), /fontSynthesis/)
})

test('drawText 把字体字段写入数值流，族名列表以换行进引用表', () => {
    const scope = effectScope()
    const instance = scope.run(() => new DrawInstance('drawBehind', {
        draw(draw: DrawScope) {
            draw.drawText({ text: 'a', color: 0xff000000, fontFamily: ['Inter', 'Noto Sans'], fontWeight: FontWeight.SemiBold, fontStyle: 'italic', fontSynthesis: false })
        }
    }))!
    const [command] = decodeDraw(instance.prepare(20, 20))
    assert.deepEqual([command.fontFamily, command.fontWeight, command.italic, command.fontSynthesis], ['Inter\nNoto Sans', 600, 1, 0])
    assert.throws(() => scope.run(() => new DrawInstance('drawBehind', { draw(draw: DrawScope) { draw.drawText({ text: 'a', color: 0xff000000, fontWeight: 1001 }) } }))!.prepare(10, 10), /fontWeight/)
    scope.stop()
})

interface FontNative {
    target: NativeTransactionTarget
    log: string[]
    completions: Map<string, (result: PainterCompletion) => void>
    defined: { name: string; faces: readonly { contentVersion: number; weight?: number; style?: string }[] }[]
}

function fontNative(readyImmediately = false): FontNative {
    const log: string[] = []
    const completions = new Map<string, (result: PainterCompletion) => void>()
    const defined: FontNative['defined'] = []
    let identity = 1n
    const target = createFakeNative({
        acquirePainter(resource, completion): NativeBindingHandle & { ready?: PainterCompletion } {
            log.push(`acquire ${resource}`)
            completions.set(resource, completion)
            return { identity: identity++, generation: 1n, ...(readyImmediately ? { ready: { contentVersion: 1 } } : {}) }
        },
        releasePainter: () => { log.push('release') },
        defineFontFamily: (name, faces) => { defined.push({ name, faces }); log.push(`define ${name} ${faces.length}`) },
        removeFontFamily: name => { log.push(`remove ${name}`) },
        beginFontPreload: () => { log.push('begin') },
        endFontPreload: () => { log.push('end') },
    })
    return { target, log, completions, defined }
}

test('defineFontFamily 走资源获取层，到达一个就登记一次，预加载在全部结束后释放', () => {
    const native = fontNative()
    globalThis.__ARRANGE_NATIVE__ = native.target
    try {
        const family = defineFontFamily(' Demo Sans ', { preload: true, faces: [{ src: 'fonts/a.ttf', weight: 700 }, { src: { path: 'fonts/b.ttf' }, style: 'italic' }] })
        assert.equal(family.name, 'Demo Sans')
        assert.equal(family.status, 'loading')
        assert.deepEqual(native.log, ['begin', 'acquire fonts/a.ttf', 'acquire fonts/b.ttf'])
        native.completions.get('fonts/a.ttf')!({ contentVersion: 1 })
        assert.equal(family.status, 'loading')
        assert.deepEqual(native.defined.map(item => item.faces.length), [1])
        assert.equal(native.defined[0].faces[0].weight, 700)
        native.completions.get('fonts/b.ttf')!({ contentVersion: 1, error: '网络失败' })
        assert.equal(family.status, 'ready')
        assert.match(family.error ?? '', /网络失败/)
        assert.equal(native.log.at(-1), 'end')
        family.dispose()
        assert.equal(family.status, 'disposed')
        assert.deepEqual(native.log.slice(-3), ['remove Demo Sans', 'release', 'release'])
    } finally { delete globalThis.__ARRANGE_NATIVE__ }
})

test('defineFontFamily：已缓存的字面立即就绪，全部失败则整体失败，参数在获取前校验', () => {
    const cached = fontNative(true)
    globalThis.__ARRANGE_NATIVE__ = cached.target
    try {
        const family = defineFontFamily('Cached', { faces: [{ src: 'a.ttf' }] })
        assert.equal(family.status, 'ready')
        assert.deepEqual(cached.log, ['acquire a.ttf', 'define Cached 1'])
        const failing = fontNative()
        globalThis.__ARRANGE_NATIVE__ = failing.target
        const broken = defineFontFamily('Broken', { preload: true, faces: [{ src: 'x.ttf' }] })
        failing.completions.get('x.ttf')!({ contentVersion: 1, error: '无法解码' })
        assert.equal(broken.status, 'failed')
        assert.deepEqual(failing.log, ['begin', 'acquire x.ttf', 'end'])
        assert.deepEqual(failing.defined, [])
        const rejected = fontNative()
        globalThis.__ARRANGE_NATIVE__ = rejected.target
        assert.throws(() => defineFontFamily('', { faces: [{ src: 'a.ttf' }] }), /族名/)
        assert.throws(() => defineFontFamily('A', { faces: [] }), /字面/)
        assert.throws(() => defineFontFamily('A', { faces: [{ src: 'a.ttf' }, { src: '' }] }), /src/)
        assert.throws(() => defineFontFamily('A', { faces: [{ src: 'a.ttf', weight: 0 }] }), /weight/)
        assert.deepEqual(rejected.log, [])
    } finally { delete globalThis.__ARRANGE_NATIVE__ }
})
