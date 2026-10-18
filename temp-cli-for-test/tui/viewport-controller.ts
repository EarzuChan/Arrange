import { CONSOLE_HEIGHT, hitTest, layoutDocument, viewport, ScreenRenderer } from './view.js'
import type { SessionDocument } from './document.ts'

// 滚动状态属于视图层，业务更新和终端缩放都不取得键盘焦点
export class ViewportController {
    private readonly document: SessionDocument
    private readonly terminal: { columns: number, rows: number, writeFrame(frame: string): void }
    private readonly screen = new ScreenRenderer()
    private historyOffset = Number.MAX_SAFE_INTEGER
    private readonly consoleOffsets: Record<string, number> = {}
    private view: ReturnType<typeof viewport> | undefined

    constructor(document: SessionDocument, terminal: { columns: number, rows: number, writeFrame(frame: string): void }) {
        this.document = document
        this.terminal = terminal
    }

    render(frame = 0): void {
        const following = !this.view || this.historyOffset === this.view.maxOffset
        const rows = layoutDocument(this.document, this.terminal.columns, this.consoleOffsets, frame)
        if (following) this.historyOffset = Math.max(0, rows.length - this.terminal.rows)
        this.view = viewport(rows, this.terminal.columns, this.terminal.rows, this.historyOffset)
        this.historyOffset = this.view.offset
        this.terminal.writeFrame(this.screen.frame(this.view))
    }

    followTail(): void { this.historyOffset = this.view?.maxOffset ?? Number.MAX_SAFE_INTEGER }

    wheel(x: number, y: number, delta: number): void {
        if (!this.view) return
        const target = hitTest(this.view, x, y)
        if (target?.kind === 'console') {
            const task = this.document.entries.flatMap(entry => entry.type === 'batch' ? entry.tasks : []).find(task => task.id === target.id)
            if (!task?.console) return
            const max = Math.max(0, task.console.lines.length - CONSOLE_HEIGHT)
            const offset = Math.max(0, Math.min(max, (this.consoleOffsets[task.id] ?? max) + delta * 3))
            // 滚回底部即恢复跟随，后续输出不再停留在旧的末行位置
            if (offset === max) delete this.consoleOffsets[task.id]
            else this.consoleOffsets[task.id] = offset
        } else if (target) this.historyOffset = Math.max(0, Math.min(this.view.maxOffset, this.historyOffset + delta * 3))
    }

    key(name: string): boolean {
        if (!this.view) return false
        if (name === 'pageup') this.historyOffset -= Math.max(1, this.view.height - 2)
        else if (name === 'pagedown') this.historyOffset += Math.max(1, this.view.height - 2)
        else if (name === 'home') this.historyOffset = 0
        else if (name === 'end') this.historyOffset = this.view.maxOffset
        else return false
        this.historyOffset = Math.max(0, Math.min(this.view.maxOffset, this.historyOffset))
        return true
    }
}
