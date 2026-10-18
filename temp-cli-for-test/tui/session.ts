import type { Command, CommandUi } from './api.ts'
import { SessionDocument } from './document.ts'
import { PromptController } from './prompt-controller.ts'
import { TaskController } from './task-controller.ts'
import { ViewportController } from './viewport-controller.ts'
import { TranscriptRenderer } from './view.js'
import { TerminalDriver } from './terminal-driver.ts'
import type { InputEvent } from './input-decoder.ts'

interface Stop { code: number, error?: Error, cancel?: boolean }
const asError = (value: unknown): Error => value instanceof Error ? value : new Error(String(value))

// 会话统一承接终端事件与业务结束，业务只持有封闭的语义交互接口
export class TerminalSession {
    #driver: TerminalDriver
    #document = new SessionDocument()
    #prompt: PromptController
    #tasks: TaskController
    #viewport: ViewportController
    #abort = new AbortController()
    #state: 'new' | 'active' | 'waiting' | 'closing' | 'closed' = 'new'
    #timer?: ReturnType<typeof setInterval>
    #frame = 0
    #hooks: (() => void)[] = []
    #resolveStop!: (stop: Stop) => void
    #stopped = false
    #stop = new Promise<Stop>(resolve => { this.#resolveStop = resolve })

    constructor(driver = new TerminalDriver()) {
        this.#driver = driver
        this.#viewport = new ViewportController(this.#document, driver)
        this.#prompt = new PromptController(this.#document, () => this.#render(true))
        this.#tasks = new TaskController(this.#document, () => this.#render(), () => this.#assertActive())
    }

    #assertActive(): void {
        this.#abort.signal.throwIfAborted()
        if (this.#state !== 'active') throw new Error('命令交互已结束')
    }

    #assertCanAppend(): void {
        this.#assertActive()
        if (this.#document.prompt || this.#document.entries.some(entry => entry.type === 'batch' && entry.state === 'running')) throw new Error('当前活跃交互完成后才能追加下一项')
    }

    #ui(): CommandUi {
        const append = (type: 'heading' | 'message' | 'result', text: string) => {
            this.#assertCanAppend()
            this.#document.entries.push({ type, text })
            this.#render()
        }

