import type { NativeTransactionTarget } from "./native.ts"
import { setWarningHandler } from '@arrange/reactivity'

const REACTIVITY_TAG = 'Reactivity'

declare global {
    var __ARRANGE_NATIVE__: NativeTransactionTarget | undefined
}

export type LogLevelName = "v" | "d" | "i" | "w" | "e"

function native(): NativeTransactionTarget | undefined {
    return globalThis.__ARRANGE_NATIVE__
}

function log(level: LogLevelName, tag: string, args: unknown[]): void {
    if (!tag.trim()) throw new TypeError('打日志不得无 Tag')
    native()?.log?.(level, tag, args.map(value => typeof value === 'string' ? value : String(value)))
}

export const Log = Object.freeze({
    v(tag: string, ...args: unknown[]): void { log("v", tag, args) },
    d(tag: string, ...args: unknown[]): void { log("d", tag, args) },
    i(tag: string, ...args: unknown[]): void { log("i", tag, args) },
    w(tag: string, ...args: unknown[]): void { log("w", tag, args) },
    e(tag: string, ...args: unknown[]): void { log("e", tag, args) },
})

export const DiagnosticsToast = Object.freeze({
    v(tag: string, title: string, ...args: unknown[]): void { toast("v", tag, title, args) },
    d(tag: string, title: string, ...args: unknown[]): void { toast("d", tag, title, args) },
    i(tag: string, title: string, ...args: unknown[]): void { toast("i", tag, title, args) },
    w(tag: string, title: string, ...args: unknown[]): void { toast("w", tag, title, args) },
    e(tag: string, title: string, ...args: unknown[]): void { toast("e", tag, title, args) },
})

function toast(level: LogLevelName, tag: string, title: string, args: unknown[]): void {
    if (!tag.trim()) throw new TypeError('打气泡不得无 Tag')
    if (!title.trim()) throw new TypeError('打气泡不得无标题')
    native()?.diagnosticsToast?.({ level, tag, title, args: args.map(value => typeof value === 'string' ? value : String(value)), coalesce: true })
}

export const diagnostics = Object.freeze({
    requestReload(path?: string): void {
        native()?.diagnosticsRequestReload?.({ path, timestamp: Date.now() })
    },
    triggerFakeError(message = "Manual script diagnostic error"): void {
        native()?.diagnosticsTriggerFakeError?.({ message })
    },
    setToastsEnabled(enabled: boolean): void {
        native()?.diagnosticsSetToastsEnabled?.(enabled)
    }
})

setWarningHandler((message, details) => Log.w(REACTIVITY_TAG, message, ...details))
