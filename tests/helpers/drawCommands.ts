import { DrawClipShape, DrawOpcode, PathVerb, type PreparedDraw } from '../../packages/framework/src/draw.ts'

export type DecodedDrawCommand = Readonly<Record<string, unknown>>

// 字段名后缀 :paint 为画笔槽，:ref 为引用表下标，:path 为内联路径
const fields: Readonly<Record<number, readonly [string, readonly string[]]>> = {
    [DrawOpcode.Rect]: ['rect', ['x', 'y', 'width', 'height', 'color:paint', 'strokeWidth']],
    [DrawOpcode.RoundRect]: ['roundRect', ['x', 'y', 'width', 'height', 'color:paint', 'strokeWidth', 'radius']],
    [DrawOpcode.Oval]: ['oval', ['x', 'y', 'width', 'height', 'color:paint', 'strokeWidth']],
    [DrawOpcode.Line]: ['line', ['x', 'y', 'endX', 'endY', 'color:paint', 'strokeWidth']],
    [DrawOpcode.Clip]: ['clip', ['shape', 'x', 'y', 'width', 'height', 'radius']],
    [DrawOpcode.PopClip]: ['popClip', []],
    [DrawOpcode.Transform]: ['transform', ['width', 'height', 'translationX', 'translationY', 'scaleX', 'scaleY', 'rotationZ', 'originX', 'originY']],
    [DrawOpcode.PopTransform]: ['popTransform', []],
    [DrawOpcode.Content]: ['content', []],
    [DrawOpcode.Path]: ['path', ['color:paint', 'strokeWidth', 'cap', 'join', 'path:path']],
    [DrawOpcode.Text]: ['text', ['text:ref', 'x', 'y', 'width', 'color', 'fontSize', 'lineHeight', 'maxLines', 'textAlign', 'overflow', 'fontFamily:ref', 'fontWeight', 'italic', 'fontSynthesis']],
    [DrawOpcode.Painter]: ['painter', ['painter:ref', 'x', 'y', 'width', 'height', 'alpha', 'tint', 'contentScale', 'alignment', 'repeat', 'sliceLeft', 'sliceTop', 'sliceRight', 'sliceBottom']],
    [DrawOpcode.Native]: ['native', ['name:ref', 'x', 'y', 'width', 'height', 'params:ref', 'revision']],
    [DrawOpcode.ClipPath]: ['clipPath', ['path:path']],
}
const shapes: Readonly<Record<number, string>> = { [DrawClipShape.Rectangle]: 'rectangle', [DrawClipShape.Rounded]: 'rounded', [DrawClipShape.Oval]: 'circle' }
const verbs: Readonly<Record<number, readonly [string, number]>> = {
    [PathVerb.MoveTo]: ['moveTo', 2], [PathVerb.LineTo]: ['lineTo', 2], [PathVerb.QuadTo]: ['quadTo', 4], [PathVerb.CubicTo]: ['cubicTo', 6], [PathVerb.ArcTo]: ['arcTo', 7], [PathVerb.Close]: ['close', 0],
}

// 把数值流解码为可读命令，只供测试断言；画笔槽为负数时以 brush 字段给出引用的 Brush
export function decodeDraw(prepared: PreparedDraw): DecodedDrawCommand[] {
    const result: DecodedDrawCommand[] = []
    const { ops, refs } = prepared
    let index = 0
    while (index < ops.length) {
        const entry = fields[ops[index++]]
        if (!entry) throw new Error(`未知绘制操作码 ${ops[index - 1]}`)
        const command: Record<string, unknown> = { kind: entry[0] }
        for (const field of entry[1]) {
            const [name, kind] = field.split(':')
            const value = ops[index++]
            if (kind === 'paint' && value < 0) command.brush = refs[-value - 1]
            else if (kind === 'ref') command[name] = refs[value]
            else if (kind === 'path') {
                const count = ops[index++]
                const list: (readonly [string, ...number[]])[] = []
                for (let verb = 0; verb < count; verb++) {
                    const [verbName, arity] = verbs[ops[index++]]
                    list.push([verbName, ...ops.subarray(index, index + arity)])
                    index += arity
                }
                command.fillType = value === 1 ? 'evenOdd' : 'nonZero'
                command.verbs = list
            } else command[name] = value
        }
        if (entry[0] === 'clip') command.shape = shapes[command.shape as number]
        result.push(Object.freeze(command))
    }
    return result
}

// 测试用编码：把可读命令写回数值流，只支持纯数值字段的命令
export function encodeDraw(commands: readonly DecodedDrawCommand[]): PreparedDraw {
    const values: number[] = []
    for (const command of commands) {
        const [opcode, entry] = Object.entries(fields).find(([, value]) => value[0] === command.kind) ?? []
        if (!entry || entry[1].some(field => field.endsWith(':ref') || field.endsWith(':path'))) throw new Error(`不支持编码的绘制命令 ${String(command.kind)}`)
        values.push(Number(opcode))
        for (const field of entry[1]) {
            const name = field.split(':')[0]
            values.push(name === 'shape' ? Number(Object.entries(shapes).find(([, shape]) => shape === command.shape)![0]) : command[name] as number)
        }
    }
    return Object.freeze({ ops: Float64Array.from(values), refs: Object.freeze([]) })
}
