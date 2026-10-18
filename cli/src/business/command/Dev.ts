import { Option } from "commander"
import type { ApplicationCommand } from "../ApplicationCommand.ts"
import { buildFlavorSchema } from "../../feature/project/ProjectState.ts"
import { DevService } from "../../feature/building/DevService.ts"
import { isAbortError } from "../../feature/platform/ProcessSpec.ts"
import type { Reporter } from "../../terminal/Reporter.ts"

export interface DevCommandOptions {
    uiOnly?: boolean
    nativeOnly?: boolean
    flavor?: "debug" | "release" | string
}

export function registerDevCommand(program: ApplicationCommand, service: Pick<DevService, "run">, signal: AbortSignal, reporter: Reporter): void {
    program.command("dev").description("启动并监管 UI 开发服务和 Standalone").addOption(new Option("--ui-only", "只启动 UI").conflicts("native-only")).addOption(new Option("--native-only", "只启动 native").conflicts("ui-only")).addOption(new Option("--flavor <flavor>", "native 构建配置").choices(["debug", "release"]).default("debug"))
        .action(async (options: DevCommandOptions) => {
            const flavor = buildFlavorSchema.parse(options.flavor)
            reporter.intro(`arrange dev · ${flavor}`)
            let code: number
            try {
                code = await service.run(process.cwd(), { flavor, ui: !options.nativeOnly, native: !options.uiOnly, signal })
            } catch (error) {
                if (!signal.aborted || error !== signal.reason && !isAbortError(error)) throw error
                code = 0
            }
            if (code) reporter.fail(`开发会话异常结束（退出码 ${code}）`)
            else reporter.outro("开发会话已结束")
            return code
        })
}
