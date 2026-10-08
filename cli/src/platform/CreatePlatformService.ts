import { assertSupportedPlatform } from "../CliEnvironment.ts"
import type { Executor } from "./Executor.ts"
import type { PlatformService } from "./PlatformService.ts"
import { MacPlatformService } from "./MacPlatformService.ts"
import { WindowsPlatformService } from "./WindowsPlatformService.ts"

export function createPlatformService(executor: Executor, platform: NodeJS.Platform = process.platform): PlatformService {
    assertSupportedPlatform(platform)
    return platform === "win32" ? new WindowsPlatformService(executor) : new MacPlatformService(executor)
}
