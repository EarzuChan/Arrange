import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as core from '@arrange/framework'
import { createApp, createFocusRequester, FocusManagerKey, inject, provide, ref, onMounted, nextTick, type FocusRequester, type FocusManager } from '@arrange/framework'
import { Layout } from '@arrange/framework/foundation'
import { M, MinSizeMeasurePolicy } from '@arrange/framework/ui'
import { defineArrangable } from '@arrange/framework/internal'
import { recordingNative } from './recordingNative.ts'
import { compileArrangeSfa } from '../../packages/vite-plugin/src/sfa.ts'
import { checkSfaProject } from '../../packages/vite-plugin/src/typecheck.ts'
import { evaluateSfa } from './sfaModules.ts'

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
            manager = inject(FocusManagerKey)!
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
    assert.throws(() => inject(FocusManagerKey), /活动 Arrangable/)
    assert.equal('useFocusManager' in core, false)
    const compiled = compileArrangeSfa(`<template><Layout :measurePolicy="MinSizeMeasurePolicy" :modifier="M.focusRequester(target).onFocusChanged(changed).focusProperties({ right: target }).focusGroup().focusable()" /></template><script>
import { createFocusRequester } from '@arrange/framework'
import { M, MinSizeMeasurePolicy } from '@arrange/framework/ui'
const target = createFocusRequester()
function changed(state: { isFocused: boolean; hasFocus: boolean }) {}
</script>`, 'M3焦点.sfa')
    assert.match(compiled.code, /focusRequester.*onFocusChanged.*focusProperties.*focusGroup.*focusable/s)
})

test('默认 FocusManager 在同一 Owner 中共享，不同 Owner 的命令与生命周期隔离', () => {
    const first = recordingNative()
    const second = recordingNative()
    const firstCommands: unknown[][] = []
    const secondCommands: unknown[][] = []
    first.target.focusCommand = (...args) => {
        firstCommands.push(args)
        return true
    }
    second.target.focusCommand = (...args) => {
        secondCommands.push(args)
        return true
    }
    const consumers: FocusManager[] = []
    const Child = defineArrangable({
        setup(_props, { call }) {
            consumers.push(inject(FocusManagerKey)!)
            return () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy })
        }
    })
    const Root = defineArrangable({
        setup(_props, { call }) {
            consumers.push(inject(FocusManagerKey)!)
            return () => {
                call(0, Child, {})
                call(1, Child, {})
            }
        }
    })
    const firstApp = createApp(Root)
    const secondApp = createApp(Root)
    firstApp.mount(first.target)
    first.frame()
    secondApp.mount(second.target)
    second.frame()
    assert.equal(consumers.length, 6)
    assert.ok(consumers[0])
    assert.equal(consumers[0], consumers[1])
    assert.equal(consumers[0], consumers[2])
    assert.equal(consumers[3], consumers[4])
    assert.equal(consumers[3], consumers[5])
    assert.notEqual(consumers[0], consumers[3])
    assert.equal(consumers[0].moveFocus('right'), true)
    assert.equal(consumers[3].moveFocus('down'), true)
    assert.deepEqual(firstCommands, [['move', 0, 'right']])
    assert.deepEqual(secondCommands, [['move', 0, 'down']])
    firstApp.unmount()
    assert.equal(consumers[0].moveFocus('next'), false)
    consumers[0].clearFocus()
    assert.deepEqual(firstCommands, [['move', 0, 'right']])
    assert.equal(consumers[3].moveFocus('previous'), true)
    assert.deepEqual(secondCommands.at(-1), ['move', 0, 'previous'])
    secondApp.unmount()
})

