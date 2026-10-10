import { visibleWidth, truncate } from "./Ansi.ts"
import { paletteFor, type Palette } from "./Theme.ts"

// 实时区域：固定在输出末尾、可反复重绘的一块屏幕。持久输出（日志、完成的任务）写在它上方进入滚动历史。
// 采用“擦除上一帧 + 整帧重绘”：每帧以换行结束，光标停在区域下方的空行行首；重绘时上移区域所占的行数、清除到屏幕底部后写新帧。
// 光标所在行为空，窗口缩放时无论终端是否重排光标行（Windows Terminal 会，xterm.js 不会），区域所占行数都能按同一规则算出。

export interface LiveView {
    // width 为可用列数（已为光标预留最后一列），height 为最多可用行数
    render(width: number, height: number): string[]
}

// 屏幕只需要输出流的这些能力；process.stdout/stderr 与测试里的模拟终端都满足
export interface ScreenStream {
    readonly isTTY?: boolean
    readonly columns?: number
    readonly rows?: number
    hasColors?(): boolean
    write(chunk: string): unknown
    on(event: "resize", listener: () => void): unknown
    off(event: "resize", listener: () => void): unknown
}

interface Frame {
    readonly text: string
    readonly lines: readonly string[]
    readonly widths: readonly number[]
}

const beginSynchronized = "\x1b[?2026h"
const endSynchronized = "\x1b[?2026l"
const hideCursor = "\x1b[?25l"
const showCursor = "\x1b[?25h"
const eraseDown = "\x1b[J"
// 终端里换行写成回车加换行：不依赖终端驱动把 LF 转成 CRLF（原始模式、ConPTY 等环境未必转换）
const newline = "\r\n"
const frameIntervalMs = 40
const emptyFrame: Frame = { text: "", lines: [], widths: [] }

export class Screen {
    readonly palette: Palette
    private view: LiveView | undefined
    private drawn: Frame = emptyFrame
    private drawnColumns = 0
    private timer: ReturnType<typeof setTimeout> | undefined
    private lastFrameAt = 0
    private writeListeners: ((frame: { readonly height: number, readonly heightChanged: boolean }) => void)[] = []
    private readonly resizeListener = (): void => this.renderNow(true)
    private readonly exitListener = (): void => this.restoreOnExit()

    constructor(readonly out: ScreenStream = process.stdout as ScreenStream, readonly err: ScreenStream = process.stderr as ScreenStream) {
        this.palette = paletteFor(out)
    }

    get interactive(): boolean { return this.out.isTTY === true }
    get columns(): number { return Math.max(20, this.out.columns ?? 80) }
    get rows(): number { return Math.max(6, this.out.rows ?? 24) }
    get mounted(): boolean { return this.view !== undefined }
    get regionHeight(): number { return this.drawn.widths.length }

    // 写入持久内容；实时区域存在时先擦除、写入后重绘。TTY 下统一走 stdout，避免两条流在 Windows 上异步交错
    print(text: string | readonly string[], stream: "stdout" | "stderr" = "stdout"): void {
        const lines = typeof text === "string" ? text.split("\n") : text
        if (!this.interactive) {
            (stream === "stderr" ? this.err : this.out).write(lines.join("\n") + "\n")
            return
        }
        const body = lines.join(newline) + newline
        if (!this.view) {
            this.out.write(body)
            return
        }
        const frame = this.compose()
        this.out.write(beginSynchronized + this.eraseSequence() + body + frame.text + endSynchronized)
        this.commit(frame, true)
    }

    mount(view: LiveView): void {
        if (this.view) throw new Error("实时区域已存在")
        this.view = view
        if (!this.interactive) return
        this.out.write(hideCursor)
        this.out.on("resize", this.resizeListener)
        process.on("exit", this.exitListener)
        this.renderNow(true)
    }

