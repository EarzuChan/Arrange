import type { Entry, Tone } from './SessionDocument.ts'

export class Reporter {
    constructor(private readonly append: (entry: Entry) => void) { }
    intro(text: string): void { this.append({ type: 'heading', text }) }
    outro(text: string): void { this.append({ type: 'result', text, tone: 'success' }) }
    fail(text: string): void { this.append({ type: 'result', text, tone: 'error' }) }
    cancelled(text: string): void { this.append({ type: 'result', text, tone: 'warn' }) }
    step(text: string | readonly string[]): void { this.toned('step', text) }
    info(text: string | readonly string[]): void { this.toned('info', text) }
    success(text: string | readonly string[]): void { this.toned('success', text) }
    warn(text: string | readonly string[]): void { this.toned('warn', text) }
    error(text: string | readonly string[]): void { this.toned('error', text) }
    toned(tone: Tone, text: string | readonly string[]): void { this.append({ type: 'message', text: typeof text === 'string' ? text : text.join('\n'), tone }) }
}
