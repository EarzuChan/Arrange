import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setImmediate as turn } from 'node:timers/promises'
import test from 'node:test'
import type { CommandUi } from './api.ts'
import { TerminalSession } from './session.ts'
import { TerminalDriver } from './terminal-driver.ts'
import { protocol } from './protocol.js'
import { TranscriptRenderer } from './view.js'
import { runDemo } from '../app.ts'
import { preparationAt } from '../simulation.ts'

class Input extends EventEmitter {
    isTTY = true
    isRaw = false
    readableFlowing = false
    setRawMode(raw: boolean): void { this.isRaw = raw }
    resume(): void { this.readableFlowing = true }
    pause(): void { this.readableFlowing = false }
}

function fixture() {
    const input = new Input(), host = new EventEmitter(), writes: string[] = []
    const output = Object.assign(new EventEmitter(), {
        isTTY: true, columns: 80, rows: 24, write(text: string, callback?: (error?: Error) => void) {
            writes.push(text)
            callback?.()
            return true
        }
    })
    const driver = new TerminalDriver({ input, output, host, settleDelay: 0 })
    const session = new TerminalSession(driver)
    const send = (text: string) => input.emit('data', Buffer.from(text))
    return { input, host, writes, output, driver, session, send }
}

test('语义提问接收文本答案，粘贴不提交，退格按字素删除', async () => {
    const { session, send, input, writes } = fixture()
    const answers: unknown[] = []
    const run = session.run(async ui => {
        answers.push(await ui.select('模板', [{ value: 'blank', label: '空白' }, { value: 'vue', label: 'Vue' }]))
        answers.push(await ui.text('项目名', { placeholder: '请输入项目名' }))
        answers.push(await ui.multiselect('模块', [{ value: 'ui', label: 'UI' }, { value: 'native', label: 'Native' }], ['ui']))
        ui.result('已完成')
    })
    await turn()
    send('\r')
    await turn()
    send('\x1b[200~中😀\r\nproject\x1b[201~é\x7f')
    assert.deepEqual(answers, ['blank'])
    send('\r')
    await turn()
    send('\x1b[B \r')
    await turn()
    assert.deepEqual(answers, ['blank', '中😀 project', ['ui', 'native']])
    send('\r')
    assert.equal(await run, 0)
    assert.equal(input.isRaw, false)
    assert.ok(writes.at(-1)?.endsWith('└  已完成\r\n\r\n'))
    assert.equal(writes.filter(text => text === protocol.leave).length, 1)
})

test('命令取消会中断当前提问，只拍扁一次并恢复终端', async () => {
    const { session, send, driver, writes } = fixture()
    const run = session.run(async ui => { await ui.text('名字') })
    await turn()
    send('\x03\r')
    assert.equal(await run, 0)
    assert.equal(driver.state, 'closed')
    assert.equal(writes.filter(text => text === protocol.leave).length, 1)
    assert.ok(writes.at(-1)?.includes('已取消'))
})

test('取消后先等待服务释放资源，再恢复终端并写出历史', async () => {
    const { session, host, driver, writes } = fixture()
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    let cleanupStarted = false
    const run = session.run(async (ui, signal) => {
        ui.message('业务执行中')
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        cleanupStarted = true
        await released
    })
    await turn()
    host.emit('SIGTERM')
    await turn()
    assert.equal(cleanupStarted, true)
    assert.equal(driver.state, 'active')
    assert.equal(writes.includes(protocol.leave), false)
    release()
    assert.equal(await run, 1)
    assert.equal(driver.state, 'closed')
})

test('任务滚动只命中框内，框外历史和缩放不会向业务透出事件', async () => {
    const { session, send, writes, output } = fixture()
    const run = session.run(async ui => {
        ui.heading('开始')
        for (let index = 0; index < 20; index++) ui.message(`历史 ${index}`)
        const batch = ui.tasks('独立批次', [{ id: 'task', title: '任务', console: true }])
        const task = batch.task('task')
        task.start()
        task.append(Array.from({ length: 20 }, (_, index) => `输出 ${index}`))
        task.complete()
        batch.complete()
        ui.result('结束')
    })
    await turn()
    const before = writes.at(-1)
    assert.ok(before?.includes('输出 19'))
    send('\x1b[<64;4;19M')
    await turn()
    const consoleFrame = writes.at(-1)
    assert.ok(consoleFrame?.includes('╰─已完成'))
    assert.ok(consoleFrame?.includes('输出 16'))
    assert.equal(consoleFrame?.includes('输出 19'), false)
    send('\x1b[<64;3;19M')
    await turn()
    const historyFrame = writes.at(-1)
    assert.notEqual(historyFrame, consoleFrame)
    send('\x1b[<0;4;19M')
    output.columns = 17
    output.rows = 6
    output.emit('resize')
    await turn()
    assert.ok(writes.at(-1)?.includes('\x1b[6;1H'))
    send('\r')
    await run
    assert.ok(writes.at(-1)?.includes('输出 0'))
    assert.ok(writes.at(-1)?.includes('输出 19'))
})

