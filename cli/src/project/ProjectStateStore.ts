import { join, resolve } from "node:path"
import { parseDocument, stringify } from "yaml"
import { localDefinitionSchema, projectDefinitionSchema, projectStateSchema, type ProjectState } from "./ProjectState.ts"
import { writeTextFile } from "../util/Utils.ts"
import { errorMessage } from "../util/Utils.ts"
import { readSnapshot, type FileSnapshot } from "../util/FileUtils.ts"

export const projectFileNames = { project: "arrange.project.yaml", local: "arrange.local.yaml" } as const
export interface StateDiagnostic { readonly path: string, readonly message: string }

export class ProjectStateStore {
    async deepLoad(rootDir: string) {
        const root = resolve(rootDir)

        const snapshots: FileSnapshot[] = []
        const errors: StateDiagnostic[] = []

        const read = async (name: string, optional: boolean): Promise<unknown> => {
            const path = join(root, name)

            try {
                const snapshot = await readSnapshot(path)
                snapshots.push(snapshot)

                if (snapshot.content === null) {
                    if (!optional) throw new Error("配置文件不存在")
                    return null
                }

                const doc = parseDocument(snapshot.content)
                if (doc.errors.length) throw new Error(doc.errors.map(error => error.message).join("\n"))

                return doc.toJS()
            } catch (error) {
                errors.push({ path, message: errorMessage(error) })
                return undefined
            }
        }

        const projectRaw = await read(projectFileNames.project, false)
        const project = projectDefinitionSchema.safeParse(projectRaw)
        if (!project.success && projectRaw !== undefined) errors.push({ path: join(root, projectFileNames.project), message: project.error.message })

        const localRaw = await read(projectFileNames.local, true)
        const local = localDefinitionSchema.nullable().safeParse(localRaw)
        if (!local.success && localRaw !== undefined) errors.push({ path: join(root, projectFileNames.local), message: local.error.message })

        // CONFIG 不依赖本机工具状态；local 的诊断仍阻止任何写入
        const state: ProjectState | null = project.success ? { rootDir: root, project: project.data, local: local.success ? local.data : null } : null
        return { state, snapshots, errors }
    }

    async load(rootDir: string): Promise<ProjectState> {
        const result = await this.deepLoad(rootDir)
        if (result.errors.length || result.state === null) throw new Error(result.errors.map(error => `${error.path}: ${error.message}`).join("\n"))
        return result.state
    }

    async save(state: ProjectState): Promise<void> {
        const validated = projectStateSchema.parse(state)
        await writeTextFile(join(state.rootDir, projectFileNames.project), stringify(validated.project))
        if (validated.local !== null) await writeTextFile(join(state.rootDir, projectFileNames.local), stringify(validated.local))
    }
}