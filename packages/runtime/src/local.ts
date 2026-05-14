import {inject, provide} from "vue"
import type {ColorValue} from "./primitives.ts"

export type ArrangeLocalKey<T> = Readonly<{
    symbol: symbol
    fallback: T
}>

export function createArrangeLocal<T>(name: string, fallback: T): ArrangeLocalKey<T> {
    if (!name) throw new TypeError("Arrange local name must not be empty")
    return Object.freeze({symbol: Symbol.for(`arrange.local.${name}`), fallback})
}

export function provideArrangeLocal<T>(key: ArrangeLocalKey<T>, value: T): void {
    provide(key.symbol, value)
}

export function useArrangeLocal<T>(key: ArrangeLocalKey<T>): T {
    return inject(key.symbol, key.fallback) as T
}

export const LocalContentColor = createArrangeLocal<ColorValue>("ContentColor", 0xff000000)

export function provideContentColor(color: ColorValue): void {
    provideArrangeLocal(LocalContentColor, color)
}

export function useContentColor(): ColorValue {
    return useArrangeLocal(LocalContentColor)
}
