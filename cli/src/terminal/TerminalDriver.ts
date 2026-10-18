import { EventEmitter } from 'node:events'
import { InputDecoder } from './InputDecoder.ts'
import type { InputEvent } from './InputDecoder.ts'
import { protocol, terminalLines } from './Protocol.ts'

interface TerminalInput extends EventEmitter { isTTY?: boolean, isRaw?: boolean, readableFlowing: boolean | null, setRawMode(raw: boolean): unknown, resume(): unknown, pause(): unknown }
interface TerminalOutput extends EventEmitter { isTTY?: boolean, columns?: number, rows?: number, write(text: string, callback?: (error?: Error | null) => void): unknown }
interface DriverOptions { input?: TerminalInput, output?: TerminalOutput, host?: EventEmitter, escapeDelay?: number, settleDelay?: number }

const owners = new WeakMap<object, TerminalDriver>()

// 统一持有终端流、VT 模式、原始输入和进程信号监听
// 不负责历史、提问、任务、命中或业务执行
export class TerminalDriver extends EventEmitter<{ input: [InputEvent], resize: [], signal: [string], failure: [unknown] }> {
    #state: 'new' | 'active' | 'closing' | 'closed' = 'new'
    #decoder = new InputDecoder()
    #escapeTimer?: ReturnType<typeof setTimeout>
    #closing?: Promise<void>
    #modes = false
    #raw = false
    #wasRaw = false
    #wasFlowing = false
    #hooks: (() => void)[] = []
    #writing = false
    #pendingFrame?: string
    #idle: (() => void)[] = []
    #quietReset?: () => void
    #outputError?: unknown
    readonly input: TerminalInput
    readonly output: TerminalOutput
    readonly host: EventEmitter
    private readonly escapeDelay: number
    private readonly settleDelay: number

    constructor({ input = process.stdin, output = process.stdout, host = process, escapeDelay = 40, settleDelay = 25 }: DriverOptions = {}) {
        super()
        this.input = input
        this.output = output
        this.host = host
        this.escapeDelay = escapeDelay
        this.settleDelay = settleDelay
    }

    get state() { return this.#state }

    get columns() { return Math.max(1, this.output.columns || 80) }

    get rows() { return Math.max(1, this.output.rows || 24) }

    enter() {
        if (this.#state !== 'new') throw new Error('终端不能重复接管')

        if (!this.input.isTTY || !this.output.isTTY || !this.input.setRawMode) throw new Error('Arrange 需要交互式 TTY，请直接在终端运行')

        if (owners.has(this.input) || owners.has(this.output)) throw new Error('终端已被另一会话接管')
        owners.set(this.input, this)
        owners.set(this.output, this)
        this.#wasRaw = this.input.isRaw === true
        this.#wasFlowing = this.input.readableFlowing === true
        this.#state = 'active'

        try {
            this.#listen(this.host, 'exit', () => this.restoreSync())
            this.#listen(this.host, 'SIGINT', () => this.#dispatch({ kind: 'key', key: 'interrupt' }))
            for (const signal of ['SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])]) {
                this.#listen(this.host, signal, () => { if (this.#state === 'active') this.emit('signal', signal) })
            }
            this.#listen(this.input, 'data', chunk => this.#receive(chunk))
            this.#listen(this.input, 'end', () => this.#failure(new Error('终端输入已结束')))
            this.#listen(this.input, 'error', error => this.#failure(error))
            this.#listen(this.output, 'error', error => {
                this.#outputError = error
                this.#failure(error)
            })
            this.#listen(this.output, 'resize', () => { if (this.#state === 'active') this.emit('resize') })
            // 每次修改状态前先登记恢复，以覆盖只完成一部分的初始化失败
            this.#raw = true
            this.input.setRawMode(true)
            this.#modes = true
            this.output.write(protocol.enter)
            this.input.resume()
        } catch (error) {
            const errors = this.restoreSync()
            if (errors.length) throw new AggregateError([error, ...errors], '终端接管失败且恢复发生错误')
            throw error
        }
    }

    #listen(emitter: EventEmitter, name: string, handler: (...args: any[]) => void): void {
        emitter.on(name, handler)
        this.#hooks.push(() => emitter.off(name, handler))
    }

