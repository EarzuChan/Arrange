import { EventEmitter } from "node:events"
import xterm from "@xterm/headless"

// 用真实的终端模拟器（xterm.js 无头版）回放 CLI 写出的转义序列，再读回屏幕与滚动历史，
// 以断言“用户实际看到的内容”，而不是断言写出了哪些字节

export class EmulatedTty extends EventEmitter {
    readonly isTTY = true
    readonly terminal: InstanceType<typeof xterm.Terminal>
    private pending: Promise<void> = Promise.resolve()
    readonly written: string[] = []

    constructor(public columns: number, public rows: number) {
        super()
        this.terminal = new xterm.Terminal({ cols: columns, rows, scrollback: 5000, allowProposedApi: true })
    }

    hasColors(): boolean { return true }

    write(chunk: string | Uint8Array): boolean {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
        this.written.push(text)
        this.pending = this.pending.then(() => new Promise<void>(resolve => this.terminal.write(text, () => resolve())))
        return true
    }

    // 模拟用户调整窗口：终端先重排，再通知程序
    async resize(columns: number, rows: number): Promise<void> {
        await this.flush()
        this.columns = columns
        this.rows = rows
        this.terminal.resize(columns, rows)
        this.emit("resize")
        await this.flush()
    }

    flush(): Promise<void> { return this.pending }

    // 滚动历史加屏幕的全部行（去掉行尾空白；把软折行接回一行）
    async lines(): Promise<string[]> {
        await this.flush()
        const buffer = this.terminal.buffer.active
        const result: string[] = []
        for (let index = 0; index < buffer.length; index++) {
            const line = buffer.getLine(index)
            if (!line) continue
            const text = line.translateToString(true)
            if (line.isWrapped && result.length) result[result.length - 1] += text
            else result.push(text)
        }
        while (result.length && result.at(-1) === "") result.pop()
        return result
    }

    // 当前屏幕上可见的行
    async screen(): Promise<string[]> {
        await this.flush()
        const buffer = this.terminal.buffer.active
        const result: string[] = []
        for (let index = buffer.viewportY; index < buffer.viewportY + this.rows; index++) result.push(buffer.getLine(index)?.translateToString(true) ?? "")
        return result
    }

    async cursorRow(): Promise<number> {
        await this.flush()
        return this.terminal.buffer.active.cursorY + 1
    }
}