test('任务视图句柄不暴露执行会话，未开始控制台不出现且批次标识互不串写', async () => {
    const { session, send, writes } = fixture()
    const run = session.run(async ui => {
        for (const title of ['第一批', '第二批']) {
            const batch = ui.tasks(title, [{ id: 'same', title, console: true }])
            const task = batch.task('same')
            assert.deepEqual(Object.keys(task), ['start', 'progress', 'append', 'complete'])
            task.start()
            task.append([`${title}输出`])
            task.complete()
            batch.complete()
        }
        const pending = ui.tasks('未执行', [{ id: 'pending', title: '等待任务', console: true }])
        assert.throws(() => pending.complete(), /尚未/)
        await ui.text('不得越过任务')
    })
    await assert.rejects(run, /活跃交互/)
    const transcript = writes.at(-1) ?? ''
    assert.ok(transcript.includes('第一批输出') && transcript.includes('第二批输出'))
    assert.equal((transcript.match(/╭/g) ?? []).length, 2)
    assert.ok(!transcript.includes('◇  不得越过任务'))
    send('\r')
})

test('业务接口只包含语义方法，活动提问期间不能追加下一项', async () => {
    const { session, send } = fixture()
    const run = session.run(async ui => {
        assert.deepEqual(Object.keys(ui), ['heading', 'message', 'result', 'select', 'text', 'multiselect', 'tasks'])
        assert.ok(Object.isFrozen(ui))
        const answer = ui.text('当前问题')
        assert.throws(() => ui.message('越过问题'), /活跃交互/)
        await answer
    })
    await turn()
    send('名字\r')
    await turn()
    send('\r')
    await run
})

test('命令异常和全局异常走同一恢复流程，服务得到取消信号', async () => {
    for (const global of [false, true]) {
        const { session, host, input, writes } = fixture()
        const run = session.run(async ui => {
            if (!global) throw new Error('业务失败')
            await ui.text('问题')
        })
        const failed = assert.rejects(run, global ? /全局失败/ : /业务失败/)
        if (global) {
            await turn()
            host.emit('uncaughtException', new Error('全局失败'))
        }
        await failed
        assert.equal(input.isRaw, false)
        assert.equal(host.listenerCount('uncaughtException'), 0)
        assert.ok(writes.includes(protocol.leave))
    }
})

test('拍扁渲染失败仍恢复终端并移除监听器', async context => {
    const { session, send, input, host, driver, writes } = fixture()
    context.mock.method(TranscriptRenderer.prototype, 'render', () => { throw new Error('拍扁渲染失败') })
    const run = session.run(async ui => { ui.result('完成') })
    const failed = assert.rejects(run, /拍扁渲染失败/)
    await turn()
    send('\r')
    await failed
    assert.equal(input.isRaw, false)
    assert.equal(driver.state, 'closed')
    assert.equal(host.listenerCount('uncaughtException'), 0)
    assert.equal(writes.filter(text => text === protocol.leave).length, 1)
})

test('完整示例经语义边界完成，所有控制台保留到拍扁退出', async () => {
    const { session, send, writes } = fixture()
    const run = session.run((ui, signal) => runDemo(ui, signal, async function*(selected) {
        for (const elapsed of [0, 1800, 10000]) yield preparationAt(selected, elapsed)
    }))
    await turn()
    send('\r')
    await turn()
    send('项目😀\r')
    await turn()
    send('\x1b[B\x1b[B \r')
    await turn()
    send('\r')
    assert.equal(await run, 0)
    const transcript = writes.at(-1) ?? ''
    assert.ok(transcript.startsWith('\r\n┌  Arrange CLI'))
    assert.ok(transcript.endsWith('Arrange 同步已完成\r\n\r\n'))
    assert.equal((transcript.match(/╭/g) ?? []).length, 3)
    for (const event of preparationAt(['ui', 'native-debug', 'native-release'], 10000)) for (const line of event.lines) assert.ok(transcript.includes(line))
})
