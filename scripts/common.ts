import { spawn } from "node:child_process"
import type { SpawnOptions } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

export const repoRoot = resolve(import.meta.dirname, "..")

export function run(command: string, args: readonly string[] = [], options: SpawnOptions = {}): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd: repoRoot,
            stdio: "inherit",
            shell: false,
            ...options,
        })
        child.on("error", reject)
        child.on("exit", (code) => {
            if (code === 0) resolvePromise()
            else reject(new Error(`${command} 执行失败，退出码 ${code}`))
        })
    })
}

export function npmSubprocessEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    const noisyPnpmForwardedKeys = new Set([
        "npm_config__jsr_registry",
        "npm_config_catalog",
        "npm_config_link_workspace_packages",
        "npm_config_npm_globalconfig",
        "npm_config_store_dir",
        "npm_config_verify_deps_before_run",
    ])
    for (const key of Object.keys(env)) {
        if (noisyPnpmForwardedKeys.has(key.toLowerCase())) delete env[key]
    }
    const emptyGlobalConfig = resolve(repoRoot, "build", "npm-empty-global.npmrc")
    if (!existsSync(emptyGlobalConfig)) {
        mkdirSync(resolve(repoRoot, "build"), { recursive: true })
        writeFileSync(emptyGlobalConfig, "")
    }
    env.npm_config_globalconfig = emptyGlobalConfig
    return env
}
