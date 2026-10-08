import { isAbsolute, relative, resolve, sep } from "node:path"
import { lstat } from "node:fs/promises"
import { defaultUiOutputDirectory, localWorkDirectory } from "../CliMetadata.ts"
import type { ProjectState } from "./ProjectState.ts"

export function uiDirectory(state: ProjectState): string { return resolve(state.rootDir, state.project.ui.directory) }
export function nativeDirectory(state: ProjectState): string { return resolve(state.rootDir, state.project.native.directory) }
export function workDirectory(state: ProjectState): string { return resolve(state.rootDir, localWorkDirectory) }

export function containedDirectory(base: string, directory: string, label: string): string {
    const result = resolve(base, directory)
    const part = relative(resolve(base), result)
    if (!part || part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error(`${label} 必须位于 ${base} 内的独立子目录`)
    return result
}

export function uiOutputDirectory(state: ProjectState): string {
    const base = uiDirectory(state)
    const output = containedDirectory(base, state.project.ui.outputDirectory ?? defaultUiOutputDirectory, "UI 产物目录")
    if (relative(base, output).split(sep).some(part => ["src", "scripts", "node_modules", ".git", localWorkDirectory].includes(part))) throw new Error("UI 产物目录不能覆盖源码、脚本、依赖或工作目录")
    return output
}

export async function safeUiOutputDirectory(state: ProjectState): Promise<string> {
    const output = uiOutputDirectory(state)
    let current = uiDirectory(state)
    for (const part of relative(current, output).split(sep)) {
        current = resolve(current, part)
        const info = await lstat(current).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            return undefined
        })
        if (info && !info.isDirectory()) throw new Error(`UI 产物路径含有符号链接或非目录：${current}`)
    }
    return output
}