test('FocusManagerKey 支持 App 默认覆盖与祖先局部覆盖，兄弟分支保持应用服务', () => {
    const native = recordingNative()
    const calls: string[] = []
    const appManager: FocusManager = {
        clearFocus: () => { calls.push('应用清除') }, moveFocus: direction => {
            calls.push(`应用:${direction}`)
            return true
        }
    }
    const localManager: FocusManager = {
        clearFocus: () => { calls.push('局部清除') }, moveFocus: direction => {
            calls.push(`局部:${direction}`)
            return false
        }
    }
    const seen = new Map<string, FocusManager>()
    const Consumer = defineArrangable({
        props: { branch: { type: String, required: true } },
        setup(props, { call }) {
            seen.set(props.branch, inject(FocusManagerKey)!)
            return () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy })
        }
    })
    const Provider = defineArrangable({
        setup(_props, { call }) {
            seen.set('提供者', inject(FocusManagerKey)!)
            provide(FocusManagerKey, localManager)
            return () => call(0, Consumer, { branch: () => '局部' })
        }
    })
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            seen.set('根', inject(FocusManagerKey)!)
            return () => {
                call(0, Provider, {})
                call(1, Consumer, { branch: () => '兄弟' })
            }
        }
    })).provide(FocusManagerKey, appManager)
    app.mount(native.target)
    native.frame()
    assert.equal(seen.get('根'), appManager)
    assert.equal(seen.get('提供者'), appManager)
    assert.equal(seen.get('局部'), localManager)
    assert.equal(seen.get('兄弟'), appManager)
    assert.equal(seen.get('局部')!.moveFocus('left'), false)
    seen.get('局部')!.clearFocus()
    assert.equal(seen.get('兄弟')!.moveFocus('next'), true)
    seen.get('兄弟')!.clearFocus()
    assert.deepEqual(calls, ['局部:left', '局部清除', '应用:next', '应用清除'])
    app.unmount()
})

test('消费者卸载保留 Owner FocusManager，Owner 卸载失效，重挂载创建绑定新宿主的服务', () => {
    const first = recordingNative()
    const second = recordingNative()
    const firstCommands: unknown[][] = []
    const secondCommands: unknown[][] = []
    first.target.focusCommand = (...args) => {
        firstCommands.push(args)
        return true
    }
    second.target.focusCommand = (...args) => {
        secondCommands.push(args)
        return true
    }
    const show = ref(true)
    const ownerManagers: FocusManager[] = []
    const consumerManagers: FocusManager[] = []
    const Consumer = defineArrangable({
        setup(_props, { call }) {
            consumerManagers.push(inject(FocusManagerKey)!)
            return () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy })
        }
    })
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            ownerManagers.push(inject(FocusManagerKey)!)
            return () => { if (show.value) call(0, Consumer, {}) }
        }
    }))
    app.mount(first.target)
    first.frame()
    assert.equal(ownerManagers[0], consumerManagers[0])
    show.value = false
    first.frame()
    assert.equal(consumerManagers[0].moveFocus('up'), true)
    app.unmount()
    assert.equal(ownerManagers[0].moveFocus('next'), false)
    ownerManagers[0].clearFocus()
    assert.deepEqual(firstCommands, [['move', 0, 'up']])
    show.value = true
    app.mount(second.target)
    second.frame()
    assert.equal(ownerManagers.length, 2)
    assert.notEqual(ownerManagers[0], ownerManagers[1])
    assert.equal(ownerManagers[1], consumerManagers[1])
    assert.equal(ownerManagers[0].moveFocus('left'), false)
    assert.equal(ownerManagers[1].moveFocus('right'), true)
    ownerManagers[1].clearFocus()
    assert.deepEqual(firstCommands, [['move', 0, 'up']])
    assert.deepEqual(secondCommands, [['move', 0, 'right'], ['clear', 0]])
    app.unmount()
})

test('挂载后 App 覆盖 FocusManager 供新消费者注入，已有默认引用保留至 Owner 卸载', () => {
    const native = recordingNative()
    const commands: unknown[][] = []
    native.target.focusCommand = (...args) => {
        commands.push(args)
        return true
    }
    const customCalls: string[] = []
    const custom: FocusManager = {
        clearFocus() { customCalls.push('清除') },
        moveFocus(direction) {
            customCalls.push(direction)
            return true
        }
    }
    const showNewConsumer = ref(false)
    const managers: FocusManager[] = []
    const Consumer = defineArrangable({
        setup(_props, { call }) {
            managers.push(inject(FocusManagerKey)!)
            return () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy })
        }
    })
    const app = createApp(defineArrangable({
        setup: (_props, { call }) => () => {
            call(0, Consumer, {})
            if (showNewConsumer.value) call(1, Consumer, {})
        }
    }))
    app.mount(native.target)
    native.frame()
    assert.equal(managers.length, 1)
    const defaultManager = managers[0]
    assert.notEqual(defaultManager, custom)
    app.provide(FocusManagerKey, custom)
    showNewConsumer.value = true
    native.frame()
    assert.equal(managers.length, 2)
    assert.equal(managers[0], defaultManager)
    assert.equal(managers[1], custom)
    assert.equal(defaultManager.moveFocus('left'), true)
    defaultManager.clearFocus()
    assert.equal(managers[1].moveFocus('right'), true)
    managers[1].clearFocus()
    assert.deepEqual(commands, [['move', 0, 'left'], ['clear', 0]])
    assert.deepEqual(customCalls, ['right', '清除'])
    app.unmount()
    assert.equal(defaultManager.moveFocus('next'), false)
    defaultManager.clearFocus()
    assert.deepEqual(commands, [['move', 0, 'left'], ['clear', 0]])
    assert.equal(custom.moveFocus('next'), true)
    assert.deepEqual(customCalls, ['right', '清除', 'next'])
})

