import { cancelled, type PromptRequest, type PromptOption, type PromptResult } from "./PromptController.ts"
export interface PromptContext { readonly controller: { ask<T>(request: PromptRequest): Promise<PromptResult<T>> } }
interface Base extends PromptContext { readonly message: string }
export function isCancel(value: unknown): value is typeof cancelled { return value === cancelled }
export function text(options: Base & { readonly initialValue?: string, readonly placeholder?: string, readonly emptyAnswer?: string, readonly validate?: (value: string | undefined) => string | Error | undefined }): Promise<PromptResult<string>> {
    return options.controller.ask({ kind: "text", message: options.message, initial: options.initialValue, placeholder: options.placeholder, emptyAnswer: options.emptyAnswer, validate: options.validate })
}
export function select<T>(options: Base & { readonly options: readonly PromptOption<T>[], readonly initialValue?: T }): Promise<PromptResult<T>> {
    return options.controller.ask({ kind: "select", message: options.message, initial: options.initialValue, options: options.options })
}
export function multiselect<T>(options: Base & { readonly options: readonly PromptOption<T>[], readonly initialValues?: readonly T[], readonly required?: boolean }): Promise<PromptResult<T[]>> {
    return options.controller.ask({ kind: "multiselect", message: options.message, initial: options.initialValues, options: options.options, required: options.required })
}
export function confirm(options: Base & { readonly initialValue?: boolean, readonly active?: string, readonly inactive?: string }): Promise<PromptResult<boolean>> {
    return select({ ...options, initialValue: options.initialValue ?? true, options: [{ value: true, label: options.active ?? "是" }, { value: false, label: options.inactive ?? "否" }] })
}
export async function group<T extends Record<string, () => Promise<unknown>>>(steps: T, options: { readonly onCancel: () => never }): Promise<{ [K in keyof T]: Exclude<Awaited<ReturnType<T[K]>>, typeof cancelled> }> {
    const result: Record<string, unknown> = {}
    for (const [name, run] of Object.entries(steps)) {
        const value = await run()
        if (isCancel(value)) options.onCancel()
        result[name] = value
    }
    return result as { [K in keyof T]: Exclude<Awaited<ReturnType<T[K]>>, typeof cancelled> }
}
