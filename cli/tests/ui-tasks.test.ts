import { symbols } from "../src/ui/Theme.ts"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { Executor } from "../src/platform/Executor.ts"
import { stripAnsi } from "../src/ui/Ansi.ts"
import type { BoardTask } from "../src/ui/TaskBoard.ts"
import { createTerminal } from "../src/ui/Terminal.ts"
import { ninjaProgress, TaskFailures, type TaskOutput } from "../src/ui/Tasks.ts"
import { quietTerminal } from "./fixture.ts"
import { EmulatedTty } from "./terminal-emulator.ts"
import { TaskLogRun } from "../src/ui/TaskLog.ts"

function gate() {
    let open: () => void = () => { }
    const promise = new Promise<void>(resolve => { open = resolve })
    return { promise, open }
}

test("并行任务：一个失败时其余跑完，最后一起报告失败；成功与失败都写进滚动历史", async () => {
    const terminal = quietTerminal()
    const release = gate()
    const started: string[] = []
    const finished: string[] = []
    const work = (name: string, fail = false) => async (task: TaskOutput) => {
        started.push(name)
        if (started.length === 3) release.open()
        task.line(`${name} 输出`)
        await release.promise
        if (fail) throw new Error(`${name} 出错`)
        finished.push(name)
        return name
    }
    const error = await terminal.tasks.all([
        { spec: { id: "a", title: "任务 A" }, run: work("A", true) },
        { spec: { id: "b", title: "任务 B" }, run: work("B") },
        { spec: { id: "c", title: "任务 C" }, run: work("C") },
    ]).then(() => undefined, error => error)
    assert.ok(error instanceof TaskFailures)
    assert.deepEqual(error.failures.map(failure => failure.title), ["任务 A"])
    assert.equal(error.message, "任务 A：A 出错")
    assert.deepEqual(finished.sort(), ["B", "C"])
    const output = terminal.output.text
    assert.match(output, /[◇o]  任务 B/)
    assert.match(output, /[◇o]  任务 C/)
    assert.match(output, /[■x]  任务 A 失败/)
    assert.match(output, /[│|]  A 出错/)
    assert.match(output, /[│|] A 输出/)
})

test("全部成功时按输入顺序返回结果；单个任务失败时原样抛出原错误", async () => {
    const terminal = quietTerminal()
    assert.deepEqual(await terminal.tasks.all([
        {
            spec: { id: "slow", title: "慢" }, run: async () => {
                await sleep(30)
                return 1
            }
        },
        { spec: { id: "fast", title: "快" }, run: async () => 2 },
    ]), [1, 2])
    const original = new Error("原始错误")
    await assert.rejects(terminal.tasks.run({ id: "x", title: "X" }, async () => { throw original }), error => error === original)
})

test("任一任务被取消时整体以取消结束（不当作失败），其余任务照常收尾", async () => {
    const terminal = quietTerminal()
    const cancellation = new DOMException("操作已取消", "AbortError")
    let otherDone = false
    await assert.rejects(terminal.tasks.all([
        { spec: { id: "a", title: "A" }, run: async () => { throw cancellation } },
        {
            spec: { id: "b", title: "B" }, run: async () => {
                await sleep(20)
                otherDone = true
            }
        },
    ]), error => error === cancellation)
    assert.equal(otherDone, true)
    assert.match(terminal.output.text, /[■x]  A 已取消/)
})

