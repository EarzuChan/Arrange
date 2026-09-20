import { currentInstance } from './arrangable.ts'

export function warn(message: string, ...details: unknown[]): void {
    const handler = currentInstance?.appContext.config.warnHandler
    if (handler) handler(message)
    else console.warn(`[Arrange] ${message}`, ...details)
}

export function assertNumber(value: unknown, name: string): void {
    if (typeof value !== 'number' || Number.isNaN(value)) throw new TypeError(`${name} 必须是有效数字`)
}
