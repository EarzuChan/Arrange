import assert from 'node:assert/strict'
import test from 'node:test'
import { PromptController, cancelled } from '../src/terminal/PromptController.ts'
import { SessionDocument } from '../src/terminal/SessionDocument.ts'
import type { InputEvent } from '../src/terminal/InputDecoder.ts'

function fixture() {
    const document = new SessionDocument()
    const controller = new PromptController(document, () => { }, () => { })
    const key = (key: string, text?: string) => controller.handle({ kind: 'key', key, text } as InputEvent)
    return { document, controller, key }
}

test('禁用选项不能成为默认值，方向键和首尾翻页只定位可用选项', async () => {
    const { controller, key, document } = fixture()
    const options = Array.from({ length: 24 }, (_, value) => ({ value, label: String(value), disabled: value % 3 !== 1 }))
    const result = controller.ask<number>({ kind: 'select', message: '版本', initial: 0, options })
    assert.equal(controller.content!.index, 1)
    assert.deepEqual(controller.content!.disabled, options.flatMap((option, index) => option.disabled ? [index] : []))
    for (const [event, index] of [['down', 4], ['right', 7], ['up', 4], ['left', 1], ['up', 22], ['home', 1], ['end', 22], ['pageup', 1], ['pagedown', 22], ['down', 1]] as const) {
        key(event)
        assert.equal(controller.content!.index, index, event)
    }
    key('enter')
    assert.equal(await result, 1)
    assert.deepEqual(document.entries, [{ type: 'answer', question: '版本', answer: '1' }])
})

test('多选初始值清除禁用项，切换与确认只返回可用值', async () => {
    const { controller, key } = fixture()
    const result = controller.ask<number[]>({ kind: 'multiselect', message: '模块', required: true, initial: [0, 2], options: [{ value: 0, label: '禁用', disabled: true }, { value: 1, label: '一' }, { value: 2, label: '二' }] })
    assert.deepEqual(controller.content!.selected, [2])
    key('text', ' ')
    key('end')
    key('text', ' ')
    key('enter')
    assert.deepEqual(await result, [1])
})

test('确认快捷键不能接受禁用答案，全禁用立即拒绝且仍可开启下一题', async () => {
    const { controller, key } = fixture()
    await assert.rejects(controller.ask({ kind: 'select', message: '不可选', options: [{ value: true, label: '是', disabled: true }] }), /至少有一个可用选项/)
    assert.equal(controller.active, false)
    const result = controller.ask<boolean>({ kind: 'select', message: '继续', initial: true, options: [{ value: true, label: '是', disabled: true }, { value: false, label: '否' }] })
    key('text', 'y')
    assert.equal(controller.active, true)
    assert.equal(controller.content!.index, 1)
    key('text', 'n')
    assert.equal(await result, false)
    const pending = controller.ask({ kind: 'select', message: '取消', options: [{ value: 1, label: '一' }] })
    controller.cancel()
    assert.equal(await pending, cancelled)
})
