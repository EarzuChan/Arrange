import stringWidth from 'string-width'

export const CONSOLE_HEIGHT = 6

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const reset = '\x1b[0m'
const gray = 90
const accent = 36
const spinner = ['◒', '◐', '◓', '◑']
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
const span = (text, color, bold = false) => ({ text: clean(text), color, bold })
const needsSectionGap = (type, count) => count > 0 && ['answer', 'batch', 'prompt'].includes(type)
const consoleStatus = task => task.state === 'done' ? '已完成' : task.state === 'cancelled' ? '已取消' : ''

export function fitText(value, width) {
    let result = ''
    let cells = 0
    for (const { segment } of segmenter.segment(clean(value))) {
        const next = stringWidth(segment)
        if (cells + next > width) break
        result += segment
        cells += next
    }
    return result
}

// 帧单元分别携带文字和样式，控制序列不进入内容模型
function paint(spans, width, ansi) {
    let result = ''
    let remaining = Math.max(0, width)
    for (const part of spans) {
        const text = fitText(part.text, remaining)
        remaining -= stringWidth(text)
        result += ansi ? `${part.color ? `\x1b[${part.color}m` : ''}${part.bold ? '\x1b[1m' : ''}${text}${reset}` : text
        // 宽字符无法容纳时停止截取，不能跳过后继续拼接后续片段
        if (text !== part.text || !remaining) break
    }
    return result + ' '.repeat(remaining)
}

// 边框与内文分别建模，到行合成阶段才拼接
export function boxRows(lines, { width = Math.max(0, ...lines.map(line => stringWidth(clean(line)))) + 4, color = accent, prefix = [], id, offset = 0, height = lines.length, topLabel = '', bottomLabel = '' } = {}) {
    const innerWidth = Math.max(0, width - 2)
    const contentWidth = Math.max(0, innerWidth - 2)
    const visibleLines = lines.slice(offset, offset + height)
    const firstLine = Math.max(0, height - visibleLines.length)
    const row = spans => ({ spans: [...prefix, ...spans] })
    const border = (left, right, text) => {
        const label = fitText(text ? `─${text}` : '', innerWidth)
        return row([span(`${left}${label}${'─'.repeat(innerWidth - stringWidth(label))}${right}`, color)])
    }
    const output = [border('╭', '╮', topLabel)]
    if (id !== undefined) {
        // 命中几何取自框本身，不包含外围引导线和缩进
        output[0].hitbox = {
            x: prefix.reduce((cells, part) => cells + stringWidth(part.text), 0),
            width: innerWidth + 2, height: height + 2,
            target: { kind: 'console', id },
        }
    }
    for (let i = 0; i < height; i++) {
        const text = fitText(i < firstLine ? '' : visibleLines[i - firstLine] ?? '', contentWidth)
        output.push(row([
            span('│', color), span(' '.repeat(Math.min(1, innerWidth))),
            span(text, color), span(' '.repeat(Math.max(0, innerWidth - Math.min(1, innerWidth) - stringWidth(text)))),
            span('│', color),
        ]))
    }
    output.push(border('╰', '╯', bottomLabel))
    return output
}

function taskLabel(task, frame) {
    if (task.state === 'done') return `✓ ${task.title} · 已完成`
    if (task.state === 'cancelled') return `■ ${task.title} · 已取消`
    if (task.state === 'pending') return `○ ${task.title} · 等待中`
    const filled = Math.round(task.progress * 10)
    return `${spinner[frame % spinner.length]} ${task.title} · [${'━'.repeat(filled)}${'─'.repeat(10 - filled)}] ${Math.floor(task.progress * 100)}%`
}

function batchLabel(batch, frame) {
    if (batch.state === 'done') return `◇ ${batch.title} 完成`
    if (batch.state === 'cancelled') return `■ ${batch.title} 已取消`
    return `${spinner[frame % spinner.length]} 正在 ${batch.title}`
}

export function layoutDocument(session, columns, consoleOffsets = {}, frame = 0) {
    const width = Math.max(0, columns - 1) // 保留末列，避免右下角触发终端自动换行
    const rows = []
    const add = (...spans) => rows.push({ spans })
    const guide = (color = gray) => span('│  ', color)
    const body = (text, color, bold, guideColor = gray) => add(guide(guideColor), span(text, color, bold))
    for (const entry of session.entries) {
        // 主项前统一留出引导空行，不在上一项末尾补空行
        if (needsSectionGap(entry.type, rows.length)) add(guide())
        if (entry.type === 'heading') add(span('┌  ', gray), span(entry.text, undefined, true))
        else if (entry.type === 'message') body(entry.text, gray)
        else if (entry.type === 'answer') {
            add(span('◇  ', gray), span(entry.question))
            body(entry.answer, gray)
        } else if (entry.type === 'batch') {
            const guideColor = entry.state === 'running' ? accent : gray
            add(span(batchLabel(entry, frame), entry.state === 'running' ? accent : 32, true))
            for (const [index, task] of entry.tasks.entries()) {
                body(taskLabel(task, frame), task.state === 'done' ? 32 : task.state === 'pending' ? gray : accent, false, guideColor)
                if (!task.console || !task.consoleStarted) continue
                const max = Math.max(0, task.console.lines.length - CONSOLE_HEIGHT)
                const offset = Math.max(0, Math.min(consoleOffsets[task.id] ?? max, max))
                const direction = offset > 0 ? offset < max ? '可上下滚' : '可往上滚' : max > 0 ? '可往下滚' : ''
                const following = consoleOffsets[task.id] === undefined
                const topLabel = direction + (following ? direction ? '·跟随中' : '跟随中' : '')
                // 极窄终端仍保留完整行几何，最后统一裁剪
                rows.push(...boxRows(task.console.lines, {
                    width: Math.max(2, width - 3), color: [accent, 33, 32][Math.max(0, index - 1) % 3],
                    prefix: [guide(guideColor)], id: task.id, offset, height: CONSOLE_HEIGHT, topLabel, bottomLabel: consoleStatus(task),
                }))
            }
        } else if (entry.type === 'result') {
            add(span('└  ', gray), span(entry.text, session.phase === 'cancelled' ? 33 : 32, true))
        }
    }

    const prompt = session.prompt
    if (prompt) {
        if (needsSectionGap('prompt', rows.length)) add(guide())
        add(span('◆  ', accent), span(prompt.question, undefined, true))
        if (prompt.kind === 'text') {
            const text = fitText(prompt.value, Math.max(0, width - 6))
            rows.push({
                spans: [span('│  ', accent), span(text || prompt.placeholder, text ? undefined : gray)],
                cursorX: Math.min(Math.max(1, width), stringWidth('│  ' + text) + 1),
            })
        } else {
            prompt.options.forEach((option, index) => {
                const active = prompt.cursor === index
                const checked = prompt.kind === 'multi' && prompt.selected.includes(index)
                body(`${active ? '›' : ' '} ${prompt.kind === 'multi' ? checked ? '● ' : '○ ' : ''}${option}`, active ? accent : gray, false, accent)
            })
        }
        body(prompt.kind === 'multi' ? '↑↓ 移动 · Space 切换 · Enter 确认' : prompt.kind === 'select' ? '↑↓ 选择 · Enter 确认' : 'Enter 确认 · Esc 取消', gray, false, accent)
        add(span('└', accent))
    } else if (session.phase === 'done') {
        add()
        add(span('   按 Enter 退出并拍扁完整历史', gray))
    }
    return rows
}

export function viewport(rows, columns, height, requestedOffset = 0) {
    const maxOffset = Math.max(0, rows.length - height)
    const offset = Math.max(0, Math.min(requestedOffset, maxOffset))
    const top = Math.max(0, height - rows.length)
    const visible = rows.slice(offset, offset + height)
    const screenRows = [...Array.from({ length: top }, () => ({ spans: [] })), ...visible]
    const hitRegions = [{ x: 0, y: 0, width: columns, height, target: { kind: 'history' } }]
    // 文档矩形随历史偏移和贴底平移，再按实际绘制范围裁剪
    // 即使框顶已经出屏，剩余可见部分仍保留准确命中区域
    rows.forEach((row, index) => {
        if (!row.hitbox) return
        const box = row.hitbox
        const screenY = index - offset + top
        const x = Math.max(0, box.x)
        const y = Math.max(0, screenY)
        const right = Math.min(Math.max(0, columns - 1), box.x + box.width)
        const bottom = Math.min(height, screenY + box.height)
        if (right > x && bottom > y) {
            hitRegions.push({ x, y, width: right - x, height: bottom - y, target: box.target })
        }
    })
    return { rows: screenRows, hitRegions, offset, top, maxOffset, columns, height }
}

// 坐标使用零基单元格，右边界和下边界不包含在矩形内
export function hitTest(view, x, y) {
    for (let index = view.hitRegions.length - 1; index >= 0; index--) {
        const region = view.hitRegions[index]
        if (x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height) {
            return region.target
        }
    }
}

export class ScreenRenderer {
    frame(view, ansi = true) {
        const width = Math.max(0, view.columns - 1)
        if (!ansi) return view.rows.map(row => paint(row.spans, width, false)).join('\n')
        // 一次提交完整帧，使用绝对坐标定位，避免换行推动终端滚动
        let output = '\x1b[?25l\x1b[0m\x1b[H\x1b[2J'
        view.rows.forEach((row, y) => { output += `\x1b[${y + 1};1H${paint(row.spans, width, true)}` })
        const y = view.rows.findIndex(row => row.cursorX !== undefined)
        if (y >= 0) output += `\x1b[${y + 1};${view.rows[y].cursorX}H\x1b[?25h`
        return output
    }
}

export class TranscriptRenderer {
    render(session) {
        const lines = []
        for (const entry of session.entries) {
            if (needsSectionGap(entry.type, lines.length)) lines.push('│')
            if (entry.type === 'heading') lines.push(`┌  ${entry.text}`)
            else if (entry.type === 'message') lines.push(`│  ${entry.text}`)
            else if (entry.type === 'answer') lines.push(`◇  ${entry.question}`, `│  ${entry.answer}`)
            else if (entry.type === 'batch') {
                lines.push(batchLabel(entry, 0))
                for (const task of entry.tasks) {
                    lines.push(`│  ${taskLabel(task, 0)}`)
                    if (!task.console || !task.consoleStarted) continue
                    const bottomLabel = consoleStatus(task)
                    const width = Math.max(stringWidth(bottomLabel) + (bottomLabel ? 3 : 2), Math.max(0, ...task.console.lines.map(line => stringWidth(clean(line)))) + 4)
                    for (const row of boxRows(task.console.lines, { width, prefix: [span('│  ')], bottomLabel })) {
                        lines.push(paint(row.spans, width + 3, false))
                    }
                }
            } else if (entry.type === 'result') lines.push(`└  ${entry.text}`)
        }
        // 首尾各留一空行，与执行命令和下一个 shell 提示符分隔
        return `\n${lines.join('\n')}\n\n`
    }
}
