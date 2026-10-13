import { fit, hasSgr, padEnd, resetSgr, stripAnsi, truncate, visibleWidth, wrap } from "./Ansi.ts"
import { LogBuffer, LogViewport, type LogWindow } from "./LogView.ts"
import type { InputEvent } from "./Input.ts"
import type { LiveView } from "./Screen.ts"
import { formatDuration, spinnerFrames, spinnerIntervalMs, symbols, type Palette } from "./Theme.ts"

// gradle 式任务面板：每个运行中的任务一行标题（转圈、进度、用时），下面一个固定高度、可滚动的日志框
// 任务完成后从面板移除，由调用方把 summary() 写进滚动历史；常驻窗格（dev）在会话结束前一直显示

export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled"
export type Tone = "info" | "success" | "warn" | "error"

export interface BoardTaskInit {
    readonly id: string
    readonly title: string
    readonly detail?: string
    // task：带日志框的任务；pane：常驻窗格（dev）；status：只有一行转圈的临时状态，结束后不留痕
    readonly kind?: "task" | "pane" | "status"
}

export class BoardTask {
    readonly id: string
    readonly title: string
    readonly kind: "task" | "pane" | "status"
    detail: string | undefined
    status: TaskStatus = "running"
    readonly startedAt: number
    endedAt: number | undefined
    stage: string | undefined
    progress: { readonly done: number, readonly total: number } | undefined
    note: { readonly text: string, readonly tone: Tone } | undefined
    failure: string | undefined
    logPath: string | undefined
    readonly buffer: LogBuffer
    readonly viewport: LogViewport

    constructor(init: BoardTaskInit, now: number, capacity?: number) {
        this.id = init.id
        this.title = init.title
        this.detail = init.detail
        this.kind = init.kind ?? "task"
        this.startedAt = now
        this.buffer = new LogBuffer(capacity)
        this.viewport = new LogViewport(this.buffer)
    }
}

interface BoxLayout {
    readonly task: BoardTask
    readonly top: number
    readonly bottom: number
    readonly contentHeight: number
    readonly innerWidth: number
}

const railWidth = 3
const boxChrome = 4
const taskContentRows = 8
const minimumContentRows = 2
const wheelRows = 3
const failureTailRows = 200
const errorLine = /(?:\berror\b|\bfatal\b|错误|失败|ERR!|ERR_)/i
const warningLine = /(?:\bwarning\b|\bwarn\b|警告)/i

export class TaskBoard implements LiveView {
    private readonly tasks: BoardTask[] = []
    private focusedId: string | undefined
    private boxes: BoxLayout[] = []
    private renderedWidth = 80
    showHints = false

    constructor(private readonly palette: Palette, private readonly now: () => number = Date.now) { }

    get size(): number { return this.tasks.length }
    // 是否有带日志框（可滚动）的任务
    get hasFramed(): boolean { return this.tasks.some(task => task.kind !== "status") }

    add(init: BoardTaskInit): BoardTask {
        const task = new BoardTask(init, this.now())
        this.tasks.push(task)
        this.focusedId ??= task.id
        return task
    }

    remove(task: BoardTask): void {
        const index = this.tasks.indexOf(task)
        if (index < 0) return
        this.tasks.splice(index, 1)
        if (this.focusedId === task.id) this.focusedId = this.tasks[Math.min(index, this.tasks.length - 1)]?.id
    }

    // 记录一行日志：子进程未自带颜色时，为错误、警告行着色（MSVC 等工具不输出颜色）
    append(task: BoardTask, line: string): void {
        task.buffer.append(this.highlight(line))
    }

    highlight(line: string): string {
        if (hasSgr(line)) return line
        if (errorLine.test(line)) return this.palette.paint("red", line)
        if (warningLine.test(line)) return this.palette.paint("yellow", line)
        return line
    }

