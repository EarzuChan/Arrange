import stringWidth from "fast-string-width"

// 终端文本工具：可见宽度按东亚宽字符、emoji 计算，SGR 颜色序列宽度为 0
// 所有排版都按“可见列”而不是字符串长度进行；折行与截断保留颜色，并让每一行自成一体（行尾复位）

export const resetSgr = "\x1b[0m"

const sgrPattern = /\x1b\[[0-9;:]*m/y
// CSI、OSC、DCS/SOS/PM/APC、两字节转义；用于清洗子进程输出中会移动光标或改动屏幕的序列
const escapePattern = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[PX^_][^\x1b]*(?:\x1b\\)?|[ -/]*[0-~])/y
const anyEscapeGlobal = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[PX^_][^\x1b]*(?:\x1b\\)?|[ -/]*[0-~])/g
const printableAscii = /^[\x20-\x7e]*$/
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function stripAnsi(text: string): string {
    return text.replace(anyEscapeGlobal, "")
}

export function visibleWidth(text: string): number {
    const plain = stripAnsi(text)
    return printableAscii.test(plain) ? plain.length : stringWidth(plain)
}

function graphemeWidth(grapheme: string): number {
    if (grapheme.length === 1) {
        const code = grapheme.charCodeAt(0)
        if (code >= 0x20 && code < 0x7f) return 1
    }
    return stringWidth(grapheme)
}

type Token = { readonly kind: "sgr", readonly text: string } | { readonly kind: "text", readonly text: string }

// 只认 SGR 与普通文本；其它转义序列在 sanitize 时已清除，这里遇到时也按零宽丢弃
function* tokens(text: string): Generator<Token> {
    let index = 0
    let start = 0
    while (index < text.length) {
        if (text.charCodeAt(index) !== 0x1b) {
            index++
            continue
        }
        if (index > start) yield { kind: "text", text: text.slice(start, index) }
        sgrPattern.lastIndex = index
        if (sgrPattern.test(text)) {
            yield { kind: "sgr", text: text.slice(index, sgrPattern.lastIndex) }
            index = sgrPattern.lastIndex
        } else {
            escapePattern.lastIndex = index
            index = escapePattern.test(text) ? escapePattern.lastIndex : index + 1
        }
        start = index
    }
    if (index > start) yield { kind: "text", text: text.slice(start, index) }
}

function* graphemes(text: string): Generator<string> {
    if (printableAscii.test(text)) {
        for (const character of text) yield character
        return
    }
    for (const { segment } of segmenter.segment(text)) yield segment
}

// 跟踪当前生效的 SGR，用于换行后在下一行重新打开颜色
class SgrState {
    private active: string[] = []

    apply(sequence: string): void {
        const parameters = sequence.slice(2, -1)
        if (parameters === "" || parameters === "0") this.active = []
        else if (parameters.startsWith("0;")) this.active = [sequence]
        else {
            this.active.push(sequence)
            if (this.active.length > 16) this.active.splice(0, this.active.length - 16)
        }
    }

    get open(): string { return this.active.join("") }
    get styled(): boolean { return this.active.length > 0 }
}

// 按可见宽度硬折行（与终端自身的折行一致：逐字素断开，不按单词）
export function wrap(text: string, width: number): string[] {
    const limit = Math.max(1, Math.floor(width))
    const rows: string[] = []
    const state = new SgrState()
    let row = ""
    let used = 0
    for (const token of tokens(text)) {
        if (token.kind === "sgr") {
            row += token.text
            state.apply(token.text)
            continue
        }
        for (const grapheme of graphemes(token.text)) {
            const cells = graphemeWidth(grapheme)
            if (cells > 0 && used + cells > limit && used > 0) {
                rows.push(state.styled ? row + resetSgr : row)
                row = state.open
                used = 0
            }
            row += grapheme
            used += cells
        }
    }
    rows.push(state.styled ? row + resetSgr : row)
    return rows
}

// 截断到给定可见宽度，超出时以省略号结尾
export function truncate(text: string, width: number, ellipsis = "…"): string {
    const limit = Math.max(0, Math.floor(width))
    if (visibleWidth(text) <= limit) return text
    const ellipsisWidth = visibleWidth(ellipsis)
    const budget = Math.max(0, limit - ellipsisWidth)
    const state = new SgrState()
    let result = ""
    let used = 0
    outer: for (const token of tokens(text)) {
        if (token.kind === "sgr") {
            result += token.text
            state.apply(token.text)
            continue
        }
        for (const grapheme of graphemes(token.text)) {
            const cells = graphemeWidth(grapheme)
            if (used + cells > budget) break outer
            result += grapheme
            used += cells
        }
    }
    return (state.styled ? result + resetSgr : result) + (limit >= ellipsisWidth ? ellipsis : "")
}

export function padEnd(text: string, width: number): string {
    return text + " ".repeat(Math.max(0, width - visibleWidth(text)))
}

export function fit(text: string, width: number): string {
    return padEnd(truncate(text, width), width)
}

// 清洗子进程输出的一行：只保留 SGR 颜色，去掉光标移动、清屏、标题等序列与控制字符，制表符展开为空格
export function sanitizeLine(text: string, tabWidth = 8): string {
    let result = ""
    let column = 0
    for (const token of tokens(text)) {
        if (token.kind === "sgr") {
            result += token.text
            continue
        }
        for (const character of token.text) {
            const code = character.codePointAt(0)!
            if (character === "\t") {
                const spaces = tabWidth - (column % tabWidth)
                result += " ".repeat(spaces)
                column += spaces
            } else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0)) continue
            else {
                result += character
                column += graphemeWidth(character)
            }
        }
    }
    return result
}

export function hasSgr(text: string): boolean {
    return text.includes("\x1b[")
}
