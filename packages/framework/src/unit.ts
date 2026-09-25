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

function finite(value: number, unit: string): void {
    if (!Number.isFinite(value)) throw new TypeError(`${unit} 需要有限数值`)
}
