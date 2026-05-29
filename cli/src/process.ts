import {spawn} from "node:child_process"
import {existsSync} from "node:fs"
import {resolve} from "node:path"

export type RunOptions = {
    cwd?: string
    env?: NodeJS.ProcessEnv
    allowFailure?: boolean
}

export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            stdio: "inherit",
            shell: false,
            windowsVerbatimArguments: false,
        })
        child.on("error", reject)
        child.on("exit", (code) => {
            if (code === 0 || options.allowFailure) resolvePromise()
            else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))
        })
    })
}

export function commandName(base: string): string {
    return process.platform === "win32" ? `${base}.cmd` : base
}

export function cmakeExe(): string {
    return process.env.CMAKE_EXE || "cmake"
}

export function defaultCmakeGenerator(): string | undefined {
    return process.env.CMAKE_GENERATOR || undefined
}

export function platformArch(): string {
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform
    const arch = process.arch === "x64" ? "x64" : process.arch
    return `${platform}-${arch}`
}

export function pathExists(path: string): boolean {
    return existsSync(resolve(path))
}