        return Object.freeze({
            heading: (text: string) => append('heading', text),
            message: (text: string) => append('message', text),
            result: (text: string) => append('result', text),
            select: <Value extends string>(question: string, options: readonly { value: Value, label: string }[]) => {
                this.#assertCanAppend()
                return this.#prompt.select(question, options)
            },
            text: (question: string, options?: { placeholder?: string, defaultValue?: string }) => {
                this.#assertCanAppend()
                return this.#prompt.text(question, options)
            },
            multiselect: <Value extends string>(question: string, options: readonly { value: Value, label: string }[], initial?: readonly Value[]) => {
                this.#assertCanAppend()
                return this.#prompt.multiselect(question, options, initial)
            },
            tasks: (title: string, definitions: Parameters<CommandUi['tasks']>[1]) => {
                this.#assertCanAppend()
                return this.#tasks.open(title, definitions)
            }
        })
    }

    async run(command: Command): Promise<number> {
        if (this.#state !== 'new') throw new Error('会话不能重复运行')

        const listen = (emitter: { on(name: string, handler: (...args: any[]) => void): unknown, off(name: string, handler: (...args: any[]) => void): unknown }, name: string, handler: (...args: any[]) => void) => {
            emitter.on(name, handler)
            this.#hooks.push(() => { emitter.off(name, handler) })
        }
        this.#state = 'active'
        listen(this.#driver, 'input', event => this.#input(event))
        listen(this.#driver, 'resize', () => this.#render())
        listen(this.#driver, 'signal', () => this.#requestStop({ code: 1, cancel: true }))
        listen(this.#driver, 'failure', error => this.#requestStop({ code: 1, error: asError(error) }))
        listen(this.#driver.host, 'uncaughtException', error => this.#requestStop({ code: 1, error: asError(error) }))
        listen(this.#driver.host, 'unhandledRejection', error => this.#requestStop({ code: 1, error: asError(error) }))
        let outcome: Stop = { code: 0 }
        let execution: Promise<Stop> | undefined
        try {
            this.#driver.enter()
            this.#timer = setInterval(() => {
                if (!this.#document.entries.some(entry => entry.type === 'batch' && entry.state === 'running')) return
                this.#frame++
                this.#render()
            }, 160)
            execution = Promise.resolve().then(() => command(this.#ui(), this.#abort.signal)).then(() => ({ code: 0 }), error => ({ code: 1, error: asError(error) }))
            const first = await Promise.race([execution.then(stop => ({ source: 'command', stop })), this.#stop.then(stop => ({ source: 'stop', stop }))])
            outcome = first.stop
            if (first.source === 'stop') {
                // 先取消并等待业务释放自身资源，再退出终端和拍扁历史
                const settled = await execution
                if (settled.error && settled.error !== this.#abort.signal.reason && settled.error.name !== 'AbortError') outcome = { code: 1, error: settled.error }
            } else if (outcome.error) this.#requestStop(outcome)
            else {
                this.#assertCanAppend()
                this.#document.phase = 'done'
                this.#state = 'waiting'
                this.#render(true)
                outcome = await this.#stop
            }
        } catch (error) {
            outcome = { code: 1, error: asError(error) }
            this.#requestStop(outcome)
            if (execution) await execution
        }
        if (outcome.error) {
            this.#document.phase = 'failed'
            this.#document.entries.push({ type: 'result', text: `发生错误：${outcome.error.message}` })
        }
        this.#state = 'closing'
        clearInterval(this.#timer)
        const closeErrors: unknown[] = []
        let transcript: string | undefined
        try { transcript = new TranscriptRenderer().render(this.#document) } catch (error) { closeErrors.push(error) }
        // 拍扁渲染失败也必须归还终端，不能让异常跳过恢复
        try { await this.#driver.close(transcript) } catch (error) { closeErrors.push(error) }
        finally {
            for (const remove of this.#hooks.splice(0).reverse()) remove()
            this.#state = 'closed'
        }
        if (outcome.error && closeErrors.length) throw new AggregateError([outcome.error, ...closeErrors], '命令及终端恢复失败')
        if (outcome.error) throw outcome.error
        if (closeErrors.length === 1) throw closeErrors[0]
        if (closeErrors.length) throw new AggregateError(closeErrors, '历史渲染及终端恢复失败')
        return outcome.code
    }

    #requestStop(stop: Stop): void {
        if (this.#stopped || this.#state === 'closed') return
        this.#stopped = true
        if (stop.cancel || stop.error) {
            const reason = stop.error ?? new Error('操作已取消')
            this.#document.cancel()
            this.#prompt.cancel(reason)
            this.#abort.abort(reason)
        }
        this.#resolveStop(stop)
    }

    #render(followTail = false): void {
        if (this.#stopped || !['active', 'waiting'].includes(this.#state)) return
        try {
            if (followTail) this.#viewport.followTail()
            this.#viewport.render(this.#frame)
        } catch (error) { this.#requestStop({ code: 1, error: asError(error) }) }
    }

    #input(event: InputEvent): void {
        if (this.#stopped) return
        if (event.kind === 'wheel') {
            this.#viewport.wheel(event.x, event.y, event.delta)
            this.#render()
            return
        }
        if (event.kind === 'paste') {
            this.#prompt.paste(event.text)
            return
        }
        if (event.kind !== 'key') return
        if (event.key === 'interrupt' || (event.key === 'escape' && this.#document.prompt)) return this.#requestStop({ code: 0, cancel: true })
        if (this.#viewport.key(event.key)) {
            this.#render()
            return
        }
        if (this.#state === 'waiting' && event.key === 'enter') return this.#requestStop({ code: 0 })
        this.#prompt.key(event)
    }
}
