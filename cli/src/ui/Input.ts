import type { ConsoleInput } from "./ConsoleInput.ts"

// 原始模式下的终端输入：按键、SGR 鼠标（滚轮、左键按下）、光标位置应答（DSR）
// 一个转义序列可能被拆在两次 data 里，未完成的部分先缓存；单独的 ESC 等待片刻后才当作 Esc 键

export type KeyName = "up" | "down" | "left" | "right" | "pageup" | "pagedown" | "home" | "end" | "tab" | "backtab" | "enter" | "escape" | "interrupt" | "char"

export type InputEvent =
    | { readonly kind: "key", readonly key: KeyName, readonly text?: string }
    | { readonly kind: "wheel", readonly direction: "up" | "down", readonly column: number, readonly row: number }
    | { readonly kind: "click", readonly column: number, readonly row: number }
    | { readonly kind: "cursor", readonly row: number, readonly column: number }

const csiFinal = /[@-~]/
const lonelyEscapeMs = 40

export class InputParser {
    private buffer = ""
    private cursorQueries = 0

    // 发出光标位置查询后调用；只有确有未应答的查询时，ESC[行;列R 才按应答处理（否则可能是带修饰的 F3）
    expectCursorReport(): void { this.cursorQueries++ }

    feed(text: string): InputEvent[] {
        this.buffer += text
        const events: InputEvent[] = []
        while (this.buffer.length) {
            const consumed = this.parseOne(events)
            if (consumed === 0) break
            this.buffer = this.buffer.slice(consumed)
        }
        return events
    }

    get pending(): boolean { return this.buffer.length > 0 }

    // 超时后仍不完整的转义序列：单独的 ESC 视为 Esc 键，其余丢弃
    flush(): InputEvent[] {
        const events: InputEvent[] = this.buffer === "\x1b" ? [{ kind: "key", key: "escape" }] : []
        this.buffer = ""
        return events
    }

    // 返回消耗的字符数；0 表示序列不完整，需要等待后续输入
    private parseOne(events: InputEvent[]): number {
        const text = this.buffer
        const first = text[0]!
        if (first !== "\x1b") {
            if (first === "\x03") events.push({ kind: "key", key: "interrupt" })
            else if (first === "\t") events.push({ kind: "key", key: "tab" })
            else if (first === "\r" || first === "\n") events.push({ kind: "key", key: "enter" })
            else if (first >= " " && first !== "\x7f") {
                const character = String.fromCodePoint(text.codePointAt(0)!)
                events.push({ kind: "key", key: "char", text: character })
                return character.length
            }
            return 1
        }
        if (text.length === 1) return 0
        const second = text[1]!
        if (second === "[") return this.parseCsi(text, events)
        if (second === "O") {
            if (text.length < 3) return 0
            const key = ({ A: "up", B: "down", C: "right", D: "left", H: "home", F: "end" } as const)[text[2] as "A"]
            if (key) events.push({ kind: "key", key })
            return 3
        }
        if (second === "\x1b") {
            events.push({ kind: "key", key: "escape" })
            return 1
        }
        // Alt+字符等：不处理，整体丢弃
        return 2
    }

    private parseCsi(text: string, events: InputEvent[]): number {
        let end = 2
        while (end < text.length && !csiFinal.test(text[end]!)) end++
        if (end >= text.length) return text.length > 64 ? text.length : 0
        const body = text.slice(2, end)
        const final = text[end]!
        const length = end + 1
        if (body.startsWith("<") && (final === "M" || final === "m")) {
            const [button, column, row] = body.slice(1).split(";").map(Number)
            if (button === undefined || column === undefined || row === undefined || [button, column, row].some(Number.isNaN)) return length
            if (final === "M" && (button & 64) !== 0) events.push({ kind: "wheel", direction: (button & 1) === 0 ? "up" : "down", column, row })
            else if (final === "M" && (button & (3 | 32 | 64)) === 0) events.push({ kind: "click", column, row })
            return length
        }
        const parameters = body.split(";")
        if (final === "R" && this.cursorQueries > 0 && parameters.length === 2) {
            this.cursorQueries--
            events.push({ kind: "cursor", row: Number(parameters[0]), column: Number(parameters[1]) })
            return length
        }
        const letters: Partial<Record<string, KeyName>> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "backtab" }
        if (letters[final]) {
            events.push({ kind: "key", key: letters[final]! })
            return length
        }
        if (final === "~") {
            const tildes: Partial<Record<string, KeyName>> = { "1": "home", "7": "home", "4": "end", "8": "end", "5": "pageup", "6": "pagedown" }
            const key = tildes[parameters[0] ?? ""]
            if (key) events.push({ kind: "key", key })
        }
        return length
    }
}

const enableMouse = "\x1b[?1000h\x1b[?1006h"
const disableMouse = "\x1b[?1006l\x1b[?1000l"

// 任务会话的输入：从控制台输入接管文本，解析成按键、滚轮与光标应答；会话期间开启鼠标上报
export class TerminalInput {
    private readonly parser = new InputParser()
    private escapeTimer: ReturnType<typeof setTimeout> | undefined
    private detach: (() => void) | undefined

    constructor(private readonly console: ConsoleInput, private readonly write: (sequence: string) => void, private readonly onEvent: (event: InputEvent) => void) { }

    get available(): boolean { return this.console.available }
    get active(): boolean { return this.detach !== undefined }

    start(): boolean {
        if (this.detach || !this.available) return this.active
        this.detach = this.console.attach(text => this.receive(text))
        this.write(enableMouse)
        return true
    }

    stop(): void {
        if (!this.detach) return
        this.detach()
        this.detach = undefined
        this.write(disableMouse)
        if (this.escapeTimer) clearTimeout(this.escapeTimer)
        this.escapeTimer = undefined
        this.parser.flush()
    }

    queryCursor(): void {
        if (!this.detach) return
        this.parser.expectCursorReport()
        this.write("\x1b[6n")
    }

    private receive(text: string): void {
        if (this.escapeTimer) clearTimeout(this.escapeTimer)
        this.escapeTimer = undefined
        for (const event of this.parser.feed(text)) this.dispatch(event)
        if (this.parser.pending) this.escapeTimer = setTimeout(() => {
            this.escapeTimer = undefined
            for (const event of this.parser.flush()) this.dispatch(event)
        }, lonelyEscapeMs)
    }

    private dispatch(event: InputEvent): void {
        if (event.kind === "key" && event.key === "interrupt") this.console.interrupt()
        else this.onEvent(event)
    }
}
