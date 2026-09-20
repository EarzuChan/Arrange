import { currentInstance } from './arrangable.ts'

export type InjectionKey<T> = symbol & { readonly __value?: T }

export function provide<T>(key: InjectionKey<T> | string | number, value: T): void {
    if (!currentInstance || currentInstance.isMounted) throw new Error('provide 必须在 Arrangable setup 中调用')
    currentInstance.provides[key] = value
}

export function inject<T>(key: InjectionKey<T> | string): T | undefined
export function inject<T>(key: InjectionKey<T> | string, fallback: T, factory?: false): T
export function inject<T>(key: InjectionKey<T> | string, fallback: () => T, factory: true): T
export function inject<T>(key: InjectionKey<T> | string, fallback?: T | (() => T), factory = false): T | undefined {
    if (!currentInstance) throw new Error('inject 必须在活动 Arrangable 中调用')
    const provides = currentInstance.parent?.provides ?? currentInstance.appContext.provides
    if (key in provides) return provides[key] as T
    return factory ? (fallback as () => T)() : fallback as T | undefined
}

export function hasInjectionContext(): boolean {
    return currentInstance !== null
}
