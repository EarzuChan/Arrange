import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Executor } from "../src/feature/platform/Executor.ts"
import { stripAnsi } from "../src/util/TerminalText.ts"
import { TaskFailures, type TaskOutput } from "../src/feature/operation/Work.ts"
import { quietTerminal } from "./fixture.ts"
import { setTimeout as sleep } from "node:timers/promises"
import { TaskController } from '../src/terminal/TaskController.ts'
import { SessionDocument } from '../src/terminal/SessionDocument.ts'
import { WorkPresenter } from '../src/business/WorkPresenter.ts'
import { TaskLogFile, recordAllTaskLogs } from '../src/feature/operation/WorkLog.ts'
import { TranscriptRenderer } from '../src/terminal/TranscriptRenderer.ts'

test("并行任务保留等待收尾和失败汇总语义，完整输出在关闭时拍平", async () => {
    const terminal = quietTerminal()
    let complete = 0
    const result = await terminal.tasks.all([
        {
            spec: { id: "a", title: "任务 A" }, run: async task => {
                task.line("A 输出")
                throw new Error("A 出错")
            }
        },
        {
            spec: { id: "b", title: "任务 B" }, run: async task => {
                task.line("B 输出")
                await sleep(10)
                complete++
                return 2
            }
        },
    ]).then(() => undefined, error => error)
    assert.ok(result instanceof TaskFailures)
    assert.equal(complete, 1)
    await terminal.close()
    const output = stripAnsi(terminal.output.text)
    assert.match(output, /A 输出/)
    assert.match(output, /B 输出/)
    assert.match(output, /A 出错/)
    assert.match(output, /任务 B · 已完成/)
})

