import { EventEmitter } from 'node:events'
import { TerminalDriver } from './TerminalDriver.ts'
import { SessionDocument, type Entry } from './SessionDocument.ts'
import { Reporter } from './Reporter.ts'
import { PromptController } from './PromptController.ts'
import type { PromptContext } from './Prompts.ts'
import { TaskController } from './TaskController.ts'
import type { TaskView, PresentationRegion } from './Presentation.ts'
import { ViewportController } from './ViewportController.ts'
import { TranscriptRenderer } from './TranscriptRenderer.ts'
import type { InputEvent } from './InputDecoder.ts'
import { StopController } from './StopController.ts'
import type { StopControl } from '../util/StopControl.ts'

export interface TerminalPort extends EventEmitter {
    readonly columns: number
    readonly rows: number
    readonly host: EventEmitter
    readonly output: { isTTY?: boolean, hasColors?(): boolean }
    enter(): void
    writeFrame(frame: string): void
    close(transcript?: string): Promise<void>
}
export interface SessionUi {
    readonly reporter: Reporter
    readonly prompt: PromptContext
    readonly tasks: TaskView
    stoppable<T>(hint: string, body: (control: StopControl) => Promise<T>): Promise<T>
    region(): PresentationRegion<SessionUi>
}

// 会话拥有唯一驱动与文档，业务只取得语义接口和取消信号
export class TerminalSession {
    private readonly document = new SessionDocument()
    private readonly abort = new AbortController()
    private readonly prompts: PromptController
    private readonly tasks: TaskController
    private readonly viewport: ViewportController
    private readonly stops: StopController
    private readonly hooks: (() => void)[] = []
    private state: 'new' | 'active' | 'waiting' | 'closing' | 'closed' = 'new'
    private timer?: ReturnType<typeof setInterval>
    private scheduled?: ReturnType<typeof setTimeout>
    private closing?: Promise<void>
    private frame = 0
    private failure?: unknown
    private resolveExit?: () => void
    private interrupted = false
    private lastMessage?: Entry
    private messageAtCancel?: Entry
    private shutdownRequested = false
    readonly ui: SessionUi

    constructor(private readonly driver: TerminalPort = new TerminalDriver()) {
        const changed = () => this.invalidate()
        this.stops = new StopController(changed)
        this.prompts = new PromptController(this.document, changed, () => {
            this.abort.signal.throwIfAborted()
            if (this.state !== 'active') throw new Error('当前会话不能提问')
            if ([...this.document.contents()].some(entry => entry.type === 'batch' && entry.state === 'running')) throw new Error('任务批次完成后才能提问')
        })
        this.tasks = new TaskController(this.document, changed, () => {
            this.abort.signal.throwIfAborted()
            if (this.state !== 'active' && this.state !== 'new') throw new Error('会话已停止接受任务')
            if (this.prompts.active || [...this.document.contents()].some(entry => entry.type === 'batch' && entry.state === 'running')) throw new Error('当前活跃交互完成后才能开始下一批任务')
        })
        this.viewport = new ViewportController(this.document, driver)
        this.ui = this.makeUi(this.document)
    }

    private makeUi(document: SessionDocument): SessionUi {
        return Object.freeze({
            reporter: new Reporter(entry => this.append(entry, document)),
            prompt: Object.freeze({ controller: Object.freeze({ ask: <T>(request: Parameters<PromptController['ask']>[0]) => this.prompts.ask<T>(request, document) }) }),
            tasks: Object.freeze({ group: (title: string, options?: { readonly transient?: boolean }) => this.tasks.group(title, options, document) }),
            stoppable: <T>(hint: string, body: (control: StopControl) => Promise<T>) => {
                this.abort.signal.throwIfAborted()
                if (this.state !== 'active' || this.prompts.active) throw new Error('当前会话不能开放正常结束')
                return this.stops.run(document, hint, body)
            },
            region: () => {
                this.abort.signal.throwIfAborted()
                if (this.state !== 'new' && this.state !== 'active') throw new Error('会话已停止接受流程区块')
                if (this.prompts.active || [...this.document.contents()].some(entry => entry.type === 'batch' && entry.state === 'running')) throw new Error('当前活跃交互完成后才能建立流程区块')
                const region = document.region()
                let current = this.makeUi(region.document)
                this.invalidate()
                return Object.freeze({
                    get current() { return current },
                    replace: () => {
                        this.prompts.cancelWithin(region.document)
                        current = this.makeUi(region.replace())
                        this.invalidate()
                        return current
                    },
                    complete: (answer?: { readonly question: string, readonly answer: string }) => {
                        this.prompts.cancelWithin(region.document)
                        region.complete(answer)
                        this.invalidate()
                    }
                })
            }
        })
    }

    get signal(): AbortSignal { return this.abort.signal }

    async run(command: (ui: SessionUi, signal: AbortSignal) => Promise<number | void>): Promise<number> {
        let code = 0

        try {
            try {
                this.start()

                code = await command(this.ui, this.signal) ?? 0
                await this.tasks.flush()

                if (this.failure) throw this.failure

                if (this.interrupted && (!code || code === 130)) {
                    this.document.phase = 'cancelled'
                    code = 130
                } else {
                    if ([...this.document.contents()].some(entry => entry.type === 'batch' && entry.state === 'running')) throw new Error('命令结束时仍有未完成任务')
                    this.document.phase = code ? 'failed' : 'done'
                }
            } catch (error) {
                code = this.reportFailure(error)
            }

            // 先冻结交互与控制台快照，所有命令结果共用停屏出口
            this.prompts.cancel()
            try {
                await this.tasks.close(this.document.phase === 'failed' ? 'failed' : 'cancelled')
            } catch (error) {
                code = this.reportFailure(error)
            }

            if (this.document.phase === 'cancelled') {
                const last = [...this.document.contents()].at(-1)
                if (!this.lastMessage || this.lastMessage === this.messageAtCancel || last !== this.lastMessage) this.ui.reporter.warn('已取消操作')
                code = 130
            }
            this.document.sealChildren()
            if (!this.failure && !this.shutdownRequested) await this.waitForExit()
        } catch (error) {
            code = this.reportFailure(error)
        } finally {
            try {
                await this.close()
            } catch {
                code = 1
            }
        }
        return code
    }