    render(width: number, height: number): string[] {
        this.renderedWidth = width
        const { paint } = this.palette
        const bar = paint("gray", symbols.bar)
        const rows: string[] = [bar]
        const boxes: BoxLayout[] = []
        const visible = this.tasks
        const framed = visible.filter(task => task.kind !== "status")
        const footer = this.showHints && framed.length ? 2 : 0
        const available = height - 1 - footer
        if (!visible.length || available <= 0) {
            this.boxes = []
            return rows
        }
        const innerWidth = width - railWidth - boxChrome
        // 状态行只占一行；其余空间平均分给带框的任务
        const perTask = framed.length ? Math.floor((available - (visible.length - framed.length)) / framed.length) : 0
        const boxed = framed.length > 0 && innerWidth >= 10 && perTask - 3 >= minimumContentRows
        const shown = boxed ? visible : visible.slice(0, Math.max(0, available - (visible.length > available ? 1 : 0)))
        for (const task of shown) {
            rows.push(this.header(task, width))
            if (!boxed || task.kind === "status") continue
            const contentHeight = task.kind === "pane" ? perTask - 3 : Math.min(taskContentRows, perTask - 3)
            const top = rows.length
            rows.push(...this.box(task, innerWidth, contentHeight))
            boxes.push({ task, top, bottom: rows.length - 1, contentHeight, innerWidth })
        }
        if (shown.length < visible.length) rows.push(`${bar}  ${paint("dim", `还有 ${visible.length - shown.length} 个任务…`)}`)
        if (this.showHints && boxed) {
            rows.push(bar)
            rows.push(`${bar}  ${paint("dim", truncate(this.hints(framed.length, width - railWidth), width - railWidth))}`)
        }
        this.boxes = boxes
        return rows
    }

    // 处理输入；regionTop 为实时区域首行在屏幕上的行号（1 起），未知时滚轮作用于焦点框
    handle(event: InputEvent, regionTop: number | undefined): boolean {
        if (!this.boxes.length) return false
        const focused = this.boxes.find(box => box.task.id === this.focusedId) ?? this.boxes[0]!
        const scroll = (box: BoxLayout, delta: number): boolean => {
            box.task.viewport.scroll(delta, box.innerWidth, box.contentHeight)
            return true
        }
        if (event.kind === "wheel") {
            // 在哪个框上滚动，焦点就移到哪个框，随后的按键（End、翻页）作用于同一个框
            const target = regionTop === undefined ? focused : this.boxAt(event.row - regionTop) ?? focused
            this.focusedId = target.task.id
            return scroll(target, event.direction === "up" ? -wheelRows : wheelRows)
        }
        if (event.kind === "click") {
            const target = regionTop === undefined ? undefined : this.boxAt(event.row - regionTop)
            if (!target || target.task.id === this.focusedId) return false
            this.focusedId = target.task.id
            return true
        }
        if (event.kind !== "key") return false
        switch (event.key) {
            case "up": return scroll(focused, -1)
            case "down": return scroll(focused, 1)
            case "pageup": return scroll(focused, -Math.max(1, focused.contentHeight - 1))
            case "pagedown": return scroll(focused, Math.max(1, focused.contentHeight - 1))
            case "home":
                focused.task.viewport.toTop(focused.innerWidth, focused.contentHeight)
                return true
            case "end":
                focused.task.viewport.toBottom()
                return true
            case "tab":
            case "backtab": {
                if (this.boxes.length < 2) return false
                const index = this.boxes.indexOf(focused)
                const next = (index + (event.key === "tab" ? 1 : this.boxes.length - 1)) % this.boxes.length
                this.focusedId = this.boxes[next]!.task.id
                return true
            }
            default: return false
        }
    }

