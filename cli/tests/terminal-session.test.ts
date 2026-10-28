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
import { commandInterface } from '../src/business/CommandInterface.ts'
import { cancelled } from '../src/terminal/PromptController.ts'
import { Executor } from '../src/feature/platform/Executor.ts'
import { EmulatedTty } from './terminal-emulator.ts'
import { registerDevCommand } from '../src/business/command/Dev.ts'
import { ApplicationCommand } from '../src/business/ApplicationCommand.ts'
import { cliVersion } from '../src/CliMetadata.ts'

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
        ui.reporter.info('创建')
        assert.ok(Object.isFrozen(ui))
        answers.push(await select({ ...ui.prompt, message: '模板', options: [{ label: '空白', value: 1 }, { label: 'Vue', value: 2 }], initialValue: 2 }))
        answers.push(await text({ ...ui.prompt, message: '项目名', placeholder: '项目名占位', validate: value => value ? undefined : '必填' }))
        answers.push(await multiselect({ ...ui.prompt, message: '模块', options: [{ label: 'UI', value: 'ui' }, { label: 'Native', value: 'native' }], initialValues: ['ui'], required: true }))
        ui.reporter.success('创建完成')
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

test('空输入采用生成默认值时答案显示默认值，业务仍收到空值', async () => {
    const { session, send, output } = fixture()
    let answer: unknown
    const running = session.run(async ui => {
        answer = await text({ ...ui.prompt, message: '产品名称', placeholder: 'MyProject', emptyAnswer: 'MyProject' })
    })
    await until(() => output.written.some(frame => frame.includes('产品名称')))
    send('\r')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.equal(answer, '')
    send('\r')
    assert.equal(await running, 0)
    assert.match((await output.lines()).join('\n'), /◇  产品名称\n│  MyProject/)
    output.terminal.dispose()
})
function driverClosed(output: EmulatedTty): number { return output.written.filter(frame => frame === protocol.leave).length }

test('普通消息色调不改变实际结果码和停屏状态', async t => {
    const { session, send, output, host } = fixture()
    const running = session.run(async ui => {
        ui.reporter.warn('提醒信息')
        ui.reporter.error('已处理的错误说明')
        return 0
    })
    t.after(async () => {
        host.emit('SIGTERM')
        await running
        output.terminal.dispose()
    })
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    send('\r')
    assert.equal(await running, 0)
    const transcript = (await output.lines()).join('\n')
    assert.match(transcript, /┌  提醒信息/)
    assert.match(transcript, /└  已处理的错误说明/)
    assert.ok(!transcript.includes('已取消操作'))
})

test('显式正常结束作用域只请求阶段停止并保留就绪提示到收尾', async t => {
    const { session, send, output, host } = fixture()
    let allowRunning!: () => void
    const runningGate = new Promise<void>(resolve => { allowRunning = resolve })
    const run = session.run(async ui => {
        const result = await ui.stoppable('开发会话运行中 · Ctrl+C / Esc 结束开发', async control => {
            return new Promise<0>(resolve => {
                allowRunning()
                const stopping = () => { resolve(0) }
                control.enable()
                control.signal.addEventListener('abort', stopping, { once: true })
            })
        })
        ui.reporter.success('开发会话已结束')
        return result
    })
    t.after(async () => {
        host.emit('SIGTERM')
        await run
        output.terminal.dispose()
    })
    await runningGate
    await until(() => output.written.some(frame => frame.includes('Ctrl+C / Esc 结束开发')))
    assert.equal(session.signal.aborted, false)
    send('\x1b')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.equal(session.signal.aborted, false)
    assert.ok(!((await output.screen()).join('\n')).includes('Ctrl+C / Esc'))
    send('\r')
    assert.equal(await run, 0)
    assert.match((await output.lines()).join('\n'), /开发会话已结束/)
})

test('dev 命令收到服务就绪回调后提示正常停止，Esc 收尾为开发会话已结束', async t => {
    const { session, send, output, host } = fixture()
    let onStarted!: () => void
    const started = new Promise<void>(resolve => { onStarted = resolve })
    const running = session.run(async (ui, signal) => {
        const cli = new ApplicationCommand({ close: async () => { } }).exitOverride()
        registerDevCommand(cli, {
            run: async (_root, options) => {
                onStarted()
                options.onRunning?.()
                await new Promise<void>(resolve => options.stopSignal!.addEventListener('abort', () => resolve(), { once: true }))
                options.onStopping?.()
                return { kind: 'ended', reason: 'user' }
            }
        }, signal, commandInterface(ui, signal))
        await cli.parseAsync(['node', 'arrange', 'dev'])
        return cli.resultCode
    })
    t.after(async () => {
        host.emit('SIGTERM')
        await running
        output.terminal.dispose()
    })
    await started
    await until(() => output.written.some(frame => frame.includes('Ctrl+C / Esc 结束开发')))
    assert.equal(session.signal.aborted, false)
    send('\x1b')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    const screen = (await output.screen()).join('\n')
    assert.match(screen, /开发会话已结束/)
    assert.doesNotMatch(screen, /开发会话已取消|已取消操作/)
    assert.equal(session.signal.aborted, false)
    send('\r')
    assert.equal(await running, 0)
})

