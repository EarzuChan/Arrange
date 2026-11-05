import { errorMessage } from '../util/Utils.ts'
import type { Entry, Tone } from './SessionDocument.ts'

export class Reporter {
    constructor(private readonly append: (entry: Entry) => void, private readonly shown: (reason: unknown) => boolean = () => false) { }
    // 消息仅携带文字和色调，首尾结构完全由渲染器决定
    step(text: string | readonly string[]): void { this.toned('step', text) }
    info(text: string | readonly string[]): void { this.toned('info', text) }
    success(text: string | readonly string[]): void { this.toned('success', text) }
    warn(text: string | readonly string[]): void { this.toned('warn', text) }
    error(text: string | readonly string[]): void { this.toned('error', text) }
    // 失败详情已经在任务面板上显示时不再重复，没有显示过的一律输出
    failure(reason: unknown): void { if (!this.shown(reason)) this.error(errorMessage(reason)) }
    toned(tone: Tone, text: string | readonly string[]): void { this.append({ type: 'message', text: typeof text === 'string' ? text : text.join('\n'), tone }) }
}
