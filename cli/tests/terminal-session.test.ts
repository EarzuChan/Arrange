import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { CommanderError } from 'commander'
import { createCliApplication } from '../src/CliApplication.ts'
import { TerminalSession } from '../src/terminal/TerminalSession.ts'
import { TerminalDriver } from '../src/terminal/TerminalDriver.ts'
import { protocol } from '../src/terminal/Protocol.ts'
import { isCancel, text, select, multiselect } from '../src/terminal/Prompts.ts'
import { WorkPresenter } from '../src/business/WorkPresenter.ts'
import { Executor } from '../src/feature/platform/Executor.ts'
import { EmulatedTty } from './terminal-emulator.ts'

class Input extends EventEmitter {
    isTTY = true
    isRaw = false
    readableFlowing = false
    setRawMode(value: boolean): void { this.isRaw = value }
    resume(): void { this.readableFlowing = true }
    pause(): void { this.readableFlowing = false }
}
function fixture() {
    const input = new Input(), output = new EmulatedTty(80, 30), host = new EventEmitter()
    const driver = new TerminalDriver({ input, output, host, settleDelay: 0 })
    const session = new TerminalSession(driver)
    const send = (text: string) => input.emit('data', Buffer.from(text))
    return { session, input, output, host, driver, send }
}
async function until(test: () => boolean): Promise<void> {
    for (let count = 0; count < 200; count++) {
        if (test()) return
        await delay(10)
    }
    assert.fail('等待预期会话状态超时')
}

test('正式会话顺序提问、默认值与验证、任意选项值、多选和完成停屏共用完整历史', async () => {
    const { session, send, input, output, host } = fixture()
    const answers: unknown[] = []
    const running = session.run(async ui => {
        ui.reporter.intro('创建')
        assert.ok(Object.isFrozen(ui))
        answers.push(await select({ ...ui.prompt, message: '模板', options: [{ label: '空白', value: 1 }, { label: 'Vue', value: 2 }], initialValue: 2 }))
        answers.push(await text({ ...ui.prompt, message: '项目名', placeholder: '项目名占位', validate: value => value ? undefined : '必填' }))
        answers.push(await multiselect({ ...ui.prompt, message: '模块', options: [{ label: 'UI', value: 'ui' }, { label: 'Native', value: 'native' }], initialValues: ['ui'], required: true }))
        ui.reporter.outro('创建完成')
    })
    await delay(30)
    send('\r')
    await delay(30)
    send('\r')
    await delay(30)
    assert.match((await output.screen()).join('\n'), /必填/)
    send('\x1b[200~项目😀\x1b[201~\r')
    await delay(30)
    send('\x1b[B \r')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.deepEqual(answers, [2, '项目😀', ['ui', 'native']])
    let finished = false
    void running.then(() => { finished = true })
    await delay(20)
    assert.equal(finished, false)
    assert.match((await output.screen()).join('\n'), /按 Enter/)
    send('\r')
    assert.equal(await running, 0)
    assert.equal(input.isRaw, false)
    assert.equal(driverClosed(output), 1)
    const transcript = (await output.lines()).join('\n')
    assert.match(transcript, /◇  模板\n│  Vue/)
    assert.match(transcript, /项目😀/)
    assert.ok(!transcript.includes('按 Enter'))
    assert.equal(host.eventNames().length, 0)
    output.terminal.dispose()
})
function driverClosed(output: EmulatedTty): number { return output.written.filter(frame => frame === protocol.leave).length }

test('非零业务结果也统一停屏，按 Enter 后才恢复终端并保留原退出码', async () => {
    const { session, send, output, input } = fixture()
    let finished = false
    const running = session.run(async ui => {
        ui.reporter.info('Usage: arrange [options] [command]')
        return 7
    }).then(code => {
        finished = true
        return code
    })

    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.equal(finished, false)
    assert.equal(input.isRaw, true)
    send('\r')
    assert.equal(await running, 7)
    assert.equal(input.isRaw, false)
    assert.match((await output.lines()).join('\n'), /Usage: arrange/)
    output.terminal.dispose()
})

