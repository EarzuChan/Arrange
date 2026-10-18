import { StringDecoder } from 'node:string_decoder'

export interface KeyInput { kind: 'key', key: string, text?: string, shift?: boolean, alt?: boolean, ctrl?: boolean }
export type InputEvent = KeyInput | { kind: 'wheel', x: number, y: number, delta: number } | { kind: 'pointer', x: number, y: number, button: number, action: 'press' | 'release' | 'move' } | { kind: 'paste', text: string }

const letters: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'backtab' }
const tildes: Record<string, string> = { '1': 'home', '7': 'home', '4': 'end', '8': 'end', '3': 'delete', '5': 'pageup', '6': 'pagedown' }
const pasteEnd = '\x1b[201~'
const key = (name: string, extra: Partial<Omit<KeyInput, 'kind' | 'key'>> = {}): KeyInput => ({ kind: 'key', key: name, ...extra })
const modifiers = (code: string | number) => {
    const bits = Math.max(0, Number(code || 1) - 1)
    return bits ? { shift: !!(bits & 1), alt: !!(bits & 2), ctrl: !!(bits & 4) } : {}
}

// 有状态地解析 UTF-8 和 VT 输入，不依赖终端流、视图或业务
export class InputDecoder {
    private readonly maxPasteLength: number
    #utf8 = new StringDecoder('utf8')
    #buffer = ''
    #pasting = false
    #stringControl = false
    #afterCR = false

    constructor({ maxPasteLength = 1024 * 1024 } = {}) {
        this.maxPasteLength = maxPasteLength
    }

    get pending() { return !this.#pasting && !this.#stringControl && this.#buffer.length > 0 }

    feed(chunk: Buffer | string): InputEvent[] {
        this.#buffer += typeof chunk === 'string' ? chunk : this.#utf8.write(chunk)
        const events: InputEvent[] = []
        while (this.#buffer.length) {
            if (this.#pasting) {
                const end = this.#buffer.indexOf(pasteEnd)
                let payloadLength = end
                if (end < 0) {
                    let suffix = Math.min(pasteEnd.length - 1, this.#buffer.length)
                    while (suffix && !this.#buffer.endsWith(pasteEnd.slice(0, suffix))) suffix--
                    payloadLength = this.#buffer.length - suffix
                }
                if (payloadLength > this.maxPasteLength) throw new RangeError('粘贴内容超过输入上限')
                if (end < 0) break
                events.push({ kind: 'paste', text: this.#buffer.slice(0, end) })
                this.#buffer = this.#buffer.slice(end + pasteEnd.length)
                this.#pasting = false
                continue
            }
            if (this.#stringControl) {
                const end = /\x07|\x1b\\/.exec(this.#buffer)
                if (!end) {
                    this.#buffer = this.#buffer.endsWith('\x1b') ? '\x1b' : ''
                    break
                }
                this.#buffer = this.#buffer.slice(end.index + end[0].length)
                this.#stringControl = false
                continue
            }
            const consumed = this.#one(events)
            if (!consumed) break
            this.#buffer = this.#buffer.slice(consumed)
        }
        return events
    }

    expire(): InputEvent[] {
        if (!this.pending) return []
        const events = this.#buffer === '\x1b' ? [key('escape')] : []
        this.#buffer = ''
        return events
    }

    #one(events: InputEvent[]): number {
        const text = this.#buffer
        const first = text[0]
        const afterCR = this.#afterCR
        this.#afterCR = first === '\r'
        if (first !== '\x1b') {
            if (first === '\n' && afterCR) return 1
            const names: Record<string, string> = { '\r': 'enter', '\n': 'enter', '\x03': 'interrupt', '\x7f': 'backspace', '\b': 'backspace', '\t': 'tab' }
            if (names[first]) events.push(key(names[first]))
            else if (first >= ' ' && !/[\x7f-\x9f]/.test(first)) {
                const character = String.fromCodePoint(text.codePointAt(0)!)
                events.push(key('text', { text: character }))
                return character.length
            }
            return 1
        }
        if (text.length < 2) return 0
        if (']P_^X'.includes(text[1])) {
            this.#stringControl = true
            return 2
        }
        if (text[1] === '[' || text[1] === 'O') {
            let end = 2
            while (end < text.length && !/[@-~]/.test(text[end])) end++
            if (end === text.length) return text.length > 128 ? text.length : 0
            const body = text.slice(2, end), final = text[end]
            if (text[1] === '[' && body === '200' && final === '~') this.#pasting = true
            else if (text[1] === '[' && body.startsWith('<') && (final === 'M' || final === 'm')) this.#mouse(body, final, events)
            else if (/^[0-9;]*$/.test(body)) {
                const [parameter, modifier] = body.split(';')
                const name = letters[final] ?? (final === '~' ? tildes[parameter] : undefined)
                if (name) events.push(key(name, modifiers(modifier || (final === 'Z' ? 2 : 1))))
            }
            return end + 1
        }
        if (text[1] === '\x1b') {
            events.push(key('escape'))
            return 1
        }
        const character = String.fromCodePoint(text.codePointAt(1)!)
        if (character >= ' ') events.push(key('text', { text: character, alt: true }))
        return 1 + character.length
    }

    #mouse(body: string, final: string, events: InputEvent[]): void {
        if (!/^<\d+;\d+;\d+$/.test(body)) return

        const [button, column, row] = body.slice(1).split(';').map(Number)
        if (![button, column, row].every(Number.isSafeInteger) || column < 1 || row < 1) return
        const position = { x: column - 1, y: row - 1 }
        if (final === 'M' && (button & 192) === 64 && (button & 3) < 2) events.push({ kind: 'wheel', ...position, delta: (button & 1) ? 1 : -1 })
        else if (!(button & 64)) events.push({ kind: 'pointer', ...position, button: button & 3, action: final === 'm' ? 'release' : button & 32 ? 'move' : 'press' })
    }
}
