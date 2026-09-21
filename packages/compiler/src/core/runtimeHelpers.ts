export const UNREF: unique symbol = Symbol('unref')
export const IS_REF: unique symbol = Symbol('isRef')
export const helperNameMap: Record<symbol, string> = { [UNREF]: 'unref', [IS_REF]: 'isRef' }