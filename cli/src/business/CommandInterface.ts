import type { Reporter } from '../terminal/Reporter.ts'
import type { PromptContext } from '../terminal/Prompts.ts'
import type { TaskRunner } from '../feature/operation/Work.ts'
import type { PresentationRegion } from '../terminal/Presentation.ts'
import type { SessionUi } from '../terminal/TerminalSession.ts'
import { WorkPresenter } from './WorkPresenter.ts'

export interface CommandInterface {
    readonly reporter: Reporter
    readonly prompt: PromptContext
    readonly tasks: TaskRunner
    region(): PresentationRegion<CommandInterface>
}

// 同一适配规则递归应用于子区块，服务只取得功能进展执行器
export function commandInterface(ui: SessionUi, signal?: AbortSignal): CommandInterface {
    return Object.freeze({
        reporter: ui.reporter, prompt: ui.prompt, tasks: new WorkPresenter(ui.tasks, signal),
        region: () => {
            const region = ui.region()
            let current = commandInterface(region.current, signal)
            return Object.freeze({
                get current() { return current },
                replace: () => current = commandInterface(region.replace(), signal),
                complete: region.complete
            })
        }
    })
}
