import { supportedCliPlatforms } from "./CliMetadata.ts"

export interface CliEnvironment {
    readonly platform: NodeJS.Platform
    readonly stdinIsTTY: boolean
    readonly stdoutIsTTY: boolean
}

export function assertSupportedPlatform(platform: NodeJS.Platform): asserts platform is "darwin" | "win32" {
    if (!(supportedCliPlatforms as readonly NodeJS.Platform[]).includes(platform)) throw new Error(`Arrange CLI 只支持 Windows 和 macOS，当前平台 ${platform} 不可用`)
}

export function assertCliEnvironment(environment: CliEnvironment): void {
    assertSupportedPlatform(environment.platform)
    if (!environment.stdinIsTTY || !environment.stdoutIsTTY) throw new Error("Arrange CLI 需要交互终端，stdin 和 stdout 都必须连接 TTY；请在 Windows 或 macOS 终端运行")
}
