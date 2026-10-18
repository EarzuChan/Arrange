import type { InputEvent } from "./InputDecoder.ts"
import type { PromptContent } from "./SessionDocument.ts"
import type { SessionDocument } from "./SessionDocument.ts"
import { sanitizeLine } from "../util/TerminalText.ts"
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const characters = (value: string): string[] => Array.from(segmenter.segment(value), part => part.segment)

export const cancelled = Symbol("prompt-cancelled")
export type PromptResult<T> = T | typeof cancelled
export interface PromptOption<T> { readonly value: T, readonly label: string, readonly hint?: string }
export interface PromptRequest {
    readonly message: string
    readonly kind: "text" | "select" | "multiselect"
    readonly options?: readonly PromptOption<unknown>[]
    readonly initial?: unknown
    readonly required?: boolean
    readonly placeholder?: string
    readonly validate?: (value: string) => string | Error | undefined
}
interface Pending { readonly request: PromptRequest, readonly resolve: (value: PromptResult<unknown>) => void, text: string, cursor: number, index: number, selected: Set<unknown>, error?: string }

// 提问是会话中的控件，不取得流或终端模式所有权
export class PromptController {
    private pending: Pending | undefined
    constructor(private readonly document: SessionDocument, private readonly changed: () => void, private readonly ensureActive: () => void) { }
    get active(): boolean { return this.pending !== undefined }
    ask<T>(request: PromptRequest): Promise<PromptResult<T>> {
        if (this.pending) return Promise.reject(new Error("不能同时打开多个提问"))
        if (request.kind !== 'text' && !request.options?.length) return Promise.reject(new Error('选择题必须有选项'))
        this.ensureActive()
        return new Promise(resolve => {
            const text = request.kind === "text" ? String(request.initial ?? "") : ""
            this.pending = { request, resolve: resolve as Pending["resolve"], text, cursor: characters(text).length, index: Math.max(0, request.options?.findIndex(option => option.value === request.initial) ?? 0), selected: new Set(Array.isArray(request.initial) ? request.initial : []) }
            this.changed()
        })
    }
    cancel(): void { if (this.pending) this.complete(cancelled) }
    private complete(value: PromptResult<unknown>): void {
        const pending = this.pending
        if (!pending) return
        this.pending = undefined
        const { request } = pending
        const label = value === cancelled ? "已取消" : request.kind === "text" ? String(value) : request.options?.filter(option => Array.isArray(value) ? value.includes(option.value) : value === option.value).map(option => option.label).join("、") ?? String(value)
        this.document.answer(request.message, sanitizeLine(label))
        pending.resolve(value)
        this.changed()
    }
    handle(event: InputEvent): boolean {
        const pending = this.pending
        if (!pending) return false
        const { request } = pending
        if (event.kind === "key" && event.key === "escape") {
            this.cancel()
            return true
        }
        if (request.kind === "text") {
            const chars = characters(pending.text)
            if (event.kind === "paste" || event.kind === "key" && event.key === "text" && !event.ctrl && !event.alt) {
                const text = sanitizeLine((event.text ?? '').replace(/\r\n|[\r\n\t]/g, ' '))
                const inserted = characters(text)
                chars.splice(pending.cursor, 0, ...inserted)
                pending.cursor += inserted.length
            } else if (event.kind === "key") {
                if (event.key === "left") pending.cursor = Math.max(0, pending.cursor - 1)
                else if (event.key === "right") pending.cursor = Math.min(chars.length, pending.cursor + 1)
                else if (event.key === "home") pending.cursor = 0
                else if (event.key === "end") pending.cursor = chars.length
                else if (event.key === "backspace" && pending.cursor > 0) chars.splice(--pending.cursor, 1)
                else if (event.key === "delete") chars.splice(pending.cursor, 1)
                else if (event.key === "enter") {
                    const error = request.validate?.(pending.text)
                    if (error) pending.error = String(error)
                    else {
                        this.complete(pending.text)
                        return true
                    }
                }
            }
            pending.text = chars.join("")
            // 组合字符可能跨输入事件到达，重新按字素核对光标
            pending.cursor = Math.min(pending.cursor, characters(pending.text).length)
        } else {
            const options = request.options ?? []
            if (event.kind === "key") {
                if (event.key === "up" || event.key === "left") pending.index = (pending.index + options.length - 1) % Math.max(1, options.length)
                else if (event.key === "down" || event.key === "right") pending.index = (pending.index + 1) % Math.max(1, options.length)
                else if (event.key === "pageup") pending.index = Math.max(0, pending.index - 8)
                else if (event.key === "pagedown") pending.index = Math.min(Math.max(0, options.length - 1), pending.index + 8)
                else if (event.key === "home") pending.index = 0
                else if (event.key === "end") pending.index = Math.max(0, options.length - 1)
                else if (request.kind === "multiselect" && event.key === "text" && event.text === " " && !event.ctrl && !event.alt) {
                    const value = options[pending.index]?.value
                    if (pending.selected.has(value)) pending.selected.delete(value); else pending.selected.add(value)
                } else if (event.key === "enter" && options.length) {
                    if (request.kind === "select") this.complete(options[pending.index]!.value)
                    else if (request.required && !pending.selected.size) pending.error = "至少选择一项"
                    else this.complete(options.filter(option => pending.selected.has(option.value)).map(option => option.value))
                } else if (request.kind === 'select' && event.key === "text" && /^[yn]$/i.test(event.text ?? "") && !event.ctrl && !event.alt && options.every(option => typeof option.value === "boolean")) this.complete(event.text!.toLowerCase() === "y")
            }
        }
        this.changed()
        return true
    }
    get content(): PromptContent | undefined {
        const p = this.pending
        if (!p) return undefined
        return { kind: p.request.kind, question: p.request.message, options: (p.request.options ?? []).map(option => option.label + (option.hint ? ' · ' + option.hint : '')), index: p.index, selected: (p.request.options ?? []).flatMap((option, index) => p.selected.has(option.value) ? [index] : []), value: p.text, cursor: p.cursor, placeholder: p.request.placeholder ?? '', error: p.error }
    }
}