    // 卸下实时区域；finalLines 以持久内容写在原区域位置
    unmount(finalLines: readonly string[] = []): void {
        if (!this.view) return
        this.cancelTimer()
        if (this.interactive) {
            const tail = finalLines.length ? finalLines.join(newline) + newline : ""
            this.out.off("resize", this.resizeListener)
            process.off("exit", this.exitListener)
            this.out.write(beginSynchronized + this.eraseSequence() + tail + showCursor + endSynchronized)
        } else if (finalLines.length) this.out.write(finalLines.join("\n") + "\n")
        this.view = undefined
        this.drawn = emptyFrame
    }

    // 请求重绘；按帧间隔合并，避免高频输出时刷屏
    invalidate(): void {
        if (!this.view || !this.interactive || this.timer) return
        const wait = Math.max(0, frameIntervalMs - (Date.now() - this.lastFrameAt))
        this.timer = setTimeout(() => {
            this.timer = undefined
            this.renderNow()
        }, wait)
    }

    renderNow(force = false): void {
        this.cancelTimer()
        if (!this.view || !this.interactive) return
        const frame = this.compose()
        if (!force && frame.text === this.drawn.text && this.drawnColumns === this.columns) return
        // 行数与列数都没变时只重写变化的行（转圈、计时、新日志通常只改几行），其余情况整帧重绘
        const patch = force || this.drawnColumns !== this.columns ? undefined : this.patchSequence(this.drawn, frame)
        this.out.write(beginSynchronized + (patch ?? this.eraseSequence() + frame.text) + endSynchronized)
        this.commit(frame, force)
    }

    // 光标从区域下方的空行出发，逐个移到变化的行重写，最后回到空行行首；行数不同时返回 undefined
    private patchSequence(previous: Frame, next: Frame): string | undefined {
        const height = next.lines.length
        if (!height || previous.lines.length !== height) return undefined
        let output = ""
        let row = height
        const moveTo = (target: number): string => target < row ? `\x1b[${row - target}A` : target > row ? `\x1b[${target - row}B` : ""
        for (let index = 0; index < height; index++) {
            if (next.lines[index] === previous.lines[index]) continue
            output += `${moveTo(index)}\r\x1b[2K${next.lines[index]}`
            row = index
        }
        return output + moveTo(height) + "\r"
    }

    // 每次写出帧后通知（用于查询光标位置，定位实时区域在屏幕上的行）
    onWrite(listener: (frame: { readonly height: number, readonly heightChanged: boolean }) => void): () => void {
        this.writeListeners.push(listener)
        return () => { this.writeListeners = this.writeListeners.filter(item => item !== listener) }
    }

    write(sequence: string): void {
        if (this.interactive) this.out.write(sequence)
    }

    private compose(): Frame {
        if (!this.view) return emptyFrame
        const width = this.columns - 1
        const height = Math.max(1, this.rows - 1)
        let lines = this.view.render(width, height)
        if (lines.length > height) lines = lines.slice(lines.length - height)
        lines = lines.map(line => visibleWidth(line) > width ? truncate(line, width) : line)
        return { text: lines.length ? lines.join(newline) + newline : "", lines, widths: lines.map(line => visibleWidth(line)) }
    }

    private commit(frame: Frame, moved: boolean): void {
        const heightChanged = moved || frame.widths.length !== this.drawn.widths.length
        this.drawn = frame
        this.drawnColumns = this.columns
        this.lastFrameAt = Date.now()
        for (const listener of this.writeListeners) listener({ height: frame.widths.length, heightChanged })
    }

    // 从区域下方的空行回到上一帧首行并清除到屏幕底部；终端缩窄并重排后，原来的一行可能占多行，按当前列数计算
    private eraseSequence(): string {
        const widths = this.drawn.widths
        if (!widths.length) return ""
        const columns = this.columns
        let physical = 0
        for (const width of widths) physical += Math.max(1, Math.ceil(width / columns))
        return `\r\x1b[${physical}A${eraseDown}`
    }

    private cancelTimer(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = undefined
    }

    private restoreOnExit(): void {
        if (!this.view) return
        this.view = undefined
        try { this.out.write(showCursor) } catch { }
    }
}
