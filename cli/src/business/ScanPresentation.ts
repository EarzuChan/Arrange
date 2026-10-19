import type { CommandInterface } from './CommandInterface.ts'
import type { TaskEntry, TaskOutput, TaskRunner, TaskSpec } from '../feature/operation/Work.ts'
import type { PresentationRegion } from '../terminal/Presentation.ts'
import type { Tone } from '../terminal/SessionDocument.ts'

// 扫描、修正与重扫共用一个业务步骤，实际执行任务在收束扫描后继续保留
export class ScanPresentation implements TaskRunner {
    private region?: PresentationRegion<CommandInterface>
    constructor(private readonly output: CommandInterface) { }
    get current(): CommandInterface { return this.region?.current ?? this.output }

    async status<T>(title: string, body: () => Promise<T>): Promise<T> {
        this.region ??= this.output.region()
        return this.region.replace().tasks.status(title, body)
    }
    report(tone: Tone, lines: readonly string[], final: boolean): void {
        this.current.reporter.toned(tone, lines)
        if (final) this.complete()
    }
    complete(answer?: { readonly question: string, readonly answer: string }): void {
        if (!this.region) return
        this.region.complete(answer)
        this.region = undefined
    }
    message(text: string, completed = false): void {
        if (this.region && completed) this.complete({ question: '检查结果', answer: text })
        else this.current.reporter.step(text)
    }
    failure(text: string): void {
        if (this.region) {
            this.region.replace().reporter.error(text)
            this.complete()
        } else this.output.reporter.error(text)
    }
    run<T>(spec: TaskSpec, body: (task: TaskOutput) => Promise<T>): Promise<T> {
        this.complete()
        return this.output.tasks.run(spec, body)
    }
    all(entries: readonly TaskEntry[]): Promise<unknown[]> {
        this.complete()
        return this.output.tasks.all(entries)
    }
    processes() {
        this.complete()
        return this.output.tasks.processes()
    }
}
