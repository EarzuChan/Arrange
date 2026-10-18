import type { LocalDefinition } from "../project/ProjectState.ts"
import type { Executor } from "./Executor.ts"

export interface ToolchainIssue {
    readonly key: string
    readonly label: string
    readonly message: string
}

export interface NativeToolchainDiscovery {
    readonly local: LocalDefinition
    readonly issues: readonly ToolchainIssue[]
}

export abstract class PlatformService {
    abstract readonly name: "darwin" | "win32"
    constructor(protected readonly executor: Executor) { }
    abstract nativeEnvironment(local: LocalDefinition): Promise<Record<string, string>>
    abstract discoverNative(local: LocalDefinition): Promise<NativeToolchainDiscovery>

}