test("成功子进程保留 ANSI、回车和 stderr 输出，运行与完成后都不创建日志", async t => {
    const root = await mkdtemp(join(tmpdir(), "arrange-task-log-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const terminal = quietTerminal()
    const script = "process.stdout.write('building 10%\\r\\x1b[2Kbuilding 80%\\r\\n\\x1b[32mok\\x1b[0m\\r\\n');process.stderr.write('error line\\n')"
    await terminal.tasks.run({ id: "build", title: "构建", rootDir: root }, async (task: TaskOutput) => {
        const result = await new Executor().run(task.process({ command: process.execPath, args: ["-e", script] }))
        assert.equal(result.exitCode, 0)
        assert.equal(result.stdout, "")
        await assert.rejects(readdir(join(root, '.arrange', 'logs')), { code: 'ENOENT' })
    })
    await terminal.close()
    const output = stripAnsi(terminal.output.text)
    assert.match(output, /building 80%/)
    assert.match(output, /ok/)
    assert.match(output, /error line/)
    assert.doesNotMatch(output, /完整日志|已记录到|正在记录/)
    await assert.rejects(readdir(join(root, '.arrange', 'logs')), { code: 'ENOENT' })
})

test('非成功子控制台结束后才保存全部 stdout、stderr、尾行与失败原因并发布路径', async t => {
    const root = await mkdtemp(join(tmpdir(), 'arrange-task-failed-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const document = new SessionDocument()
    const tasks = new WorkPresenter(new TaskController(document, () => { }))
    const script = "process.stdout.write('开始\\n\\x1b[32m彩色内容\\x1b[0m\\n');process.stderr.write('错误尾行');process.exitCode=7"
    await assert.rejects(tasks.run({ id: 'failed', title: '失败工具', rootDir: root }, async task => {
        const result = await new Executor().run(task.process({ command: process.execPath, args: ['-e', script] }))
        assert.equal(result.exitCode, 7)
        assert.equal(document.entries[0]!.type, 'batch')
        if (document.entries[0]!.type === 'batch') assert.equal(document.entries[0]!.tasks[0]!.logPath, undefined)
        await assert.rejects(readdir(join(root, '.arrange', 'logs')), { code: 'ENOENT' })
        throw new Error('工具退出码 7')
    }), /工具退出码 7/)
    const batch = document.entries[0]!
    assert.equal(batch.type, 'batch')
    if (batch.type !== 'batch') return
    assert.equal(batch.tasks[0]!.state, 'failed')
    assert.ok(batch.tasks[0]!.logPath)
    assert.match(new TranscriptRenderer().render(document), /已记录到 .*failed\.log/)
    const dirs = await readdir(join(root, '.arrange', 'logs'))
    const saved = await readFile(join(root, '.arrange', 'logs', dirs[0]!, 'failed.log'), 'utf8')
    assert.match(saved, /开始/)
    assert.match(saved, /彩色内容/)
    assert.match(saved, /错误尾行/)
    assert.match(saved, /工具退出码 7/)
    assert.ok(!saved.includes(String.fromCharCode(27)))
})

test('开发进程仅实际失败保存日志，正常停止和取消不保存且收尾幂等', async t => {
    const root = await mkdtemp(join(tmpdir(), 'arrange-process-logs-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const abort = new AbortController()
    const document = new SessionDocument()
    const tasks = new WorkPresenter(new TaskController(document, () => { }), abort.signal)
    const processes = tasks.processes()
    const success = await processes.open({ id: 'success', title: '成功', rootDir: root })
    const failed = await processes.open({ id: 'failed', title: '失败', rootDir: root })
    const stopped = await processes.open({ id: 'stopped', title: '停止', rootDir: root })
    const cancelled = await processes.open({ id: 'cancelled', title: '取消', rootDir: root })
    for (const task of [success, failed, stopped, cancelled]) task.line(task.title + '输出')
    await success.finish({ kind: 'exited', message: '已退出' })
    await assert.rejects(readdir(join(root, '.arrange', 'logs')), { code: 'ENOENT' })
    await failed.finish({ kind: 'failed', message: '退出码 3' })
    await stopped.finish({ kind: 'stopped', reason: 'companion' })
    abort.abort()
    await processes.close({ kind: 'cancelled' })
    await failed.finish({ kind: 'failed', message: '不得重复' })
    const dirs = await readdir(join(root, '.arrange', 'logs'))
    assert.equal(dirs.length, 1)
    const directory = join(root, '.arrange', 'logs', dirs[0]!)
    assert.deepEqual((await readdir(directory)).sort(), ['failed.log'])
    const text = await readFile(join(directory, 'failed.log'), 'utf8')
    assert.equal(text.match(/失败输出/g)?.length, 1)
    assert.doesNotMatch(text, /不得重复/)
    const batch = document.entries[0]!
    if (batch.type !== 'batch') return assert.fail('缺少任务批次')
    assert.equal(batch.tasks[0]!.logPath, undefined)
    assert.deepEqual(batch.tasks.map(task => task.state), ['done', 'failed', 'stopped', 'cancelled'])
    assert.ok(batch.tasks[1]!.logPath)
    assert.ok(batch.tasks.slice(2).every(task => !task.logPath))
})

test('普通任务没有子控制台时即使失败也不生成空日志，保存失败不谎报路径或覆盖原始错误', async t => {
    const root = await mkdtemp(join(tmpdir(), 'arrange-log-write-failure-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const document = new SessionDocument()
    const tasks = new WorkPresenter(new TaskController(document, () => { }))
    await assert.rejects(tasks.run({ id: 'plain', title: '普通任务', rootDir: root }, async () => { throw new Error('普通失败') }), /普通失败/)
    await assert.rejects(readdir(join(root, '.arrange', 'logs')), { code: 'ENOENT' })
    await writeFile(join(root, '.arrange'), '阻止创建目录')
    await assert.rejects(tasks.run({ id: 'failed', title: '控制台任务', rootDir: root }, async task => {
        task.line('保留在屏幕中的输出')
        throw new Error('原始业务失败')
    }), error => {
        assert.ok(error instanceof AggregateError)
        assert.match(error.message, /原始业务失败/)
        assert.equal(error.errors.length, 2)
        return true
    })
    const batch = document.entries[1]!
    if (batch.type !== 'batch') return assert.fail('缺少任务批次')
    assert.equal(batch.tasks[0]!.logPath, undefined)
    assert.match(batch.tasks[0]!.console!.lines.join('\n'), /保留在屏幕中的输出/)
})

test('常记录代码开关默认关闭，日志收尾幂等并释放成功任务的暂存内容', async () => {
    assert.equal(recordAllTaskLogs, false)
    let saved = ''
    const success = new TaskLogFile(async text => {
        saved = text
        return 'success.log'
    })
    success.write('无需保存')
    assert.equal(await success.close(false), undefined)
    assert.equal(saved, '')
    assert.equal(await success.close(true), undefined)
    assert.throws(() => success.write('迟到输出'), /日志已结束/)
    const failure = new TaskLogFile(async text => {
        saved = text
        return 'failed.log'
    })
    failure.write('完整失败输出')
    assert.equal(await failure.close(true), 'failed.log')
    assert.equal(saved, '完整失败输出\n')
    assert.equal(await failure.close(true), 'failed.log')
})

test("一次命令拍平 Reporter 和任务历史，只在关闭后回写系统终端", async () => {
    const terminal = quietTerminal()
    terminal.reporter.info("命令标题")
    assert.equal(terminal.output.text, "")
    terminal.reporter.success("完成")
    await terminal.close()
    assert.match(terminal.output.text, /命令标题/)
    assert.match(terminal.output.text, /完成/)
})

test('开发进程独立完成并释放解析资源，批次未结束仍保留完成荧幕', async () => {
    const terminal = quietTerminal()
    const processes = terminal.tasks.processes()
    const first = await processes.open({ id: 'one', title: '第一个进程' })
    const second = await processes.open({ id: 'two', title: '第二个进程' })
    first.line('第一份输出')
    second.line('第二份输出')
    await first.finish({ kind: 'exited', message: '已退出' })
    assert.throws(() => first.line('不得继续写入'), /结束/)
    second.line('继续运行')
    await second.finish({ kind: 'failed', message: '退出码 7' })
    await processes.close({ kind: 'stopped', reason: 'companion' })
    await terminal.close()
    assert.match(terminal.output.text, /第一份输出/)
    assert.match(terminal.output.text, /继续运行/)
    assert.match(terminal.output.text, /╰─已完成/)
    assert.match(terminal.output.text, /退出码 7/)
})