for (const outcome of ['正常结束', '取消返回零', '取消返回130', '取消异常', '取消清理失败'] as const) test(`dev ${outcome}只呈现一个最终结果及一条尾线`, async t => {
    const { session, send, output, host } = fixture()
    let ready!: () => void
    const started = new Promise<void>(resolve => { ready = resolve })
    const running = session.run(async (ui, signal) => {
        const command = new ApplicationCommand({ close: async () => { } }).exitOverride()
        registerDevCommand(command, {
            run: async () => {
                ready()
                if (outcome === '正常结束') return { kind: 'ended', reason: 'process' }
                await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
                if (outcome === '取消异常') throw signal.reason
                if (outcome === '取消清理失败') throw new Error('开发资源清理失败')
                return { kind: 'cancelled' }
            }
        }, signal, commandInterface(ui, signal))
        await command.parseAsync(['node', 'arrange', 'dev'])
        return command.resultCode
    })
    t.after(async () => {
        host.emit('SIGTERM')
        await running
        output.terminal.dispose()
    })
    await started
    if (outcome !== '正常结束') send('\x03')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    const expected = outcome === '正常结束' ? '开发会话已结束' : outcome === '取消清理失败' ? '开发资源清理失败' : '开发会话已取消'
    const screen = (await output.screen()).join('\n')
    assert.match(screen, new RegExp('└  ' + expected))
    assert.equal(screen.split('\n').filter(line => line.startsWith('└')).length, 1)
    send('\r')
    assert.equal(await running, outcome === '正常结束' ? 0 : outcome === '取消清理失败' ? 1 : 130)
    const transcript = (await output.lines()).join('\n')
    assert.equal(transcript.split('\n').filter(line => line.startsWith('└')).length, 1)
    assert.ok(!transcript.includes('已取消操作'))
    assert.equal(transcript.split(expected).length - 1, 1)
})

