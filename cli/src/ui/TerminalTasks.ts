import { isAbortError, type ProcessSpec } from "../platform/ProcessSpec.ts"
import { errorMessage } from "../util/Utils.ts"
import { sanitizeLine, stripAnsi } from "./Ansi.ts"
import type { ConsoleInput } from "./ConsoleInput.ts"
import { TerminalInput, type InputEvent } from "./Input.ts"
import { LineDecoder } from "./LineDecoder.ts"
import type { Screen } from "./Screen.ts"
import { TaskBoard, type BoardTask, type Tone } from "./TaskBoard.ts"
import { TaskLogRun, type TaskLogFile } from "./TaskLog.ts"
import { colorEnvironment, TaskFailures, type OutputParser, type PaneOutcome, type PaneOutput, type PaneSession, type TaskEntry, type TaskOutput, type TaskRunner, type TaskSpec } from "./Tasks.ts"
import { spinnerIntervalMs } from "./Theme.ts"

// 实时会话：第一个任务开始时挂上面板，最后一个任务结束时卸下。
// 只有存在可滚动的任务框时才接管按键与鼠标（只有临时状态行时终端滚轮仍用于翻看历史）。
class LiveSession {
    readonly board: TaskBoard
    private references = 0
    private ticker: ReturnType<typeof setInterval> | undefined
    private input: TerminalInput | undefined
    private regionTop: number | undefined
    private readonly queriedHeights: number[] = []
    private detachWrite: (() => void) | undefined

    constructor(private readonly screen: Screen, private readonly console: ConsoleInput | undefined) {
        this.board = new TaskBoard(screen.palette)
    }

    get live(): boolean { return this.screen.interactive }

    acquire(): void {
        if (this.references++ > 0 || !this.live) return
        this.input = this.console ? new TerminalInput(this.console, sequence => this.screen.write(sequence), event => this.onInput(event)) : undefined
        this.detachWrite = this.screen.onWrite(frame => {
            if (!this.input?.active || !frame.heightChanged || !frame.height) return
            this.queriedHeights.push(frame.height)
            this.input.queryCursor()
        })
        this.screen.mount(this.board)
        this.ticker = setInterval(() => this.screen.invalidate(), spinnerIntervalMs)
        this.ticker.unref()
    }

    release(): void {
        if (this.references === 0 || --this.references > 0 || !this.live) return
        if (this.ticker) clearInterval(this.ticker)
        this.ticker = undefined
        this.detachWrite?.()
        this.detachWrite = undefined
        this.input?.stop()
        this.input = undefined
        this.board.showHints = false
        this.screen.unmount()
    }

    changed(): void {
        this.syncInput()
        this.screen.invalidate()
    }

    // 任务结束：从面板移除，摘要写进滚动历史
    commit(task: BoardTask): void {
        this.board.remove(task)
        this.syncInput()
        this.screen.print(this.board.summary(task, this.screen.columns - 1), task.status === "failed" ? "stderr" : "stdout")
    }

    private syncInput(): void {
        if (!this.input) return
        if (this.board.hasFramed && !this.input.active) {
            if (!this.input.start()) return
            this.board.showHints = true
            this.regionTop = undefined
            this.queriedHeights.length = 0
            this.screen.renderNow(true)
        } else if (!this.board.hasFramed && this.input.active) {
            this.input.stop()
            this.board.showHints = false
        }
    }

    private onInput(event: InputEvent): void {
        if (event.kind === "cursor") {
            // 帧以换行结束，应答的是区域下方空行的行号
            const height = this.queriedHeights.shift() ?? this.screen.regionHeight
            this.regionTop = event.row - height
            return
        }
        if (this.board.handle(event, this.regionTop)) this.screen.renderNow()
    }
}

// 把一个面板任务包装成服务可用的输出接口：日志行同时进入面板缓冲与日志文件
class BoardTaskOutput implements PaneOutput {
    private partialSource: (() => string | undefined) | undefined
    private parser: OutputParser | undefined

    constructor(readonly task: BoardTask, private readonly session: LiveSession, readonly log: TaskLogFile | undefined) {
        task.logPath = log?.display
    }

    get title(): string { return this.task.title }

    line(text: string): void {
        const clean = sanitizeLine(text)
        this.session.board.append(this.task, clean)
        this.log?.write(clean)
        this.session.changed()
        this.parser?.(stripAnsi(clean), this)
    }

    stage(text: string | undefined): void {
        this.task.stage = text
        this.session.changed()
    }

    progress(done: number, total: number): void {
        this.task.progress = { done, total }
        this.session.changed()
    }

    status(text: string, tone: Tone): void {
        this.task.note = { text, tone }
        this.session.changed()
    }

