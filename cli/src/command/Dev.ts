import { Command, Option } from "commander"
import { buildFlavorSchema } from "../project/ProjectState.ts"
import { DevService } from "../building/DevService.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"

export interface DevCommandOptions {
    uiOnly?: boolean
    nativeOnly?: boolean
    flavor?: "debug" | "release" | string
}

export function registerDevCommand(program: Command, service: DevService, signal: AbortSignal): void {
    program.command("dev").description("启动并监管 UI 开发服务和 Standalone").addOption(new Option("--ui-only", "只启动 UI").conflicts("native-only")).addOption(new Option("--native-only", "只启动 native").conflicts("ui-only")).addOption(new Option("--flavor <flavor>", "native 构建配置").choices(["debug", "release"]).default("debug"))
        .action(async (options: DevCommandOptions) => {
            try { process.exitCode = await service.run(process.cwd(), { flavor: buildFlavorSchema.parse(options.flavor), ui: !options.nativeOnly, native: !options.uiOnly, signal }) } catch (error) {
                if (!signal.aborted || error !== signal.reason && !isAbortError(error)) throw error
                console.log("[ArrangeCLI]", "开发会话已结束")
                process.exitCode = 0
            }
        })
}
