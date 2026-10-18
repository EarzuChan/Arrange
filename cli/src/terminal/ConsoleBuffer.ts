import xterm from "@xterm/headless"
import type { IBufferCell, IBufferLine } from "@xterm/headless"

function color(cell: IBufferCell, background: boolean): string | undefined {
    if (background ? cell.isBgDefault() : cell.isFgDefault()) return undefined
    const rgb = background ? cell.isBgRGB() : cell.isFgRGB()
    const indexed = background ? cell.isBgPalette() : cell.isFgPalette()
    const value = background ? cell.getBgColor() : cell.getFgColor()
    const base = background ? 48 : 38
    return rgb ? `${base};2;${value >> 16 & 255};${value >> 8 & 255};${value & 255}` : indexed ? `${base};5;${value}` : background ? "49" : "39"
}

function styledLine(line: IBufferLine | undefined): string {
    if (!line) return ""
    const length = line.translateToString(true).length
    if (!length) return ''
    let result = ""
    let previous = ""
    let characters = 0
    for (let index = 0; index < line.length && characters < length; index++) {
        const cell = line.getCell(index)!
        if (cell.getWidth() === 0) continue
        const style = ["0", color(cell, false), color(cell, true), ...(cell.isBold() ? ["1"] : []), ...(cell.isDim() ? ["2"] : []), ...(cell.isItalic() ? ["3"] : []), ...(cell.isUnderline() ? ["4"] : []), ...(cell.isInverse() ? ["7"] : [])].filter(Boolean).join(";")
        if (style !== previous) {
            result += `\x1b[${style}m`
            previous = style
        }
        const text = cell.getChars() || " "
        result += text
        characters += text.length
    }
    return result.replace(/^(?:\x1b\[0m)+/, "").trimEnd() + (result.includes("\x1b[") ? "\x1b[0m" : "")
}

// ANSI 解析资源只在执行期间存在，文档保留独立的可滚动荧幕内容
export class ConsoleBuffer {
    private readonly terminal = new xterm.Terminal({ cols: 4096, rows: 6, scrollback: 1, allowProposedApi: true, convertEol: true })
    private pending: Promise<void> = Promise.resolve()
    private queued: string[] = []
    private scheduled = false
    private readonly history: string[] = []
    private ending = false
    private closed = false
    constructor(private readonly publish: (lines: string[]) => void) {
        this.terminal.onScroll(() => {
            const buffer = this.terminal.buffer.active
            // 留一行滚动缓冲，在 xterm 完成滚动后接走刚离开屏幕的行
            if (buffer.baseY > 0) this.collect(this.history, buffer.getLine(buffer.baseY - 1))
        })
        this.terminal.parser.registerCsiHandler({ final: 'J' }, params => {
            if (params[0] === 2 || params[0] === 3) this.archiveScreen()
            return false
        })
        this.terminal.parser.registerEscHandler({ final: 'c' }, () => {
            this.archiveScreen()
            return false
        })
        for (const final of ['h', 'l']) this.terminal.parser.registerCsiHandler({ prefix: '?', final }, params => {
            if (params.some(value => value === 47 || value === 1047 || value === 1049)) this.archiveScreen()
            return false
        })
    }
    private collect(lines: string[], line: IBufferLine | undefined): void {
        if (!line) return
        const text = styledLine(line)
        if (line.isWrapped && lines.length) lines[lines.length - 1] += text
        else lines.push(text)
    }
    private screen(lines: string[]): void {
        const buffer = this.terminal.buffer.active
        let end = buffer.cursorY
        for (let index = this.terminal.rows - 1; index > end; index--) if (buffer.getLine(buffer.baseY + index)?.translateToString(true)) {
            end = index
            break
        }
        for (let index = 0; index <= end; index++) this.collect(lines, buffer.getLine(buffer.baseY + index))
        while (lines.length && !lines.at(-1)) lines.pop()
    }
    private archiveScreen(): void {
        this.screen(this.history)
    }
    write(data: string): void {
        if (this.ending) throw new Error('控制台解析已结束')
        this.queued.push(data)
        if (!this.scheduled) {
            this.scheduled = true
            this.pending = this.pending.then(async () => {
                while (this.queued.length) {
                    const chunk = this.queued.splice(0).join('')
                    await new Promise<void>(resolve => this.terminal.write(chunk, resolve))
                }
                this.snapshot()
            }).finally(() => { this.scheduled = false })
        }
    }
    private snapshot(): void {
        const lines = [...this.history]
        this.screen(lines)
        this.publish(lines)
    }
    async finish(): Promise<void> {
        this.ending = true
        if (this.closed) return
        try {
            await this.pending
            this.snapshot()
        }
        finally {
            this.closed = true
            this.terminal.dispose()
        }
    }
}