test("任务日志写入工程 .arrange/logs/<运行>/<任务>.log（去掉颜色），只保留最近 20 次运行", async t => {
    const root = await mkdtemp(join(tmpdir(), "arrange-task-log-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const logs = join(root, ".arrange", "logs")
    for (let index = 0; index < 25; index++) await mkdir(join(logs, `20000101-0000${String(index).padStart(2, "0")}-000`), { recursive: true })
    const terminal = quietTerminal()
    await assert.rejects(terminal.tasks.run({ id: "configure native/debug", title: "配置", rootDir: root }, async task => {
        task.line("\x1b[31merror\x1b[0m: 失败原因")
        throw new Error("CMake configure 未成功（1）")
    }))
    const runs = (await readdir(logs)).sort()
    assert.equal(runs.length, 20)
    assert.ok(!runs.includes("20000101-000000-000"), "最旧的运行被清理")
    const latest = runs.at(-1)!
    assert.deepEqual(await readdir(join(logs, latest)), ["configure-native-debug.log"])
    assert.equal(await readFile(join(logs, latest, "configure-native-debug.log"), "utf8"), "error: 失败原因\n")
    assert.match(terminal.output.text, /完整日志：.*configure-native-debug\.log/)
})

test("并发日志运行身份独立，清理不删除存活 CLI 的日志", async t => {
    const root = await mkdtemp(join(tmpdir(), "arrange-concurrent-log-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const logs = join(root, ".arrange", "logs")
    const active = `20000101-000000-000-${process.pid}-active`
    await mkdir(join(logs, active), { recursive: true })
    for (let index = 1; index < 25; index++) await mkdir(join(logs, `20000101-0000${String(index).padStart(2, "0")}-000`), { recursive: true })
    const [first, second] = await Promise.all([new TaskLogRun().open(root, "task"), new TaskLogRun().open(root, "task")])
    assert.notEqual(first.path, second.path)
    first.write("first")
    second.write("second")
    await Promise.all([first.close(), second.close()])
    assert.equal(await readFile(first.path, "utf8"), "first\n")
    assert.equal(await readFile(second.path, "utf8"), "second\n")
    assert.ok((await readdir(logs)).includes(active))
})

test("子进程输出经任务逐行接收：保留颜色、拆块的多字节字符、回车刷新、标准错误与结尾无换行的行", async () => {
    const terminal = quietTerminal()
    let recorded: BoardTask | undefined
    const script = [
        "process.stdout.write('\\x1b[32m绿色\\x1b[0m\\r\\n')",
        "const bytes=Buffer.from('拆开的字符\\n'); process.stdout.write(bytes.subarray(0,4)); setTimeout(()=>{process.stdout.write(bytes.subarray(4))",
        "process.stdout.write('10%\\r50%\\r100%\\n'); process.stderr.write('[1/3] 第一步\\n[3/3] 最后\\n'); process.stdout.write('没有换行')},50)",
    ].join(";")
    await terminal.tasks.run({ id: "child", title: "子进程" }, async task => {
        recorded = (task as unknown as { task: BoardTask }).task
        const result = await new Executor().run(task.process({ command: process.execPath, args: ["-e", script] }, ninjaProgress))
        assert.equal(result.exitCode, 0)
        assert.equal(result.stdout, "", "长任务不在结果里累积输出")
    })
    const lines = recorded!.buffer.tail(10)
    assert.equal(lines[0], "\x1b[32m绿色\x1b[0m")
    assert.deepEqual(lines.slice(1).map(stripAnsi).sort(), ["100%", "[1/3] 第一步", "[3/3] 最后", "拆开的字符", "没有换行"].sort())
    assert.deepEqual(recorded!.progress, { done: 3, total: 3 })
})

class EmulatedStdin extends EventEmitter {
    readonly isTTY = true
    raw = false
    setRawMode(mode: boolean): this {
        this.raw = mode
        return this
    }
    resume(): this { return this }
    pause(): this { return this }
}

test("实时会话（xterm 模拟终端）：任务框绘制在屏幕上，滚轮按真实光标位置命中对应的框；结束后只留摘要并恢复终端", async () => {
    const tty = new EmulatedTty(80, 40)
    const stdin = new EmulatedStdin()
    // 终端对光标位置查询的应答经输入流回到程序
    tty.terminal.onData(data => stdin.emit("data", Buffer.from(data)))
    const terminal = createTerminal({ out: tty, err: tty, input: stdin as unknown as NodeJS.ReadStream })
    terminal.reporter.intro("arrange sync")
    const release = gate()
    const tasks: BoardTask[] = []
    const work = (prefix: string) => async (task: TaskOutput) => {
        tasks.push((task as unknown as { task: BoardTask }).task)
        for (let index = 0; index < 30; index++) task.line(`${prefix}-line-${index}`)
        await release.promise
    }
    const running = terminal.tasks.all([
        { spec: { id: "ui", title: "安装 UI 依赖" }, run: work("UI") },
        { spec: { id: "native", title: "配置 native · debug" }, run: work("NATIVE") },
    ])
    await sleep(200)
    assert.equal(stdin.raw, true)
    const screen = await tty.screen()
    assert.ok(screen.some(line => line.includes("安装 UI 依赖")))
    assert.ok(screen.some(line => line.includes("UI-line-29")))
    const nativeRow = screen.findIndex(line => line.includes("NATIVE-line-29"))
    assert.ok(nativeRow > 0)
    stdin.emit("data", Buffer.from(`\x1b[<64;10;${nativeRow + 1}M`))
    await sleep(100)
    const native = tasks.find(task => task.id === "native")!
    const ui = tasks.find(task => task.id === "ui")!
    assert.equal(native.viewport.following, false, "滚轮命中 native 框")
    assert.equal(ui.viewport.following, true)
    assert.ok((await tty.screen()).some(line => line.includes(`${symbols.arrowDown} 3 行 · End 跟随`)))
    release.open()
    await running
    terminal.reporter.outro("同步完成")
    const lines = await tty.lines()
    assert.equal(lines[0], `${symbols.barStart}  arrange sync`)
    assert.ok(lines.some(line => /^[◇o]  安装 UI 依赖/.test(line)))
    assert.ok(lines.some(line => /^[◇o]  配置 native · debug/.test(line)))
    assert.ok(!lines.some(line => line.includes(symbols.cornerTopLeft) || line.includes("-line-")), `不残留任务框：${lines.join("\n")}`)
    assert.equal(lines.at(-1), `${symbols.barEnd}  同步完成`)
    // 原始模式保持到终端关闭（进程退出前），期间不来回切换
    assert.equal(stdin.raw, true)
    terminal.close()
    assert.equal(stdin.raw, false)
    const written = tty.written.join("")
    assert.ok(written.lastIndexOf("\x1b[?1000l") > written.lastIndexOf("\x1b[?1000h"), "关闭鼠标上报")
    assert.ok(written.lastIndexOf("\x1b[?25h") > written.lastIndexOf("\x1b[?25l"), "恢复光标")
})

test("只有临时状态行时不接管鼠标与输入；出现任务框才开启，任务框都结束后关闭", async () => {
    const tty = new EmulatedTty(80, 30)
    const stdin = new EmulatedStdin()
    const terminal = createTerminal({ out: tty, err: tty, input: stdin as unknown as NodeJS.ReadStream })
    const mouseOn = (): number => tty.written.join("").split("\x1b[?1000h").length - 1
    await terminal.tasks.status("检查", async () => {
        await sleep(50)
        assert.equal(mouseOn(), 0)
        assert.equal(stdin.raw, false)
    })
    await terminal.tasks.run({ id: "framed", title: "带框任务" }, async task => {
        task.line("输出")
        await sleep(50)
        assert.equal(mouseOn(), 1)
        assert.equal(stdin.raw, true)
    })
    const written = tty.written.join("")
    assert.ok(written.lastIndexOf("\x1b[?1000l") > written.lastIndexOf("\x1b[?1000h"))
    terminal.close()
})
