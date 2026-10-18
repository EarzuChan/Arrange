import { fit, sanitizeLine, truncate, visibleWidth } from '../util/TerminalText.ts'

export interface Span { text: string, color?: number, bold?: boolean }
export interface Rect { x: number, y: number, width: number, height: number }
export interface Hitbox extends Rect { id: string }
export interface Row { spans: Span[], cursorX?: number, hitbox?: Omit<Hitbox, 'y'> }
export interface View { rows: Row[], hitboxes: Hitbox[], offset: number, maxOffset: number, columns: number, height: number }
export const span = (text: string, color?: number, bold = false): Span => ({ text: sanitizeLine(text), color, bold })

// 文档几何只在这里变换到屏幕坐标，裁剪不会改写文档内容
export function viewport(rows: Row[], columns: number, height: number, requestedOffset: number): View {
    const maxOffset = Math.max(0, rows.length - height)
    const offset = Math.max(0, Math.min(requestedOffset, maxOffset))
    const top = Math.max(0, height - rows.length)
    const hitboxes: Hitbox[] = []
    rows.forEach((row, index) => {
        const box = row.hitbox
        if (!box) return
        const y = index - offset + top
        const left = Math.max(0, box.x), right = Math.min(columns - 1, box.x + box.width)
        const upper = Math.max(0, y), bottom = Math.min(height, y + box.height)
        if (right > left && bottom > upper) hitboxes.push({ id: box.id, x: left, y: upper, width: right - left, height: bottom - upper })
    })
    return { rows: [...Array.from({ length: top }, (): Row => ({ spans: [] })), ...rows.slice(offset, offset + height)], hitboxes, offset, maxOffset, columns, height }
}

export function hitTest(view: View, x: number, y: number): string | undefined {
    return view.hitboxes.find(box => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)?.id
}

export function paint(parts: readonly Span[], width: number, ansi: boolean): string {
    let result = '', remaining = Math.max(0, width)
    for (const part of parts) {
        const text = truncate(part.text, remaining, '')
        remaining -= visibleWidth(text)
        result += ansi ? (part.color ? '\x1b[' + part.color + 'm' : '') + (part.bold ? '\x1b[1m' : '') + text + '\x1b[0m' : text.replace(/\x1b\[[0-9;:]*m/g, '')
        if (visibleWidth(text) < visibleWidth(part.text) || remaining <= 0) break
    }
    return fit(result, width)
}