test('裸命令、命令组、各级帮助、版本与参数错误全部经过会话停屏', async t => {
    const cases = [
        { args: [], code: 1, text: /Usage: arrange/ },
        { args: ['storage'], code: 1, text: /Usage: arrange storage/ },
        { args: ['--help'], code: 0, text: /Usage: arrange/ },
        { args: ['help', 'sync'], code: 0, text: /Usage: arrange sync/ },
        { args: ['storage', '--help'], code: 0, text: /Usage: arrange storage/ },
        { args: ['--version'], code: 0, text: /1\.0\.0/ },
        { args: ['unknown-command'], code: 1, text: /unknown command/ },
        { args: ['sync', '--unknown-option'], code: 1, text: /unknown option/ },
        { args: ['storage', 'repair'], code: 1, text: /missing required argument/ }
    ]
    for (const entry of cases) await t.test(entry.args.join(' ') || 'arrange', { timeout: 5000 }, async t => {
        const { session, send, output, input } = fixture()
        let finished = false, released = false
        const running = session.run(async (ui, signal) => {
            const cli = createCliApplication({ signal, interactions: 'terminal', terminal: { ...ui, tasks: new WorkPresenter(ui.tasks, signal) } })
            try { await cli.parseAsync(['node', 'arrange', ...entry.args]) }
            catch (error) {
                if (error instanceof CommanderError) return error.exitCode
                throw error
            } finally { released = true }
            return cli.resultCode
        }).then(code => {
            finished = true
            return code
        })
        t.after(async () => {
            send('\x03')
            await running
            output.terminal.dispose()
        })
        await until(() => output.written.some(frame => frame.includes('按 Enter')))
        await delay(30)
        assert.equal(released, true)
        assert.equal(finished, false)
        assert.equal(input.isRaw, true)
        assert.equal(driverClosed(output), 0)
        send('x\x1b[5~\x1b[F')
        await delay(20)
        assert.equal(finished, false)
        send('\r')
        assert.equal(await running, entry.code)
        assert.equal(input.isRaw, false)
        assert.equal(driverClosed(output), 1)
        const transcript = (await output.lines()).join('\n')
        assert.match(transcript, entry.text)
        assert.ok(!transcript.includes('按 Enter'))
    })
})

test('业务异常先完成控制台收尾再停屏，失败快照可滚动且不误标成功', async t => {
    const { session, send, input, output } = fixture()
    let task: ReturnType<ReturnType<typeof session.ui.tasks.group>['task']> | undefined
    let released = false
    const running = session.run(async ui => {
        task = ui.tasks.group('异常批次').task('工具')
        task.start()
        task.console(Array.from({ length: 20 }, (_, index) => '错误前输出 ' + index).join('\r\n'))
        try { throw new Error('业务异常原因') }
        finally { released = true }
    })
    t.after(async () => {
        send('\x03')
        await running
        output.terminal.dispose()
    })
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.equal(released, true)
    assert.equal(input.isRaw, true)
    assert.equal(driverClosed(output), 0)
    assert.throws(() => task!.console('迟到输出'), /呈现已结束/)
    assert.match((await output.screen()).join('\n'), /╰─失败/)
    send('\x1b[<64;5;22M\x1b[5~\x1b[F')
    output.emit('resize')
    await delay(30)
    send('\r')
    assert.equal(await running, 1)
    const transcript = (await output.lines()).join('\n')
    assert.match(transcript, /业务异常原因/)
    assert.match(transcript, /错误前输出 0/)
    assert.match(transcript, /错误前输出 19/)
    assert.match(transcript, /异常批次 失败/)
    assert.ok(!transcript.includes('按 Enter'))
    assert.equal(driverClosed(output), 1)
})