    private reportFailure(error: unknown): number {
        const reason = this.failure ?? error
        if (!this.failure && this.signal.aborted && (reason === this.signal.reason || reason instanceof Error && reason.name === 'AbortError')) {
            this.document.phase = 'cancelled'
            return 130
        }
        this.document.phase = 'failed'
        this.prompts.cancel()
        this.ui.reporter.error(reason instanceof Error ? reason.message : String(reason))
        return 1
    }

    private append(entry: Entry, document = this.document): void {
        if (this.state === 'closing' || this.state === 'closed') throw new Error('会话已结束')

        if (this.prompts.active) throw new Error('当前问题回答后才能追加下一项')

        document.assertActive()
        document = document.activeDocument()
        const batch = [...document.contents()].find(entry => entry.type === 'batch' && entry.state === 'running')
        if (entry.type === 'message' && batch?.type === 'batch') (batch.messages ??= []).push({ text: entry.text, tone: entry.tone })
        else document.append(entry)

        if (entry.type === 'message') this.lastMessage = entry

        this.invalidate()
    }

    start(): void {
        if (this.state !== 'new') throw new Error('会话不能重复启动')

        this.state = 'active'
        const listen = (emitter: EventEmitter, name: string, handler: (...args: any[]) => void) => {
            emitter.on(name, handler)
            this.hooks.push(() => emitter.off(name, handler))
        }
        listen(this.driver, 'input', (event: InputEvent) => this.input(event))
        listen(this.driver, 'resize', () => this.invalidate())
        listen(this.driver, 'signal', () => this.cancel(false))
        listen(this.driver, 'failure', error => this.stop(error))
        listen(this.driver.host, 'uncaughtException', error => this.stop(error))
        listen(this.driver.host, 'unhandledRejection', error => this.stop(error))
        try {
            this.driver.enter()
            this.timer = setInterval(() => {
                if ([...this.document.contents()].some(entry => entry.type === 'batch' && entry.state === 'running')) {
                    this.frame++
                    this.invalidate()
                }
            }, 160)
            this.invalidate()
        } catch (error) {
            this.stop(error)
            throw error
        }
    }

    private stop(error: unknown): void {
        this.failure ??= error
        this.cancel(false)
    }

    private cancel(waitForEnter = true): void {
        if (this.state === 'closed' || this.state === 'closing') return
        if (waitForEnter && this.state === 'waiting') return

        if (!waitForEnter) this.shutdownRequested = true
        if (!this.interrupted) this.messageAtCancel = this.lastMessage
        this.interrupted = true
        this.abort.abort(new DOMException('操作已取消', 'AbortError'))
        this.prompts.cancel()
        if (!waitForEnter) this.resolveExit?.()
    }

    private invalidate(): void {
        if (!['active', 'waiting'].includes(this.state) || this.scheduled) return

        // 同一轮输出合成一帧，背压期间由驱动保留最新整帧
        this.scheduled = setTimeout(() => {
            this.scheduled = undefined
            try { this.viewport.render(this.frame, this.prompts.content) }
            catch (error) { this.stop(error) }
        }, 16)
    }

    private input(event: InputEvent): void {
        if (event.kind === 'wheel') this.viewport.wheel(event.x, event.y, event.delta)
        else if (event.kind === 'key' && (event.key === 'interrupt' || event.key === 'escape')) {
            if (this.state !== 'waiting' && this.stops.request()) return
            return this.cancel()
        }
        else if (this.state === 'waiting' && event.kind === 'key' && event.key === 'enter') this.resolveExit?.()
        else if (event.kind === 'key' && ['pageup', 'pagedown'].includes(event.key)) this.viewport.key(event.key)
        else if (this.prompts.active) this.prompts.handle(event)
        else if (event.kind === 'key') this.viewport.key(event.key)

        this.invalidate()
    }

    private async waitForExit(): Promise<void> {
        if (this.failure) throw this.failure

        if (this.shutdownRequested) return

        this.state = 'waiting'
        this.viewport.followTail()
        this.invalidate()
        await new Promise<void>(resolve => { this.resolveExit = resolve })
        this.resolveExit = undefined

        if (this.failure) throw this.failure
    }

    close(): Promise<void> { return this.closing ??= this.finish() }

    private async finish(): Promise<void> {
        this.state = 'closing'

        clearTimeout(this.scheduled)
        clearInterval(this.timer)
        this.prompts.cancel()

        const errors: unknown[] = []
        let transcript = ''

        try {
            await this.tasks.close(this.document.phase === 'failed' ? 'failed' : 'cancelled')
        } catch (error) {
            errors.push(error)
        }

        try {
            if (this.document.phase === 'active') this.document.phase = 'done'
            this.document.seal()
            transcript = new TranscriptRenderer().render(this.document)
        } catch (error) {
            errors.push(error)
        }

        try {
            await this.driver.close(transcript)
        } catch (error) {
            errors.push(error)
        } finally {
            for (const remove of this.hooks.splice(0).reverse()) remove()
            this.state = 'closed'
        }

        if (errors.length) throw new AggregateError(errors, '终端恢复或会话历史写出失败')
    }
}
