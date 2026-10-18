import { sanitizeLine, truncate, visibleWidth, wrap } from '../util/TerminalText.ts'
import type { BatchContent, PromptContent, SessionDocument, TaskContent } from './SessionDocument.ts'
import { span, type Row, type Span } from './LayoutModel.ts'

export const consoleHeight = 6
const accent = 36, gray = 90
const spinner = ['◒', '◐', '◓', '◑']
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const toneColor = { info: 36, step: 32, success: 32, warn: 33, error: 31 }
const status = (task: TaskContent): string => ({ done: '已完成', failed: '失败', cancelled: '已取消', stopped: '已停止', running: '', pending: '' })[task.state]

export function taskLabel(task: TaskContent, frame: number): string {
    const symbol = task.state === 'done' ? '✓' : task.state === 'running' ? spinner[frame % spinner.length] : task.state === 'pending' ? '○' : '■'
    const progress = task.state === 'running' && task.progress !== undefined ? ' · [' + '━'.repeat(Math.round(task.progress * 10)) + '─'.repeat(10 - Math.round(task.progress * 10)) + '] ' + Math.floor(task.progress * 100) + '%' : ''
    return symbol + ' ' + task.title + (task.detail ? ' · ' + task.detail : '') + progress + (status(task) ? ' · ' + status(task) : '')
}

function batchLabel(batch: BatchContent, frame: number): string {
    return batch.state === 'running' ? spinner[frame % spinner.length] + ' 正在 ' + batch.title : (batch.state === 'done' ? '◇ ' : '■ ') + batch.title + (batch.state === 'done' ? ' 完成' : batch.state === 'failed' ? ' 失败' : ' 已取消')
}

// 框线和内文分别组成行，边框着色不覆盖子终端自身的颜色
export function consoleRows(task: TaskContent, width: number, offset: number | undefined, guideColor: number, flatten = false): Row[] {
    const lines = task.console?.lines ?? []
    const bottom = status(task)
    if (flatten) width = lines.reduce((width, line) => Math.max(width, visibleWidth(line) + 4), Math.max(4, visibleWidth(bottom) + 3))
    const inner = Math.max(0, width - 2), content = Math.max(0, inner - 2)
    const max = Math.max(0, lines.length - consoleHeight)
    const start = Math.max(0, Math.min(offset ?? max, max))
    const direction = start > 0 ? start < max ? '可上下滚' : '可往上滚' : max > 0 ? '可往下滚' : ''
    const top = flatten ? '' : direction + (offset === undefined ? direction ? '·跟随中' : '跟随中' : '')
    const prefix = span('│  ', guideColor)
    const border = (left: string, right: string, label: string): Row => {
        const text = truncate(label ? '─' + label : '', inner, '')
        return { spans: [prefix, span(left + text + '─'.repeat(inner - visibleWidth(text)) + right, accent)] }
    }
    const rows = [border('╭', '╮', top)]
    if (!flatten) rows[0]!.hitbox = { id: task.id, x: 3, width, height: consoleHeight + 2 }
    const shown = flatten ? lines : lines.slice(start, start + consoleHeight)
    const height = flatten ? lines.length : consoleHeight
    const padding = Math.max(0, height - shown.length)
    for (let index = 0; index < height; index++) {
        const text = truncate(index < padding ? '' : shown[index - padding] ?? '', content, '')
        rows.push({ spans: [prefix, span('│', accent), span(' '.repeat(Math.min(1, inner))), span(text), span(' '.repeat(Math.max(0, inner - Math.min(1, inner) - visibleWidth(text)))), span('│', accent)] })
    }
    rows.push(border('╰', '╯', bottom))
    return rows
}

export function layoutDocument(document: SessionDocument, columns: number, offsets: Readonly<Record<string, number>> = {}, frame = 0, prompt?: PromptContent, flatten = false, height = 24): Row[] {
    const width = Math.max(0, columns - 1), rows: Row[] = []
    const add = (...spans: Span[]) => { rows.push({ spans }) }
    const guide = (color = gray) => span('│  ', color)
    const body = (text: string, color?: number, guideColor = gray) => {
        for (const logical of text.split(/\r?\n/)) for (const line of flatten ? [logical] : wrap(sanitizeLine(logical), Math.max(1, width - 3))) add(guide(guideColor), span(line, color))
    }
    for (const entry of document.entries) {
        if (rows.length && ['answer', 'batch'].includes(entry.type)) add(guide())
        if (entry.type === 'heading') add(span('┌  ', gray), span(entry.text, undefined, true))
        else if (entry.type === 'message') body(entry.text, entry.tone ? toneColor[entry.tone] : undefined)
        else if (entry.type === 'result') add(span('└  ', gray), span(entry.text, entry.tone ? toneColor[entry.tone] : 32, true))
        else if (entry.type === 'answer') {
            add(span('◇  ', gray), span(entry.question))
            body(entry.answer, gray)
        } else if (entry.type === 'batch') {
            const color = entry.state === 'running' ? accent : gray
            add(span(batchLabel(entry, frame), entry.state === 'running' ? accent : entry.state === 'failed' ? 31 : 32, true))
            for (const message of entry.messages ?? []) body(message.text, message.tone ? toneColor[message.tone] : undefined, color)
            for (const task of entry.tasks) {
                body(taskLabel(task, frame), task.state === 'failed' ? 31 : task.state === 'pending' ? gray : task.state === 'done' ? 32 : accent, color)
                if (task.failure) body(task.failure, 31, color)
                if (task.console?.started) for (const row of consoleRows(task, Math.max(2, width - 3), offsets[task.id], color, flatten)) rows.push(row)
                if (task.logPath) body('已记录到 ' + task.logPath, gray, color)
            }
        }
    }
    if (prompt) {
        if (rows.length) add(guide())
        add(span('◆  ', accent), span(prompt.question, undefined, true))
        if (prompt.kind === 'text') {
            const chars = Array.from(segmenter.segment(prompt.value), part => part.segment)
            let hidden = 0
            while (hidden < prompt.cursor && visibleWidth(chars.slice(hidden, prompt.cursor).join('')) > Math.max(0, width - 4)) hidden++
            const left = chars.slice(hidden, prompt.cursor).join('')
            const value = chars.slice(hidden).join('')
            rows.push({ spans: [guide(accent), span(value || prompt.placeholder, value ? undefined : gray)], cursorX: Math.min(Math.max(1, width), visibleWidth(left) + 4) })
        } else {
            const count = Math.max(1, height - 6), start = Math.max(0, Math.min(prompt.index - Math.floor(count / 2), prompt.options.length - count))
            for (const [relative, option] of prompt.options.slice(start, start + count).entries()) {
                const index = start + relative
                const selected = prompt.kind === 'multiselect' ? prompt.selected.includes(index) ? '● ' : '○ ' : ''
                body((prompt.index === index ? '› ' : '  ') + selected + option, prompt.index === index ? accent : gray, accent)
            }
        }
        if (prompt.error) body(prompt.error, 31, accent)
        body(prompt.kind === 'text' ? 'Enter 确认 · Esc 取消' : prompt.kind === 'select' ? '↑↓ 选择 · Enter 确认' : '↑↓ 移动 · Space 切换 · Enter 确认', gray, accent)
        add(span('└', accent))
    } else if (!flatten && document.phase !== 'active') {
        add()
        add(span('按 Enter 退出', gray))
    }
    return rows
}
