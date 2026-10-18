import type { Choice } from './api.ts'
import type { SessionDocument, PromptContent } from './document.ts'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export class PromptController {
    #pending?: { resolve(value: unknown): void, reject(reason: unknown): void, answer(): { value: unknown, label: string } }
    private readonly document: SessionDocument
    private readonly invalidate: () => void

    constructor(document: SessionDocument, invalidate: () => void) {
        this.document = document
        this.invalidate = invalidate
    }

    select<Value extends string>(question: string, options: readonly Choice<Value>[]): Promise<Value> {
        if (!options.length) return Promise.reject(new Error('选择题必须提供选项'))
        const prompt = this.#content('select', question)
        prompt.options = options.map(option => option.label)
        return this.#open(prompt, () => ({ value: options[prompt.cursor].value, label: options[prompt.cursor].label }))
    }

    text(question: string, { placeholder = '', defaultValue = '' } = {}): Promise<string> {
        const prompt = this.#content('text', question)
        prompt.placeholder = placeholder
        return this.#open(prompt, () => {
            const value = prompt.value.trim() || defaultValue
            return { value, label: value }
        })
    }

    multiselect<Value extends string>(question: string, options: readonly Choice<Value>[], initial: readonly Value[] = []): Promise<Value[]> {
        if (!options.length) return Promise.reject(new Error('多选题必须提供选项'))
        const prompt = this.#content('multi', question)
        prompt.options = options.map(option => option.label)
        prompt.selected = options.flatMap((option, index) => initial.includes(option.value) ? [index] : [])
        return this.#open(prompt, () => {
            const selected = options.filter((_, index) => prompt.selected.includes(index))
            return { value: selected.map(option => option.value), label: selected.map(option => option.label).join('、') || '无' }
        })
    }

    #content(kind: PromptContent['kind'], question: string): PromptContent {
        return { kind, question, options: [], cursor: 0, selected: [], value: '', placeholder: '' }
    }

    #open<Value>(prompt: PromptContent, answer: () => { value: Value, label: string }): Promise<Value> {
        if (this.#pending) return Promise.reject(new Error('上一项交互尚未结束'))
        if (this.document.phase !== 'active') return Promise.reject(new Error('会话已结束'))
        return new Promise((resolve, reject) => {
            this.#pending = { resolve: resolve as (value: unknown) => void, reject, answer }
            this.document.prompt = prompt
            this.invalidate()
        })
    }

    key(event: { key: string, text?: string, alt?: boolean, ctrl?: boolean }): void {
        const prompt = this.document.prompt, pending = this.#pending
        if (!prompt || !pending) return
        if (event.key === 'enter') {
            const answer = pending.answer()
            this.document.entries.push({ type: 'answer', question: prompt.question, answer: answer.label })
            this.document.prompt = null
            this.#pending = undefined
            pending.resolve(answer.value)
        } else if (prompt.kind === 'text') {
            if (event.key === 'backspace') prompt.value = prompt.value.slice(0, [...graphemes.segment(prompt.value)].at(-1)?.index ?? 0)
            else if (event.key === 'text' && !event.alt && !event.ctrl) prompt.value += event.text ?? ''
        } else if (event.key === 'up') prompt.cursor = (prompt.cursor + prompt.options.length - 1) % prompt.options.length
        else if (event.key === 'down') prompt.cursor = (prompt.cursor + 1) % prompt.options.length
        else if (prompt.kind === 'multi' && event.key === 'text' && event.text === ' ' && !event.alt && !event.ctrl) {
            prompt.selected = prompt.selected.includes(prompt.cursor) ? prompt.selected.filter(index => index !== prompt.cursor) : [...prompt.selected, prompt.cursor]
        }
        this.invalidate()
    }

    paste(text: string): void {
        if (this.document.prompt?.kind !== 'text') return
        // 粘贴作为数据处理，不能把换行或控制字符解释为提交和取消
        this.document.prompt.value += text.replace(/\r\n|[\r\n\t]/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
        this.invalidate()
    }

    cancel(reason: unknown): void {
        const pending = this.#pending
        this.#pending = undefined
        pending?.reject(reason)
    }
}
