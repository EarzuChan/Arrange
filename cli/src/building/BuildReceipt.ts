import { join } from "node:path"
import type { ProjectState } from "../project/ProjectState.ts"
import { workDirectory } from "../project/ProjectPaths.ts"
import { writeJsonFile } from "../util/JsonFile.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"

export async function recordBuild<T>(state: ProjectState, name: string, details: Record<string, unknown>, build: () => Promise<T>, completed: (result: T) => Record<string, unknown>): Promise<T> {
    const path = join(workDirectory(state), `built-${name}.json`)
    const metadata = { projectVersion: state.project.project.version, frameworkVersion: state.project.framework.version, ...details }
    await assertPlainDirectoryPath(state.rootDir, workDirectory(state))
    await writeJsonFile(path, { ...metadata, status: "building" })
    try {
        const result = await build()
        await writeJsonFile(path, { ...metadata, ...completed(result), status: "completed" })
        return result
    } catch (error) {
        await writeJsonFile(path, { ...metadata, status: "failed", error: error instanceof Error ? error.message : String(error) })
        throw error
    }
}