    #receive(chunk: Buffer | string): void {
        if (this.#state === 'closing') {
            this.#quietReset?.()
            return
        }
        if (this.#state !== 'active') return
        clearTimeout(this.#escapeTimer)
        try {
            for (const event of this.#decoder.feed(chunk)) this.#dispatch(event)
            if (this.#state === 'active' && this.#decoder.pending) {
                this.#escapeTimer = setTimeout(() => {
                    for (const event of this.#decoder.expire()) this.#dispatch(event)
                }, this.escapeDelay)
            }
        } catch (error) { this.#failure(error) }
    }

    #dispatch(event: InputEvent): void { if (this.#state === 'active') this.emit('input', event) }

    #failure(error: unknown): void { if (this.#state === 'active') this.emit('failure', error) }

    writeFrame(frame: string): void {
        if (this.#state !== 'active') return
        this.#pendingFrame = frame
        this.#pump()
    }

    #pump() {
        if (this.#writing || this.#pendingFrame === undefined || this.#state !== 'active') return
        const frame = this.#pendingFrame
        this.#pendingFrame = undefined
        this.#writing = true
        this.#write(frame).then(() => this.#frameDone(), error => {
            this.#outputError = error
            this.#pendingFrame = undefined
            this.#frameDone()
            this.#failure(error)
        })
    }

    #frameDone() {
        this.#writing = false
        for (const resolve of this.#idle.splice(0)) resolve()
        this.#pump()
    }

    #write(text: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.output.write(text, error => error ? reject(error) : resolve())
        })
    }

    close(transcript = ''): Promise<void> {
        if (this.#closing) return this.#closing
        if (this.#state === 'new' || this.#state === 'closed') {
            this.#state = 'closed'
            return this.#closing = transcript ? this.#write(terminalLines(transcript)) : Promise.resolve()
        }
        this.#closing = this.#close(transcript)
        return this.#closing
    }

    async #close(transcript: string): Promise<void> {
        this.#state = 'closing'
        this.#pendingFrame = undefined
        clearTimeout(this.#escapeTimer)
        const errors: unknown[] = []
        const attempt = async (action: () => unknown) => { try { await action() } catch (error) { errors.push(error) } }
        // 等待已经提交的帧写完，再开始恢复终端
        if (this.#writing) await new Promise<void>(resolve => this.#idle.push(resolve))
        if (this.#outputError) errors.push(this.#outputError)
        if (this.#modes) {
            await attempt(() => this.#write(protocol.stopReports))
            // 保持原始模式，继续接收并丢弃迟到的输入报告
            await this.#settleInput()
        }
        await attempt(() => this.#restoreInput())
        if (this.#modes) await attempt(async () => {
            await this.#write(protocol.leave)
            this.#modes = false
        })
        if (transcript) await attempt(() => this.#write(terminalLines(transcript)))
        // 最终写回调完成后才移除监听
        if (this.#modes || this.#raw) errors.push(...this.restoreSync())
        else this.#release()
        if (errors.length) throw new AggregateError([...new Set(errors)], '终端恢复或历史写出失败')
    }

    #settleInput(): Promise<void> {
        if (this.settleDelay <= 0) return Promise.resolve()
        return new Promise<void>(resolve => {
            let quiet: ReturnType<typeof setTimeout> | undefined
            const done = () => {
                clearTimeout(quiet)
                clearTimeout(deadline)
                this.#quietReset = undefined
                resolve()
            }
            const deadline = setTimeout(done, this.settleDelay * 4)
            this.#quietReset = () => {
                clearTimeout(quiet)
                quiet = setTimeout(done, this.settleDelay)
            }
            this.#quietReset()
        })
    }

    #restoreInput() {
        if (this.#raw) {
            this.input.setRawMode(this.#wasRaw)
            this.#raw = false
        }
        if (this.#wasFlowing) this.input.resume()
        else this.input.pause()
    }

    // 进程退出时只作同步兜底，不能承诺异步写出完成
    restoreSync(): unknown[] {
        if (this.#state === 'closed' || this.#state === 'new') return []
        this.#state = 'closing'
        this.#pendingFrame = undefined
        clearTimeout(this.#escapeTimer)
        const errors: unknown[] = []
        const attempt = (action: () => unknown) => { try { action() } catch (error) { errors.push(error) } }
        if (this.#modes) attempt(() => {
            this.output.write(protocol.stopReports + protocol.leave)
            this.#modes = false
        })
        attempt(() => this.#restoreInput())
        this.#release()
        return errors
    }

    #release() {
        for (const remove of this.#hooks.splice(0).reverse()) remove()
        if (owners.get(this.input) === this) owners.delete(this.input)
        if (owners.get(this.output) === this) owners.delete(this.output)
        this.#state = 'closed'
    }
}