test('宿主安装失败后可重挂载，默认 FocusManager 绑定成功安装的宿主', () => {
    const failed = recordingNative()
    const successful = recordingNative()
    const failedCommands: unknown[][] = []
    const commands: unknown[][] = []
    const installFailedDriver = failed.target.installFrameDriver
    failed.target.focusCommand = (...args) => {
        failedCommands.push(args)
        return true
    }
    failed.target.installFrameDriver = () => { throw new Error('宿主拒绝安装') }
    successful.target.focusCommand = (...args) => {
        commands.push(args)
        return true
    }
    const managers: FocusManager[] = []
    const app = createApp(defineArrangable({
        setup(_props, { call }) {
            managers.push(inject(FocusManagerKey)!)
            return () => call(0, Layout, { measurePolicy: () => MinSizeMeasurePolicy })
        }
    }))
    assert.throws(() => app.mount(failed.target), /宿主拒绝安装/)
    assert.equal(managers.length, 0)
    app.mount(successful.target)
    successful.frame()
    assert.equal(managers.length, 1)
    assert.equal(managers[0].moveFocus('next'), true)
    assert.deepEqual(failedCommands, [])
    assert.deepEqual(commands, [['move', 0, 'next']])
    app.unmount()
    assert.equal(managers[0].moveFocus('next'), false)
    failed.target.installFrameDriver = installFailedDriver
    app.mount(failed.target)
    failed.frame()
    assert.equal(managers.length, 2)
    assert.notEqual(managers[0], managers[1])
    assert.equal(managers[1].moveFocus('previous'), true)
    assert.deepEqual(failedCommands, [['move', 0, 'previous']])
    app.unmount()
})

test('SFA 通过 typed FocusManagerKey 注入消费，方向参数保留真实类型', () => {
    const source = `<template><Layout :measurePolicy="MinSizeMeasurePolicy" :modifier="M.focusRequester(target).focusable()" /></template><script>
import { createFocusRequester, FocusManagerKey, inject, onMounted, type FocusManager } from '@arrange/framework'
import { M, MinSizeMeasurePolicy } from '@arrange/framework/ui'
const target = createFocusRequester()
const manager: FocusManager | undefined = inject(FocusManagerKey)
onMounted(() => manager?.moveFocus('next'))
</script>`
    mkdirSync(resolve('tmp-refs'), { recursive: true })
    const directory = mkdtempSync(resolve('tmp-refs/sfa-focus-'))
    try {
        const file = join(directory, 'Focus.sfa')
        writeFileSync(file, source)
        assert.deepEqual(checkSfaProject(resolve('tsconfig.json'), [file]), [])
        writeFileSync(file, source.replace("const manager: FocusManager | undefined", 'const manager').replace("moveFocus('next')", "moveFocus('diagonal')"))
        assert.ok(checkSfaProject(resolve('tsconfig.json'), [file]).some(diagnostic => /diagonal.*FocusDirection/.test(diagnostic.message)))
    } finally {
        rmSync(directory, { recursive: true })
    }
    const native = recordingNative()
    const commands: unknown[][] = []
    native.target.focusCommand = (...args) => {
        commands.push(args)
        return true
    }
    const app = createApp(evaluateSfa(source, {}, '焦点注入.sfa'))
    app.mount(native.target)
    native.frame()
    assert.deepEqual(commands, [['move', 0, 'next']])
    app.unmount()
})
