import assert from 'node:assert/strict'
import test from 'node:test'
import { runDemo } from './app.ts'
import { preparationAt } from './simulation.ts'
import type { CommandUi, TaskDefinition } from './tui/index.ts'

test('命令只通过语义接口完成线性提问和业务进展，不需要终端或输入事件', async () => {
    const calls: string[] = []
    const outputs = new Map<string, string[]>()
    let definitions: readonly TaskDefinition[] = []
    const ui: CommandUi = {
        heading: text => { calls.push(`标题：${text}`) },
        message: text => { calls.push(`消息：${text}`) },
        select: async (_question, options) => {
            calls.push('选择模板')
            return options[1].value
        },
        text: async (_question, options) => {
            calls.push('填写项目名')
            assert.equal(options?.placeholder, '请输入项目名')
            return '业务测试工程'
        },
        multiselect: async (_question, options, initial) => {
            calls.push('选择模块')
            assert.deepEqual(initial, ['ui', 'native-debug'])
            return options.map(option => option.value)
        },
        tasks: (title, tasks) => {
            calls.push(`任务批次：${title}`)
            definitions = tasks
            return {
                task: id => ({
                    start: () => { calls.push(`开始：${id}`) },
                    progress: value => { calls.push(`进度：${id}：${value}`) },
                    append: lines => { outputs.set(id, [...outputs.get(id) ?? [], ...lines]) },
                    complete: () => { calls.push(`完成：${id}`) },
                }),
                complete: () => { calls.push('批次完成') },
            }
        },
        result: text => { calls.push(`结果：${text}`) },
    }
    const signal = new AbortController().signal
    await runDemo(ui, signal, async function*(selected, receivedSignal) {
        assert.strictEqual(receivedSignal, signal)
        for (const elapsed of [0, 800, 1600, 3200, 4800, 10000]) yield preparationAt(selected, elapsed)
    })
    assert.deepEqual(calls.filter(call => ['选择模板', '填写项目名', '选择模块'].includes(call)), ['选择模板', '填写项目名', '选择模块'])
    assert.equal(calls.at(-2), '批次完成')
    assert.equal(calls.at(-1), '结果：Arrange 同步已完成')
    assert.equal(definitions.find(task => task.id === 'check')?.console, undefined)
    for (const task of definitions) {
        assert.equal(calls.filter(call => call === `开始：${task.id}`).length, 1)
        assert.equal(calls.filter(call => call === `完成：${task.id}`).length, 1)
    }
    for (const event of preparationAt(['ui', 'native-debug', 'native-release'], 10000)) if (event.lines.length) assert.deepEqual(outputs.get(event.id), event.lines)
})