    finish(outcome: PaneOutcome): void {
        this.task.endedAt = Date.now()
        if (outcome.kind === "failed") {
            this.task.status = "failed"
            this.task.failure = outcome.message
        } else {
            this.task.status = "succeeded"
            this.task.note = { text: outcome.kind === "stopped" ? "已停止" : outcome.message, tone: "success" }
        }
        this.session.changed()
    }

    process(spec: ProcessSpec, parser?: OutputParser): ProcessSpec {
        this.parser = parser
        const stdout = new LineDecoder(line => this.line(line))
        const stderr = new LineDecoder(line => this.line(line))
        this.partialSource = () => stdout.partial ?? stderr.partial
        return {
            ...spec,
            stdio: "capture",
            retainOutput: false,
            env: { ...colorEnvironment(), ...spec.env },
            onOutput: (chunk, stream) => {
                (stream === "stdout" ? stdout : stderr).push(chunk)
                const partial = this.partialSource?.()
                this.task.buffer.partial = partial === undefined ? undefined : this.session.board.highlight(sanitizeLine(partial))
                this.session.changed()
                spec.onOutput?.(chunk, stream)
            },
            onOutputEnd: () => {
                stdout.flush()
                stderr.flush()
                this.task.buffer.partial = undefined
                this.session.changed()
                spec.onOutputEnd?.()
            },
        }
    }
}

export class TerminalTaskRunner implements TaskRunner {
    private readonly session: LiveSession
    private readonly logRun = new TaskLogRun()

    constructor(private readonly screen: Screen, console?: ConsoleInput) {
        this.session = new LiveSession(screen, console)
    }

    async run<T>(spec: TaskSpec, body: (task: TaskOutput) => Promise<T>): Promise<T> {
        const [result] = await this.all([{ spec, run: body }])
        return result as T
    }

    async all(entries: readonly TaskEntry[]): Promise<unknown[]> {
        if (!entries.length) return []
        this.session.acquire()
        let settled: PromiseSettledResult<unknown>[]
        try { settled = await Promise.allSettled(entries.map(entry => this.runOne(entry))) } finally { this.session.release() }
        const failures = settled.flatMap((result, index) => result.status === "rejected" ? [{ index, error: result.reason as unknown }] : [])
        const cancelled = failures.find(failure => isAbortError(failure.error))
        if (cancelled) throw cancelled.error
        if (!failures.length) return settled.map(result => (result as PromiseFulfilledResult<unknown>).value)
        if (entries.length === 1) throw failures[0]!.error
        throw new TaskFailures(failures.map(failure => ({ title: entries[failure.index]!.spec.title, error: failure.error })))
    }

    async status<T>(title: string, body: () => Promise<T>): Promise<T> {
        this.session.acquire()
        const task = this.session.board.add({ id: "status", title, kind: "status" })
        this.session.changed()
        try { return await body() } finally {
            this.session.board.remove(task)
            this.session.release()
        }
    }

    panes(): PaneSession {
        const session = this.session
        const opened: BoardTaskOutput[] = []
        session.acquire()
        let closed = false
        return {
            open: async spec => {
                if (closed) throw new Error("窗格会话已结束")
                const log = await this.openLog(spec)
                const output = new BoardTaskOutput(session.board.add({ id: spec.id, title: spec.title, detail: spec.detail, kind: "pane" }), session, log)
                opened.push(output)
                session.changed()
                return output
            },
            close: async () => {
                if (closed) return
                closed = true
                await Promise.all(opened.map(output => output.log?.close()))
                for (const output of opened) {
                    if (output.task.status === "running") output.finish({ kind: "stopped" })
                    session.commit(output.task)
                }
                session.release()
            },
        }
    }

    // 日志文件只是辅助：工程目录不可写等情况下不影响任务本身
    private openLog(spec: TaskSpec): Promise<TaskLogFile | undefined> {
        return spec.rootDir ? this.logRun.open(spec.rootDir, spec.id).catch(() => undefined) : Promise.resolve(undefined)
    }

    private async runOne(entry: TaskEntry): Promise<unknown> {
        const log = await this.openLog(entry.spec)
        const task = this.session.board.add({ id: entry.spec.id, title: entry.spec.title, detail: entry.spec.detail })
        const output = new BoardTaskOutput(task, this.session, log)
        this.session.changed()
        try {
            const value = await entry.run(output)
            task.status = "succeeded"
            return value
        } catch (error) {
            task.status = isAbortError(error) ? "cancelled" : "failed"
            task.failure = isAbortError(error) ? undefined : errorMessage(error)
            throw error
        } finally {
            task.endedAt = Date.now()
            task.buffer.partial = undefined
            await log?.close()
            this.session.commit(task)
        }
    }
}