    // 任务结束后写进滚动历史的内容：成功一行；失败附带最后一段日志与完整日志路径
    summary(task: BoardTask, width: number = this.renderedWidth): string[] {
        const { paint } = this.palette
        const bar = paint("gray", symbols.bar)
        const elapsed = paint("dim", formatDuration((task.endedAt ?? this.now()) - task.startedAt))
        const title = `${task.title}${task.detail ? paint("dim", ` · ${task.detail}`) : ""}`
        const note = task.kind === "pane" && task.note ? `  ${this.tone(task.note.tone, task.note.text)}` : ""
        const log = task.logPath ? [`${bar}  ${paint("dim", `完整日志：${task.logPath}`)}`] : []
        if (task.status === "succeeded" || task.status === "running") return [bar, `${paint("green", symbols.step)}  ${title}${note}  ${elapsed}`, ...(task.kind === "pane" ? log : [])]
        if (task.status === "cancelled") return [bar, `${paint("yellow", symbols.cancel)}  ${title} ${paint("yellow", "已取消")}  ${elapsed}`]
        const lines = [bar, `${paint("red", symbols.error)}  ${title} ${paint("red", "失败")}  ${elapsed}`]
        if (task.failure) for (const row of wrap(task.failure, Math.max(10, width - railWidth))) lines.push(`${bar}  ${paint("red", row)}`)
        lines.push(...this.staticBox(task, width, "red", task.kind === "pane" ? 60 : failureTailRows), ...log)
        return lines
    }

    // 不可交互的静态框：日志末尾若干行
    staticBox(task: BoardTask, width: number, color: "red" | "gray" = "gray", maximumRows = failureTailRows): string[] {
        const { paint } = this.palette
        const bar = paint("gray", symbols.bar)
        const innerWidth = Math.max(10, width - railWidth - boxChrome)
        const tail = task.buffer.tail(maximumRows)
        if (task.buffer.partial) tail.push(task.buffer.partial)
        if (!tail.length) return []
        const rows: string[] = []
        for (const line of tail) rows.push(...wrap(line, innerWidth))
        const shown = rows.slice(Math.max(0, rows.length - maximumRows))
        const edge = (text: string): string => paint(color, text)
        const total = task.buffer.nextSeq
        const label = total > tail.length ? ` 共 ${total} 行 · 最后 ${tail.length} 行 ` : ` 共 ${total} 行 `
        const result = [`${bar}  ${edge(symbols.cornerTopLeft + symbols.horizontal.repeat(innerWidth + 2) + symbols.cornerTopRight)}`]
        for (const row of shown) result.push(`${bar}  ${edge(symbols.bar)} ${padEnd(row, innerWidth)}${resetSgr} ${edge(symbols.bar)}`)
        result.push(`${bar}  ${this.bottomBorder(innerWidth, paint("dim", truncate(label, innerWidth)), edge)}`)
        return result
    }

    // 按可用宽度选择完整、紧凑或最简的操作提示，保证“Ctrl+C 取消”总能显示
    private hints(count: number, width: number): string {
        const tab = count > 1 ? ["Tab 切换"] : []
        const variants = [
            ["滚轮/↑↓/PgUp/PgDn 滚动", "Home/End 顶部/跟随", ...tab, "Shift+拖动 选择文字", "Ctrl+C 取消"],
            ["滚轮/↑↓ 滚动", "End 跟随", ...tab, "Ctrl+C 取消"],
            ["↑↓ 滚动", "Ctrl+C 取消"],
        ].map(parts => parts.join(" · "))
        return variants.find(text => visibleWidth(text) <= width) ?? variants.at(-1)!
    }

    private boxAt(row: number): BoxLayout | undefined {
        // row 为相对实时区域首行的偏移；框的范围包含其标题行
        return this.boxes.find(box => row >= box.top - 1 && row <= box.bottom)
    }

    private header(task: BoardTask, width: number): string {
        const { paint } = this.palette
        const now = this.now()
        const elapsed = paint("dim", formatDuration(now - task.startedAt))
        const right: string[] = []
        if (task.progress && task.progress.total > 0) {
            const barWidth = Math.max(8, Math.min(24, Math.floor(width / 6)))
            right.push(this.progressBar(task.progress.done / task.progress.total, barWidth), paint("dim", `${task.progress.done}/${task.progress.total}`))
        }
        if (task.note) right.push(this.tone(task.note.tone, task.note.text))
        right.push(elapsed)
        const rightText = right.join("  ")
        const symbol = this.statusSymbol(task, now)
        const left = `${symbol}  ${task.title}${task.detail ? paint("dim", ` · ${task.detail}`) : ""}${task.stage ? paint("dim", ` · ${stripAnsi(task.stage)}`) : ""}`
        const space = width - visibleWidth(rightText) - 2
        if (space < 12) return truncate(left, width)
        return `${padEnd(truncate(left, space), space)}  ${rightText}`
    }

