import { join } from "node:path"
import type { BuildFlavor, ProjectState } from "../project/ProjectState.ts"
import { workDirectory } from "../project/ProjectPaths.ts"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { writeAtomicText } from "../../util/AtomicFile.ts"
import { mkdir } from "node:fs/promises"

export function nativeBuildRecordName(state: ProjectState, flavor: BuildFlavor, platform: "win32" | "darwin"): string {
    if (!state.local?.native) throw new Error("native 构建记录需要已确认的架构")
    return `native-${platform}-${state.local.native.architecture}-${flavor}`
}

export async function recordBuild<T>(state: ProjectState, name: string, details: Record<string, unknown>, build: () => Promise<T>, completed: (result: T) => Record<string, unknown>): Promise<T> {
    const path = join(workDirectory(state), `built-${name}.json`)
    const metadata = { projectVersion: state.project.project.version, frameworkVersion: state.project.framework.version, ...details }
    await assertPlainDirectoryPath(state.rootDir, workDirectory(state))
    await mkdir(workDirectory(state), { recursive: true })
    const write = (value: unknown) => writeAtomicText(path, `${JSON.stringify(value, null, 4)}\n`)
    await write({ ...metadata, status: "building" })
    try {
        const result = await build()
        await write({ ...metadata, ...completed(result), status: "completed" })
        return result
    } catch (error) {
        await write({ ...metadata, status: "failed", error: error instanceof Error ? error.message : String(error) })
        throw error
    }
}
