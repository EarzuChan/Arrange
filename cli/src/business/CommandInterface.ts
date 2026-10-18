import type { Reporter } from '../terminal/Reporter.ts'
import type { PromptContext } from '../terminal/Prompts.ts'
import type { TaskRunner } from '../feature/operation/Work.ts'

export interface CommandInterface {
    readonly reporter: Reporter
    readonly prompt: PromptContext
    readonly tasks: TaskRunner
}