    private statusSymbol(task: BoardTask, now: number): string {
        const { paint } = this.palette
        if (task.status === "failed") return paint("red", symbols.error)
        if (task.status === "cancelled") return paint("yellow", symbols.cancel)
        if (task.status === "succeeded") return paint("green", symbols.step)
        if (task.kind === "pane" && task.note?.tone === "success") return paint("green", symbols.info)
        return paint("magenta", spinnerFrames[Math.floor((now - task.startedAt) / spinnerIntervalMs) % spinnerFrames.length]!)
    }

    private progressBar(ratio: number, width: number): string {
        const { paint } = this.palette
        const clamped = Math.max(0, Math.min(1, ratio))
        const full = Math.floor(clamped * width)
        const head = full < width && clamped > 0 ? 1 : 0
        return paint("cyan", symbols.progressFull.repeat(full) + (head ? symbols.progressHead : "")) + paint("gray", symbols.progressEmpty.repeat(width - full - head))
    }

    private tone(tone: Tone, text: string): string {
        return this.palette.paint(tone === "success" ? "green" : tone === "warn" ? "yellow" : tone === "error" ? "red" : "cyan", text)
    }

    private box(task: BoardTask, innerWidth: number, contentHeight: number): string[] {
        const { paint } = this.palette
        const bar = paint("gray", symbols.bar)
        const focused = task.id === this.focusedId && this.showHints && this.tasks.length > 1
        const edge = (text: string): string => paint(focused ? "cyan" : "gray", text)
        const window: LogWindow = task.viewport.window(innerWidth, contentHeight)
        const topLabel = window.linesAbove > 0 && !window.following ? paint("yellow", ` ${symbols.arrowUp} ${window.linesAbove} 行 `) : task.buffer.dropped > 0 && window.linesAbove === 0 && !window.following ? paint("dim", ` 更早 ${task.buffer.dropped} 行见日志文件 `) : ""
        const rows = [`${bar}  ${this.topBorder(innerWidth, topLabel, edge)}`]
        const content = window.rows.length ? window.rows : [paint("dim", "等待输出…")]
        for (let index = 0; index < contentHeight; index++) rows.push(`${bar}  ${edge(symbols.bar)} ${fit(content[index] ?? "", innerWidth)}${resetSgr} ${edge(symbols.bar)}`)
        const count = task.buffer.nextSeq
        const bottomLabel = window.following ? paint("dim", ` ${count} 行 `) : paint("yellow", ` ${symbols.arrowDown} ${window.linesBelow} 行 · End 跟随 `)
        rows.push(`${bar}  ${this.bottomBorder(innerWidth, bottomLabel, edge)}`)
        return rows
    }

    private topBorder(innerWidth: number, label: string, edge: (text: string) => string): string {
        const labelWidth = visibleWidth(label)
        const total = innerWidth + 2
        if (!label || labelWidth + 2 > total) return edge(symbols.cornerTopLeft + symbols.horizontal.repeat(total) + symbols.cornerTopRight)
        return edge(symbols.cornerTopLeft + symbols.horizontal.repeat(total - labelWidth - 1)) + label + edge(symbols.horizontal + symbols.cornerTopRight)
    }

    private bottomBorder(innerWidth: number, label: string, edge: (text: string) => string): string {
        const labelWidth = visibleWidth(label)
        const total = innerWidth + 2
        if (!label || labelWidth + 2 > total) return edge(symbols.cornerBottomLeft + symbols.horizontal.repeat(total) + symbols.cornerBottomRight)
        return edge(symbols.cornerBottomLeft + symbols.horizontal.repeat(total - labelWidth - 1)) + label + edge(symbols.horizontal + symbols.cornerBottomRight)
    }
}
