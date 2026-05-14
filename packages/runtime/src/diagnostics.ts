import type {NativeTransactionTarget} from "./native.ts"

declare global {
    var __ARRANGE_NATIVE__: NativeTransactionTarget | undefined
}

export type LogLevelName = "trace" | "debug" | "info" | "warn" | "error"
export type DiagnosticCategoryName =
    | "app"
    | "host.live"
    | "host.dist"
    | "host.hmr"
    | "runtime.script"
    | "runtime.transaction"
    | "pipeline.frame"
    | "pipeline.layout"
    | "pipeline.paint"
    | "input.pointer"
    | "input.key"
    | "input.ime"
    | "input.scroll"
    | "resource.package"
    | "resource.image"
    | "resource.icon"
    | "diagnostics"

export type DiagnosticPayload = Readonly<{
    category?: DiagnosticCategoryName
    code?: string
    message: string
    detail?: string
    source?: string
    pathOrUrl?: string
    toast?: boolean
}>

function native(): NativeTransactionTarget | undefined {
    return globalThis.__ARRANGE_NATIVE__
}

function assertLogLevel(level: LogLevelName): LogLevelName {
    if (level !== "trace" && level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
        throw new TypeError(`Arrange diagnostics log level is unsupported: ${String(level)}`)
    }
    return level
}

function assertCategory(category: DiagnosticCategoryName): DiagnosticCategoryName {
    switch (category) {
        case "app":
        case "host.live":
        case "host.dist":
        case "host.hmr":
        case "runtime.script":
        case "runtime.transaction":
        case "pipeline.frame":
        case "pipeline.layout":
        case "pipeline.paint":
        case "input.pointer":
        case "input.key":
        case "input.ime":
        case "input.scroll":
        case "resource.package":
        case "resource.image":
        case "resource.icon":
        case "diagnostics":
            return category
        default:
            throw new TypeError(`Arrange diagnostics category is unsupported: ${String(category)}`)
    }
}

function normalizePayload(messageOrPayload: string | DiagnosticPayload, detail?: string): DiagnosticPayload {
    const payload: DiagnosticPayload = typeof messageOrPayload === "string" ? {message: messageOrPayload, detail} : messageOrPayload
    if (payload.category) assertCategory(payload.category)
    return payload
}

function log(level: LogLevelName, messageOrPayload: string | DiagnosticPayload, detail?: string): void {
    native()?.diagnosticsLog?.(assertLogLevel(level), normalizePayload(messageOrPayload, detail))
}

export const logger = Object.freeze({
    trace(messageOrPayload: string | DiagnosticPayload, detail?: string): void { log("trace", messageOrPayload, detail) },
    debug(messageOrPayload: string | DiagnosticPayload, detail?: string): void { log("debug", messageOrPayload, detail) },
    info(messageOrPayload: string | DiagnosticPayload, detail?: string): void { log("info", messageOrPayload, detail) },
    warn(messageOrPayload: string | DiagnosticPayload, detail?: string): void { log("warn", messageOrPayload, detail) },
    error(messageOrPayload: string | DiagnosticPayload, detail?: string): void { log("error", messageOrPayload, detail) },
})

export const diagnostics = Object.freeze({
    toast(messageOrPayload: string | Omit<DiagnosticPayload, "toast">, detail?: string): void {
        const base = normalizePayload(messageOrPayload as string | DiagnosticPayload, detail)
        const payload = {...base, toast: true}
        native()?.diagnosticsToast?.(payload)
    },
    requestReload(path?: string): void {
        native()?.diagnosticsRequestReload?.({path, timestamp: Date.now()})
    },
    triggerFakeError(message = "Manual script diagnostic error"): void {
        native()?.diagnosticsTriggerFakeError?.({message})
    },
    copyDiagnostics(): string {
        return native()?.diagnosticsCopyDiagnostics?.() ?? ""
    },
    copyRecentEvents(): string {
        return native()?.diagnosticsCopyRecentEvents?.() ?? ""
    },
    setLogLevel(level: LogLevelName): void {
        native()?.diagnosticsSetLogLevel?.(assertLogLevel(level))
    },
    setCategoryEnabled(category: DiagnosticCategoryName, enabled: boolean): void {
        native()?.diagnosticsSetCategoryEnabled?.(assertCategory(category), enabled)
    },
    setToastsEnabled(enabled: boolean): void {
        native()?.diagnosticsSetToastsEnabled?.(enabled)
    },
})
