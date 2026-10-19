import { isAbortError, type ProcessSpec } from '../feature/platform/ProcessSpec.ts'
import { TaskFailures, type OutputParser, type ProcessOutcome, type ProcessProgress, type ProcessProgressGroup, type TaskEntry, type TaskOutput, type TaskRunner, type TaskSpec, type WorkTone } from '../feature/operation/Work.ts'
import { TaskLogRun, type TaskLogFile } from '../feature/operation/WorkLog.ts'
import { LineDecoder, TerminalTextDecoder } from '../util/LineDecoder.ts'
import { stripAnsi, sanitizeLine } from '../util/TerminalText.ts'
import { errorMessage } from '../util/Utils.ts'
import type { TaskGroup, TaskPresentation, TaskView } from '../terminal/Presentation.ts'

// 工具输出被捕获到只读荧幕，保留其支持的颜色但尊重用户的禁色要求
function colorEnvironment(): Record<string, string> {
    return process.env.NO_COLOR ? {} : { FORCE_COLOR: '1', CLICOLOR_FORCE: '1' }
}

// 业务适配器连接功能进展与呈现，不向两侧泄露对方的句柄
class WorkOutput implements ProcessProgress {
    private readonly decoders: TerminalTextDecoder[] = []
    private readonly parsers: LineDecoder[] = []
    private outcome: ProcessOutcome | undefined
    private closing?: Promise<void>
    private log?: TaskLogFile
    constructor(readonly title: string, private readonly presentation: TaskPresentation, private readonly openLog: () => TaskLogFile, private readonly signal?: AbortSignal) {
        presentation.start()
    }

    line(text: string): void {
        this.log ??= this.openLog()
        this.presentation.console(text + '\r\n')
        this.log?.write(text)
    }

    stage(text?: string): void { this.presentation.stage(text) }

    progress(done: number, total: number): void { if (total > 0) this.presentation.progress(done / total) }

    status(text: string, tone: WorkTone): void { this.presentation.note(text, tone === 'info' ? 'info' : tone) }

    finish(outcome: ProcessOutcome): Promise<void> {
        this.outcome ??= outcome
        return this.close()
    }

    process(spec: ProcessSpec, parser?: OutputParser): ProcessSpec {
        this.log ??= this.openLog()
        const decoders = { stdout: new TerminalTextDecoder(), stderr: new TerminalTextDecoder() }
        const parsers = {
            stdout: new LineDecoder(line => {
                this.log?.write(line)
                parser?.(stripAnsi(sanitizeLine(line)), this)
            }),
            stderr: new LineDecoder(line => {
                this.log?.write(line)
                parser?.(stripAnsi(sanitizeLine(line)), this)
            })
        }
        this.decoders.push(...Object.values(decoders))
        this.parsers.push(...Object.values(parsers))
        // 有实际子进程才展开荧幕，普通任务只呈现自身状态
        this.presentation.console('')
        return {
            ...spec, retainOutput: false, env: { ...colorEnvironment(), ...spec.env },
            onOutput: (chunk, stream) => {
                const text = decoders[stream].push(chunk)
                if (text) this.presentation.console(text)
                parsers[stream].push(chunk)
                spec.onOutput?.(chunk, stream)
            },
            onOutputEnd: () => {
                for (const decoder of Object.values(decoders)) {
                    const tail = decoder.flush()
                    if (tail) this.presentation.console(tail)
                }
                parsers.stdout.flush()
                parsers.stderr.flush()
                spec.onOutputEnd?.()
            }
        }
    }

    close(error?: unknown): Promise<void> {
        return this.closing ??= this.commit(error)
    }

