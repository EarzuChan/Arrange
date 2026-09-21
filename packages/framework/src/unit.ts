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

/** @arrangeValue dp */
export function dp(value: number): Dp { return new Dp(value) }

/** @arrangeValue sp */
export function sp(value: number): Sp { return new Sp(value) }

/** @arrangeValue px */
export function px(value: number): Px { return new Px(value) }

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

export function colorNumber(value: number | ColorChannels): number {
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
