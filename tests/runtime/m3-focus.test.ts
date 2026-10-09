import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp, createFocusRequester, useFocusManager, onMounted, nextTick, type FocusRequester, type FocusManager } from '@arrange/framework'
import { Layout } from '@arrange/framework/foundation'
import { M, MinSizeMeasurePolicy } from '@arrange/framework/ui'
import { defineArrangable } from '@arrange/framework/internal'
import { recordingNative } from './recordingNative.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'

test('焦点请求发送宿主命令；nextTick 不冒充原生焦点回执，unmount 取消请求', async () => {
    const native = recordingNative()
    const commands: unknown[][] = []
    native.target.focusCommand = (...args) => {
        commands.push(args)
        return true
    }
    let requester!: FocusRequester
    let manager!: FocusManager
    const observed: boolean[] = []
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            requester = createFocusRequester()
            manager = useFocusManager()
            onMounted(() => assert.equal(requester.requestFocus(), true))
            return () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy, modifier: () => M.focusRequester(requester).onFocusChanged(state => observed.push(state.isFocused)).focusable() })
        }
    }))
    app.mount(native.target)
    native.frame()
    assert.equal(commands[0][0], 'request')
    await nextTick()
    assert.deepEqual(observed, [])
    assert.equal(manager.moveFocus('previous'), true)
    manager.clearFocus()
    assert.deepEqual(commands.slice(1), [['move', 0, 'previous'], ['clear', 0]])
    assert.throws(() => manager.moveFocus('diagonal' as never), /方向/)
    app.unmount()
    assert.deepEqual(commands.at(-1), ['cancel', commands[0][1]])
    assert.equal(requester.requestFocus(), false)
    assert.equal(manager.moveFocus('next'), false)
})

test('focusProperties 持有稳定 Requester 身份，普通 Modifier 描述可由 SFA 组合', () => {
    const a = createFocusRequester()
    const b = createFocusRequester()
    const chain = M.focusGroup().focusProperties({ right: b, next: a, canFocus: false }).focusRequester(a).focusable()
    assert.deepEqual(chain.elements.map(element => element.type), ['focusGroup', 'focusProperties', 'focusRequester', 'focusable'])
    assert.equal(chain.elements[1].value.next, chain.elements[2].value.requester)
    assert.notEqual(chain.elements[1].value.right, chain.elements[2].value.requester)
    assert.equal(chain.elements[1].value.canFocus, false)
    assert.throws(() => M.focusRequester({ requestFocus: () => true }), /createFocusRequester/)
    assert.throws(() => M.onFocusChanged(null as never), /函数/)
    assert.throws(() => useFocusManager(), /setup/)
    const compiled = compileArrangeSfa(`<template><Layout :measurePolicy="MinSizeMeasurePolicy" :modifier="M.focusRequester(target).onFocusChanged(changed).focusProperties({ right: target }).focusGroup().focusable()" /></template><script>
import { createFocusRequester } from '@arrange/framework'
import { M, MinSizeMeasurePolicy } from '@arrange/framework/ui'
const target = createFocusRequester()
function changed(state: { isFocused: boolean; hasFocus: boolean }) {}
</script>`, 'M3焦点.sfa')
    assert.match(compiled.code, /focusRequester.*onFocusChanged.*focusProperties.*focusGroup.*focusable/s)
})