test('替换包含问题的区块撤销旧输入目标，旧代写入拒绝，新问题与拍扁保持一致', async () => {
    const { session, send, output } = fixture()
    const running = session.run(async ui => {
        ui.reporter.info('替换流程')
        const region = ui.region()
        const old = region.current
        const question = text({ ...old.prompt, message: '旧问题' })
        const current = region.replace()
        assert.equal(await question, cancelled)
        assert.throws(() => old.reporter.info('旧异步消息'), /替换或结束/)
        const answer = await text({ ...current.prompt, message: '新问题' })
        region.complete({ question: '最终答案', answer: String(answer) })
        ui.reporter.success('流程完成')
    })
    await until(() => output.written.some(frame => frame.includes('新问题')))
    send('最终值\r')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    await output.resize(28, 12)
    send('\x1b[5~\x1b[6~')
    await delay(30)
    assert.doesNotMatch((await output.screen()).join('\n'), /旧问题|新问题|旧异步消息/)
    send('\r')
    assert.equal(await running, 0)
    const transcript = (await output.lines()).join('\n')
    assert.match(transcript, /最终答案[\s\S]*最终值/)
    assert.doesNotMatch(transcript, /旧问题|新问题|旧异步消息/)
    output.terminal.dispose()
})

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
        { args: ['--version'], code: 0, text: new RegExp(cliVersion.replaceAll('.', '\\.')) },
        { args: ['unknown-command'], code: 1, text: /unknown command/ },
        { args: ['sync', '--unknown-option'], code: 1, text: /unknown option/ },
        { args: ['storage', 'repair'], code: 1, text: /missing required argument/ }
    ]
    for (const entry of cases) await t.test(entry.args.join(' ') || 'arrange', { timeout: 5000 }, async t => {
        const { session, send, output, input, host } = fixture()
        let finished = false, released = false
        const running = session.run(async (ui, signal) => {
            const cli = createCliApplication({ signal, interactions: 'terminal', terminal: commandInterface(ui, signal) })
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
            host.emit('SIGTERM')
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
        send('\r')
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

for (const key of ['\x03', '\x1b']) test(`${key === '\x03' ? 'Ctrl+C' : 'Esc'} 取消真实子进程后停屏，完成清理并按 Enter 才拍扁`, async () => {
    const { session, send, input, output } = fixture()
    let cleaned = false
    let finished = false
    const run = session.run(async (ui, signal) => {
        const work = new WorkPresenter(ui.tasks, signal)
        await work.run({ id: 'long', title: '真实进程' }, async task => {
            try {
                await new Executor(process.platform, signal).run(task.process({ command: process.execPath, args: ['-e', 'process.stdout.write("开始运行\\n");setInterval(()=>{},50)'] }))
            } finally { cleaned = true }
        })
    }).then(code => {
        finished = true
        return code
    })
    await until(() => output.written.some(frame => frame.includes('开始运行')))
    send(key)
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.equal(input.isRaw, true)
    assert.equal(cleaned, true)
    assert.equal(finished, false)
    assert.equal(driverClosed(output), 0)
    assert.match((await output.screen()).join('\n'), /已取消操作/)
    send('\x03')
    await delay(60)
    send('\x1b')
    await delay(60)
    assert.equal(finished, false)
    send('\r')
    assert.equal(await run, 130)
    assert.equal(input.isRaw, false)
    assert.equal(driverClosed(output), 1)
    assert.match((await output.lines()).join('\n'), /已取消操作/)
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
    assert.ok(!transcript.includes('└  已取消操作'))
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

for (const key of ['\x03', '\x1b']) test(`${key === '\x03' ? 'Ctrl+C' : 'Esc'} 取消创建问题保留业务收尾，只在回车后退出`, async () => {
    const { session, send, input, output, host } = fixture()
    let finished = false
    const running = session.run(async (ui, signal) => {
        const cli = createCliApplication({ signal, interactions: 'terminal', terminal: commandInterface(ui, signal) })
        await cli.parseAsync(['create'], { from: 'user' })
        return cli.resultCode
    }).then(code => {
        finished = true
        return code
    })
    await until(() => output.written.some(frame => frame.includes('项目名称')))
    send(key)
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.equal(session.signal.aborted, true)
    assert.equal(finished, false)
    assert.equal(input.isRaw, true)
    assert.equal(driverClosed(output), 0)
    const screen = (await output.screen()).join('\n')
    assert.match(screen, /已取消创建；未写工程文件/)
    assert.ok(!screen.includes('已取消操作'))
    send('x\x03')
    send('\x1b')
    output.emit('resize')
    await delay(70)
    assert.equal(finished, false)
    send('\r')
    assert.equal(await running, 130)
    assert.equal(driverClosed(output), 1)
    assert.equal(input.isRaw, false)
    const transcript = (await output.lines()).join('\n')
    assert.equal(transcript.match(/已取消创建；未写工程文件/g)?.length, 1)
    assert.ok(!transcript.includes('按 Enter'))
    assert.deepEqual(host.eventNames(), [])
    output.terminal.dispose()
})

test('已完成的停屏不被 Ctrl+C 或 Esc 改写，原结果仍由 Enter 确认', async () => {
    const { session, send, output, input } = fixture()
    let finished = false
    const running = session.run(async ui => {
        ui.reporter.error('原始业务结果')
        return 7
    }).then(code => {
        finished = true
        return code
    })
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    send('\x03')
    send('\x1b')
    await delay(70)
    assert.equal(finished, false)
    assert.equal(input.isRaw, true)
    assert.equal(session.signal.aborted, false)
    send('\r')
    assert.equal(await running, 7)
    const transcript = (await output.lines()).join('\n')
    assert.match(transcript, /原始业务结果/)
    assert.ok(!transcript.includes('已取消操作'))
    output.terminal.dispose()
})

test('取消清理期间的 Enter 不越过收尾，清理失败保留原始原因并停屏', async () => {
    const { session, send, output, input } = fixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = session.run(async (_ui, signal) => {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        await gate
        throw new AggregateError([signal.reason, new Error('资源清理失败')], '取消时资源清理失败')
    })
    send('\x03\r')
    await delay(30)
    assert.equal(input.isRaw, true)
    assert.equal(driverClosed(output), 0)
    assert.ok(!output.written.some(frame => frame.includes('按 Enter')))
    release()
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.match((await output.screen()).join('\n'), /取消时资源清理失败/)
    send('\r')
    assert.equal(await running, 1)
    assert.equal(driverClosed(output), 1)
    output.terminal.dispose()
})

test('外部终止信号在停屏中仍可靠恢复，不要求无法到达的用户输入', async () => {
    const { session, output, input, host } = fixture()
    const running = session.run(async ui => { ui.reporter.success('已完成') })
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    host.emit('SIGTERM')
    await running
    assert.equal(input.isRaw, false)
    assert.equal(driverClosed(output), 1)
    assert.deepEqual(host.eventNames(), [])
    output.terminal.dispose()
})

test('开发进程返回取消码时仍以已取消收尾，等待回车且不误判失败', async () => {
    const { session, send, output } = fixture()
    const running = session.run(async (_ui, signal) => {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        return 130
    })
    send('\x03')
    await until(() => output.written.some(frame => frame.includes('按 Enter')))
    assert.match((await output.screen()).join('\n'), /已取消操作/)
    assert.equal(driverClosed(output), 0)
    send('\r')
    assert.equal(await running, 130)
    output.terminal.dispose()
})
