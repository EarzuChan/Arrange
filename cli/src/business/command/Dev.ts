import { Option } from "commander"
import type { ApplicationCommand } from "../ApplicationCommand.ts"
import { buildFlavorSchema } from "../../feature/project/ProjectState.ts"
import { DevService, type DevOutcome } from "../../feature/building/DevService.ts"
import { isAbortError } from "../../feature/platform/ProcessSpec.ts"
import type { CommandInterface } from '../CommandInterface.ts'

export interface DevCommandOptions {
    uiOnly?: boolean
    nativeOnly?: boolean
    flavor?: "debug" | "release" | string
}

export function registerDevCommand(program: ApplicationCommand, service: Pick<DevService, "run">, signal: AbortSignal, terminal: Pick<CommandInterface, 'reporter' | 'stoppable'>): void {
    const { reporter } = terminal
    program.command("dev").description("启动并监管 UI 开发服务和 Standalone").addOption(new Option("--ui-only", "只启动 UI").conflicts("native-only")).addOption(new Option("--native-only", "只启动 native").conflicts("ui-only")).addOption(new Option("--flavor <flavor>", "native 构建配置").choices(["debug", "release"]).default("debug"))
        .action(async (options: DevCommandOptions) => {
            const flavor = buildFlavorSchema.parse(options.flavor)
            reporter.info(`arrange dev · ${flavor}`)
            let outcome: DevOutcome
            try {
                outcome = await terminal.stoppable('开发会话运行中 · Ctrl+C / Esc 结束开发', control => service.run(process.cwd(), { flavor, ui: !options.nativeOnly, native: !options.uiOnly, signal, stopSignal: control.signal, onRunning: control.enable, onStopping: control.disable }))
            } catch (error) {
                if (!signal.aborted || error !== signal.reason && !isAbortError(error)) throw error
                outcome = { kind: 'cancelled' }
            }
            if (outcome.kind === 'cancelled') {
                reporter.warn('开发会话已取消')
                return 130
            } else if (outcome.kind === 'failed') {
                reporter.error(outcome.message)
                return outcome.exitCode
            }
            else reporter.success("开发会话已结束")
            return 0
        })
}
