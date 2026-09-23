import { currentInstance } from './arrangable.ts'
import { Log } from '../diagnostics.ts'

const TAG = 'Arrangable'

export function warn(message: string, ...details: unknown[]): void {
    const handler = currentInstance?.appContext.config.warnHandler
    if (handler) handler(message)
    else Log.w(TAG, message, ...details)
}

export function assertNumber(value: unknown, name: string): void {
    if (typeof value !== 'number' || Number.isNaN(value)) throw new TypeError(`${name} 必须是有效数字`)
}
