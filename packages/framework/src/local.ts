import { inject, provide } from "./runtime/index.ts"

export type ArrangeLocalKey<T> = Readonly<{
    symbol: symbol
    fallback: T
}>

export function createArrangeLocal<T>(name: string, fallback: T): ArrangeLocalKey<T> {
    if (!name) throw new TypeError('Arrange 行为服务名称不能为空')
    return Object.freeze({ symbol: Symbol.for(`arrange.local.${name}`), fallback })
}

export function provideArrangeLocal<T>(key: ArrangeLocalKey<T>, value: T): void {
    provide(key.symbol, value)
}

export function useArrangeLocal<T>(key: ArrangeLocalKey<T>): T {
    return inject(key.symbol, key.fallback) as T
}