test('鼠标回看和点击不夺取问题输入，PageUp 滚历史、Home End 编辑当前文本，resize 不闪退', async () => {
    const { session, send, output } = fixture()
    let answer: unknown
    const run = session.run(async ui => {
        for (let index = 0; index < 80; index++) ui.reporter.info('历史 ' + index)
        answer = await text({ ...ui.prompt, message: '末尾问题' })
    })
    await delay(30)
    send('\x1b[<64;1;1M\x1b[<0;1;1M\x1b[5~')
    send('AB\x1b[H中\x1b[F😀')
    for (const [columns, rows] of [[4, 2], [1, 1], [20, 7], [100, 40]]) {
        await output.resize(columns!, rows!)
        await delay(25)
    }
    send('\r')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.equal(answer, '中AB😀')
    send('\r')
    assert.equal(await run, 0)
    assert.match((await output.lines()).join('\n'), /历史 0/)
    output.terminal.dispose()
})

test('取消真实子进程先等待执行与输出收尾，再归还终端且仅拍扁一次', async () => {
    const { session, send, input, output } = fixture()
    let cleaned = false
    const run = session.run(async (ui, signal) => {
        const work = new WorkPresenter(ui.tasks)
        await work.run({ id: 'long', title: '真实进程' }, async task => {
            try {
                await new Executor(process.platform, signal).run(task.process({ command: process.execPath, args: ['-e', 'process.stdout.write("开始运行\\n");setInterval(()=>{},50)'] }))
            } finally { cleaned = true }
        })
    })
    await until(() => output.written.some(frame => frame.includes('开始运行')))
    send('\x03')
    assert.equal(input.isRaw, true)
    assert.equal(await run, 130)
    assert.equal(cleaned, true)
    assert.equal(input.isRaw, false)
    assert.equal(driverClosed(output), 1)
    assert.match((await output.lines()).join('\n'), /操作已取消/)
    output.terminal.dispose()
})

test('全局异常保留原始失败而非取消，并清理提问、帧调度与监听', async () => {
    const { session, input, output, host } = fixture()
    const running = session.run(async ui => { assert.ok(isCancel(await text({ ...ui.prompt, message: '等待' }))) })
    await delay(30)
    host.emit('uncaughtException', new Error('原始异常'))
    assert.equal(await running, 1)
    assert.equal(input.isRaw, false)
    assert.equal(driverClosed(output), 1)
    const transcript = (await output.lines()).join('\n')
    assert.match(transcript, /原始异常/)
    assert.ok(!transcript.includes('└  操作已取消'))
    assert.deepEqual(host.eventNames(), [])
    output.terminal.dispose()
})

test('当前问题和任务批次不能被后续活跃交互越过，完成框保留至退出', async () => {
    const { session, send, output } = fixture()
    const running = session.run(async ui => {
        const pending = text({ ...ui.prompt, message: '当前问题' })
        assert.throws(() => ui.reporter.info('越过'), /回答/)
        assert.throws(() => ui.tasks.group('越过'), /活跃交互/)
        await pending
        const group = ui.tasks.group('当前批次')
        const task = group.task('工具')
        task.start()
        task.console('完整内容\r\n')
        ui.reporter.info('等待共享资源')
        assert.throws(() => ui.tasks.group('下一批'), /活跃交互/)
        await task.finish('done')
        group.complete()
    })
    await delay(30)
    send('\r')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.match((await output.screen()).join('\n'), /╰─已完成/)
    send('\r')
    assert.equal(await running, 0)
    assert.match((await output.lines()).join('\n'), /完整内容/)
    const transcript = (await output.lines()).join('\n')
    assert.ok(transcript.indexOf('等待共享资源') < transcript.indexOf('✓ 工具'), '等待消息保留在同一批次内，不追加到活跃任务之后')
    output.terminal.dispose()
})
