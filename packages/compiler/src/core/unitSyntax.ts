import type { Node } from '@babel/types'

export interface NormalizedUnitSyntax {
    content: string
    restore(offset: number): number
}

const units = new Set(['dp', 'px', 'sp'])
export const SFA_UNIT_SEPARATOR = '/*@arrange-unit*/'

// 让 Babel 能解析 114.dp 这种 SFA 后缀写法，插入的注释不会进入最终代码
export function normalizeSfaUnitSyntax(source: string): NormalizedUnitSyntax {
    const insertions: { offset: number; length: number }[] = []
    const output: string[] = []
    let outputLength = 0
    let index = 0
    const append = (text: string): void => {
        output.push(text)
        outputLength += text.length
    }
    const scanString = (quote: string): void => {
        append(source[index++])
        while (index < source.length) {
            const character = source[index]
            if (character === '\\') {
                append(source.slice(index, Math.min(index + 2, source.length)))
                index += 2
                continue
            }
            append(character)
            index++
            if (character === quote) return
        }
    }
    const scanCode = (stopAtBrace: boolean): void => {
        let braceDepth = 0
        while (index < source.length) {
            const character = source[index]
            const next = source[index + 1]

            if (stopAtBrace && character === '}' && braceDepth === 0) {
                append(character)
                index++
                return
            }

            if (stopAtBrace && character === '{') {
                append(character)
                index++
                braceDepth++
                continue
            }

            if (stopAtBrace && character === '}') {
                append(character)
                index++
                braceDepth--
                continue
            }

            if (character === '/' && next === '/') {
                const end = source.indexOf('\n', index + 2)
                const stop = end < 0 ? source.length : end
                append(source.slice(index, stop))
                index = stop
                continue
            }

            if (character === '/' && next === '*') {
                const end = source.indexOf('*/', index + 2)
                const stop = end < 0 ? source.length : end + 2
                append(source.slice(index, stop))
                index = stop
                continue
            }

            if (character === '"' || character === "'") {
                scanString(character)
                continue
            }

            if (character === '`') {
                scanTemplate()
                continue
            }

            if (character < '0' || character > '9') {
                append(character)
                index++
                continue
            }

            const numberStart = index
            index++
            while (index < source.length && /[0-9_]/.test(source[index])) index++
            if (source[index] === '.' && /[0-9_]/.test(source[index + 1] ?? '')) {
                index++
                while (index < source.length && /[0-9_]/.test(source[index])) index++
            }
            if (source[index] === 'e' || source[index] === 'E') {
                const exponentStart = index
                index++
                if (source[index] === '+' || source[index] === '-') index++
                const digitsStart = index
                while (index < source.length && /[0-9_]/.test(source[index])) index++
                if (digitsStart === index) index = exponentStart
            }

            const suffixStart = index
            if (source[index] === '.') {
                const suffix = source.slice(index + 1, index + 3)
                const boundary = source[index + 3]
                if (units.has(suffix) && (boundary === undefined || !/[\w$]/.test(boundary))) {
                    append(source.slice(numberStart, suffixStart))
                    const offset = outputLength
                    append(SFA_UNIT_SEPARATOR)
                    insertions.push({ offset, length: SFA_UNIT_SEPARATOR.length })
                    append(source.slice(suffixStart, index + 3))
                    index += 3
                    continue
                }
            }

            append(source.slice(numberStart, index))
        }
    }
    const scanTemplate = (): void => {
        append(source[index++])
        while (index < source.length) {
            const character = source[index]
            const next = source[index + 1]
            if (character === '\\') {
                append(source.slice(index, Math.min(index + 2, source.length)))
                index += 2
                continue
            }
            if (character === '`') {
                append(character)
                index++
                return
            }
            if (character === '$' && next === '{') {
                append('${')
                index += 2
                scanCode(true)
                continue
            }
            append(character)
            index++
        }
    }
    scanCode(false)

    if (insertions.length === 0) return { content: source, restore: offset => offset }

    return {
        content: output.join(''),
        restore(offset: number): number {
            let restored = offset
            for (const insertion of insertions) {
                if (insertion.offset + insertion.length > offset) break
                restored -= insertion.length
            }
            return restored
        },
    }
}

// Babel 节点的位置必须回到原始 SFA，否则模板切片和 MagicString 会错位
export function restoreBabelNodePositions(root: Node, restore: (offset: number) => number): void {
    const seen = new Set<object>()
    const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return
        if (seen.has(value)) return
        seen.add(value)
        if (Array.isArray(value)) {
            for (const entry of value) visit(entry)
            return
        }
        const object = value as Record<string, unknown>
        if (typeof object.start === 'number') object.start = restore(object.start)
        if (typeof object.end === 'number') object.end = restore(object.end)
        const loc = object.loc
        if (loc && typeof loc === 'object') {
            const location = loc as Record<string, unknown>
            const start = location.start
            const end = location.end
            if (start && typeof start === 'object') {
                const position = start as Record<string, unknown>
                if (typeof position.index === 'number') {
                    const original = position.index
                    const shift = original - restore(original)
                    position.index = restore(original)
                    if (typeof position.column === 'number') position.column -= shift
                }
            }
            if (end && typeof end === 'object') {
                const position = end as Record<string, unknown>
                if (typeof position.index === 'number') {
                    const original = position.index
                    const shift = original - restore(original)
                    position.index = restore(original)
                    if (typeof position.column === 'number') position.column -= shift
                }
            }
        }
        for (const [key, child] of Object.entries(object)) if (key !== 'loc') visit(child)
    }
    visit(root)
}