    private async commit(error?: unknown): Promise<void> {
        const state = error ? isAbortError(error) ? 'cancelled' : 'failed' : this.outcome?.kind === 'failed' ? 'failed' : this.signal?.aborted ? 'cancelled' : this.outcome?.kind === 'stopped' ? 'stopped' : 'done'
        let failure: unknown
        try {
            for (const decoder of this.decoders) {
                const tail = decoder.flush()
                if (tail) this.presentation.console(tail)
            }
            for (const parser of this.parsers) parser.flush()
            if (error) this.log?.write(errorMessage(error))
            else if (this.outcome && this.outcome.kind !== 'stopped') this.log?.write(this.outcome.message)
            await this.presentation.finish(state, error ? errorMessage(error) : this.outcome && this.outcome.kind !== 'stopped' ? this.outcome.message : undefined)
        } catch (cleanup) { failure = cleanup }

        try {
            const path = await this.log?.close(state === 'done' && failure === undefined)
            if (path) this.presentation.log(path)
        } catch (cleanup) {
            if (failure !== undefined) throw new AggregateError([failure, cleanup], errorMessage(failure) + '；日志保存失败：' + errorMessage(cleanup))
            throw cleanup
        }
        if (failure !== undefined) throw failure
    }
}

export class WorkPresenter implements TaskRunner {
    private readonly logs = new TaskLogRun()

    constructor(private readonly view: TaskView, private readonly signal?: AbortSignal) { }

    async run<T>(spec: TaskSpec, body: (task: TaskOutput) => Promise<T>): Promise<T> {
        return (await this.all([{ spec, run: body }]))[0] as T
    }

    async all(entries: readonly TaskEntry[]): Promise<unknown[]> {
        return this.present(entries)
    }

    private async present(entries: readonly TaskEntry[], transient = false): Promise<unknown[]> {
        if (!entries.length) return []
        const group = this.view.group(entries.length === 1 ? entries[0]!.spec.title : '任务', { transient })
        const handles = entries.map(entry => group.task(entry.spec.title, entry.spec.detail))
        const results = await Promise.allSettled(entries.map((entry, index) => this.runOne(entry, handles[index]!)))
        group.complete()
        const failures = results.flatMap((result, index) => result.status === 'rejected' ? [{ title: entries[index]!.spec.title, error: result.reason as unknown }] : [])
        const cancelled = failures.find(item => isAbortError(item.error))
        if (cancelled) throw cancelled.error
        if (failures.length === 1 && entries.length === 1) throw failures[0]!.error
        if (failures.length) throw new TaskFailures(failures)
        return results.map(result => (result as PromiseFulfilledResult<unknown>).value)
    }

    private async open(spec: TaskSpec, presentation: TaskPresentation): Promise<WorkOutput> {
        return new WorkOutput(spec.title, presentation, () => this.logs.open(spec.rootDir ?? process.cwd(), spec.id), this.signal)
    }

    private async runOne(entry: TaskEntry, presentation: TaskPresentation): Promise<unknown> {
        const output = await this.open(entry.spec, presentation)
        let failure: unknown
        try { return await entry.run(output) }
        catch (error) {
            failure = error
            throw error
        }
        finally {
            try { await output.close(failure) }
            catch (cleanup) {
                if (failure !== undefined) throw new AggregateError([failure, cleanup], errorMessage(failure) + '；任务收尾失败：' + errorMessage(cleanup))
                throw cleanup
            }
        }
    }

    async status<T>(title: string, body: () => Promise<T>): Promise<T> { return (await this.present([{ spec: { id: 'status', title }, run: body }], true))[0] as T }

    processes(): ProcessProgressGroup {
        let group: TaskGroup | undefined
        const opened: Promise<WorkOutput>[] = []
        let closed = false
        return {
            open: spec => {
                if (closed) return Promise.reject(new Error('开发进展已结束'))
                group ??= this.view.group('开发进程')
                const output = this.open(spec, group.task(spec.title, spec.detail))
                opened.push(output)
                return output
            },
            close: async () => {
                if (closed) return
                closed = true
                const results = await Promise.allSettled(opened.map(async pending => (await pending).finish({ kind: 'stopped' })))
                const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
                try { group?.complete() } catch (error) { errors.push(error) }
                if (errors.length) throw new AggregateError(errors, '开发进展收尾失败')
            }
        }
    }
}
