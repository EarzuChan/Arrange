// SFA 的值壳在编译期消融；普通 TS 的数值由消费参数确定单位
/** @arrangeValue dp */
export class Dp {
    readonly unit = 'dp'
    constructor(readonly value: number) {
        finite(value, 'DP')
        Object.freeze(this)
    }
}

/** @arrangeValue sp */
export class Sp {
    readonly unit = 'sp'
    constructor(readonly value: number) {
        finite(value, 'SP')
        Object.freeze(this)
    }
}

/** @arrangeValue px */
export class Px {
    readonly unit = 'px'
    constructor(readonly value: number) {
        finite(value, 'PX')
        Object.freeze(this)
    }
}

export type ColorChannels = Readonly<{ red: number; green: number; blue: number; alpha?: number }>

/** @arrangeValue color */
export class ColorValue {
    readonly unit = 'color'
    constructor(readonly value: number) {
        colorNumber(value)
        Object.freeze(this)
    }
}

/** @arrangeValue color */
export function Color(value: number | ColorChannels): ColorValue { return new ColorValue(colorNumber(value)) }

export namespace Color {
    /** @arrangeValue color */
    export function hsl(hue: number, saturation: number, lightness: number, alpha = 1): ColorValue {
        for (const [value, name] of [[hue, '色相'], [saturation, '饱和度'], [lightness, '亮度'], [alpha, '透明度']] as const) if (!Number.isFinite(value)) throw new TypeError(`${name}必须是有限数值`)

        if (saturation < 0 || saturation > 1 || lightness < 0 || lightness > 1 || alpha < 0 || alpha > 1) throw new RangeError('HSL 饱和度、亮度和透明度必须在 0..1 之间')

        const h = ((hue % 360) + 360) % 360 / 360
        const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
        const segment = h * 6
        const x = chroma * (1 - Math.abs(segment % 2 - 1))
        const [red, green, blue] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x]
        const offset = lightness - chroma / 2
        return new ColorValue(colorNumber({ red: red + offset, green: green + offset, blue: blue + offset, alpha }))
    }
}

export function colorNumber(value: number | ColorChannels | ColorValue): number {
    if (value instanceof ColorValue) return value.value

    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new TypeError('颜色必须是 uint32 ARGB 数值')
        return value
    }

    if (!value || typeof value !== 'object') throw new TypeError('颜色需要 ARGB 数值或颜色通道对象')

    const channel = (amount: number) => {
        if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new RangeError('颜色通道必须在 0..1 之间')
        return Math.round(amount * 255)
    }

    return (channel(value.alpha ?? 1) << 24 | channel(value.red) << 16 | channel(value.green) << 8 | channel(value.blue)) >>> 0
}

function finite(value: number, unit: string): void {
    if (!Number.isFinite(value)) throw new TypeError(`${unit} 需要有限数值`)
}
