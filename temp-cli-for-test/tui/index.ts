import type { Command } from './api.ts'
import { TerminalSession } from './session.ts'

export type { Command, CommandUi, Choice, TaskDefinition, TaskGroup, TaskPresentation } from './api.ts'

// 正式入口只提供命令运行能力，底层流与事件不进入业务接口
export function runTerminal(command: Command): Promise<number> { return new TerminalSession().run(command) }
