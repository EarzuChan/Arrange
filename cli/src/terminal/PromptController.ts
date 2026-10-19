import type { InputEvent } from "./InputDecoder.ts"
import type { PromptContent } from "./SessionDocument.ts"
import type { SessionDocument } from "./SessionDocument.ts"
import { sanitizeLine } from "../util/TerminalText.ts"
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const characters = (value: string): string[] => Array.from(segmenter.segment(value), part => part.segment)

export const cancelled = Symbol("prompt-cancelled")
export type PromptResult<T> = T | typeof cancelled
export interface PromptOption<T> { readonly value: T, readonly label: string, readonly hint?: string, readonly disabled?: boolean }
export interface PromptRequest {
    readonly message: string
    readonly kind: "text" | "select" | "multiselect"
    readonly options?: readonly PromptOption<unknown>[]
    readonly initial?: unknown
    readonly emptyAnswer?: string
    readonly required?: boolean
    readonly placeholder?: string
    readonly validate?: (value: string) => string | Error | undefined
}
interface Pending { readonly request: PromptRequest, readonly document: SessionDocument, readonly resolve: (value: PromptResult<unknown>) => void, text: string, cursor: number, index: number, selected: Set<unknown>, error?: string }

// 提问是会话中的控件，不取得流或终端模式所有权
export class PromptController {
    private pending: Pending | undefined
    constructor(private readonly document: SessionDocument, private readonly changed: () => void, private readonly ensureActive: () => void) { }
    get active(): boolean { return this.pending !== undefined }
    ask<T>(request: PromptRequest, document = this.document): Promise<PromptResult<T>> {
        document.assertActive()
        if (this.pending) return Promise.reject(new Error("不能同时打开多个提问"))
        if (request.kind !== 'text' && !request.options?.length) return Promise.reject(new Error('选择题必须有选项'))
        const available = (request.options ?? []).flatMap((option, index) => option.disabled ? [] : [index])
        if (request.kind !== 'text' && !available.length) return Promise.reject(new Error('选择题必须至少有一个可用选项'))
        this.ensureActive()
        document.advance()
        return new Promise(resolve => {
            const text = request.kind === "text" ? String(request.initial ?? "") : ""
            const initialIndex = request.options?.findIndex(option => !option.disabled && option.value === request.initial) ?? -1
            const initialValues = Array.isArray(request.initial) ? request.initial : []
            const selected = new Set((request.options ?? []).filter(option => !option.disabled && initialValues.includes(option.value)).map(option => option.value))
            this.pending = { request, document, resolve: resolve as Pending["resolve"], text, cursor: characters(text).length, index: initialIndex >= 0 ? initialIndex : available[0] ?? 0, selected }
            this.changed()
        })
    }
    cancel(): void { if (this.pending) this.complete(cancelled) }
    cancelWithin(document: SessionDocument): void { if (this.pending && document.contains(this.pending.document)) this.cancel() }
    private complete(value: PromptResult<unknown>): void {
        const pending = this.pending
        if (!pending) return
        this.pending = undefined
        const { request } = pending
        const label = value === cancelled ? "已取消" : request.kind === "text" ? String(value) || request.emptyAnswer || "" : request.options?.filter(option => Array.isArray(value) ? value.includes(option.value) : value === option.value).map(option => option.label).join("、") ?? String(value)
        pending.document.answer(request.message, sanitizeLine(label))
        pending.resolve(value)
        this.changed()
    }
    handle(event: InputEvent): boolean {
        const pending = this.pending
        if (!pending) return false
        const { request } = pending
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
            const available = options.flatMap((option, index) => option.disabled ? [] : [index])
            const position = Math.max(0, available.indexOf(pending.index))
            if (event.kind === "key") {
                if (event.key === "up" || event.key === "left") pending.index = available[(position + available.length - 1) % available.length] ?? pending.index
                else if (event.key === "down" || event.key === "right") pending.index = available[(position + 1) % available.length] ?? pending.index
                else if (event.key === "pageup") pending.index = available[Math.max(0, position - 8)] ?? pending.index
                else if (event.key === "pagedown") pending.index = available[Math.min(available.length - 1, position + 8)] ?? pending.index
                else if (event.key === "home") pending.index = available[0] ?? pending.index
                else if (event.key === "end") pending.index = available.at(-1) ?? pending.index
                else if (request.kind === "multiselect" && event.key === "text" && event.text === " " && !event.ctrl && !event.alt && options[pending.index] && !options[pending.index].disabled) {
                    const value = options[pending.index]?.value
                    if (pending.selected.has(value)) pending.selected.delete(value); else pending.selected.add(value)
                } else if (event.key === "enter" && options[pending.index] && !options[pending.index].disabled) {
                    if (request.kind === "select") this.complete(options[pending.index]!.value)
                    else if (request.required && !pending.selected.size) pending.error = "至少选择一项"
                    else this.complete(options.filter(option => !option.disabled && pending.selected.has(option.value)).map(option => option.value))
                } else if (request.kind === 'select' && event.key === "text" && /^[yn]$/i.test(event.text ?? "") && !event.ctrl && !event.alt && options.every(option => typeof option.value === "boolean")) {
                    const option = options.find(option => option.value === (event.text!.toLowerCase() === "y"))
                    if (option && !option.disabled) this.complete(option.value)
                }
            }
        }
        this.changed()
        return true
    }
    get content(): PromptContent | undefined {
        const p = this.pending
        if (!p) return undefined
        return { kind: p.request.kind, question: p.request.message, options: (p.request.options ?? []).map(option => option.label + (option.hint ? ' · ' + option.hint : '')), disabled: (p.request.options ?? []).flatMap((option, index) => option.disabled ? [index] : []), index: p.index, selected: (p.request.options ?? []).flatMap((option, index) => !option.disabled && p.selected.has(option.value) ? [index] : []), value: p.text, cursor: p.cursor, placeholder: p.request.placeholder ?? '', error: p.error }
    }
}
