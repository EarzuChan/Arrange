import type { PromptContent, SessionDocument } from './SessionDocument.ts'
import { consoleHeight, layoutDocument } from './DocumentRenderer.ts'
import { hitTest, viewport, type View } from './LayoutModel.ts'
import { ScreenRenderer } from './ScreenRenderer.ts'

// 历史和荧幕没有焦点，鼠标仅通过绘制几何命中独立视口
export class ViewportController {
    private historyOffset = Number.MAX_SAFE_INTEGER
    private readonly offsets: Record<string, number> = {}
    private view?: View
    private readonly renderer = new ScreenRenderer()
    constructor(private readonly document: SessionDocument, private readonly terminal: { columns: number, rows: number, writeFrame(frame: string): void }) { }
    render(frame: number, prompt?: PromptContent): void {
        const ids = new Set([...this.document.contents()].flatMap(entry => entry.type === 'batch' ? entry.tasks.map(task => task.id) : []))
        for (const id of Object.keys(this.offsets)) if (!ids.has(id)) delete this.offsets[id]
        const following = !this.view || this.historyOffset === this.view.maxOffset
        const rows = layoutDocument(this.document, this.terminal.columns, this.offsets, frame, prompt, false, this.terminal.rows)
        if (following) this.historyOffset = Math.max(0, rows.length - this.terminal.rows)
        this.view = viewport(rows, this.terminal.columns, this.terminal.rows, this.historyOffset)
        this.historyOffset = this.view.offset
        this.terminal.writeFrame(this.renderer.frame(this.view))
    }
    followTail(): void { this.historyOffset = this.view?.maxOffset ?? Number.MAX_SAFE_INTEGER }
    wheel(x: number, y: number, delta: number): void {
        if (!this.view) return
        const id = hitTest(this.view, x, y)
        const task = id ? [...this.document.contents()].flatMap(entry => entry.type === 'batch' ? entry.tasks : []).find(task => task.id === id) : undefined
        if (task?.console) {
            const max = Math.max(0, task.console.lines.length - consoleHeight)
            const offset = Math.max(0, Math.min(max, (this.offsets[task.id] ?? max) + delta * 3))
            if (offset === max) delete this.offsets[task.id]
            else this.offsets[task.id] = offset
        } else this.historyOffset = Math.max(0, Math.min(this.view.maxOffset, this.historyOffset + delta * 3))
    }
    key(key: string): boolean {
        if (!this.view) return false
        if (key === 'pageup') this.historyOffset -= Math.max(1, this.view.height - 2)
        else if (key === 'pagedown') this.historyOffset += Math.max(1, this.view.height - 2)
        else if (key === 'home') this.historyOffset = 0
        else if (key === 'end') this.historyOffset = this.view.maxOffset
        else return false
        this.historyOffset = Math.max(0, Math.min(this.view.maxOffset, this.historyOffset))
        return true
    }
}
