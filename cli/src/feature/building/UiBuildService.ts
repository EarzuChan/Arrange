import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { defaultUiScriptFormat, uiManifestName } from '../../CliMetadata.ts'
import type { CmakeModel, CmakeService } from '../cmake/CmakeService.ts'
import type { NodeJsService } from '../nodejs/NodeJsService.ts'
import type { TaskOutput } from '../operation/Work.ts'
import { safeUiOutputDirectory } from '../project/ProjectPaths.ts'
import type { BuildFlavor, ProjectState } from '../project/ProjectState.ts'
import { verifyUiBuildInput, verifyUiPackage } from '../packing/UiPackage.ts'
import { recordBuild } from './BuildReceipt.ts'

export function uiScriptFormat(state: ProjectState): 'bytecode' | 'js' {
    return state.project.ui.scriptFormat ?? defaultUiScriptFormat
}

export class UiBuildService {
    constructor(private readonly node: Pick<NodeJsService, 'build'>, private readonly cmake: Pick<CmakeService, 'compileUi'>) { }

    async build(state: ProjectState, task: TaskOutput, flavor: BuildFlavor, native?: Promise<CmakeModel>): Promise<string> {
        const output = await safeUiOutputDirectory(state)
        const framework = state.project.framework.version
        const scriptFormat = uiScriptFormat(state)
        const build = await recordBuild(state, 'ui', { scriptFormat }, async () => {
            await mkdir(dirname(output), { recursive: true })
            const stage = await mkdtemp(join(dirname(output), '.arrange-ui-build-'))
            const input = join(stage, 'esm')
            const assembled = join(stage, 'dist')
            const backup = join(stage, 'previous')
            let keepStage = false
            try {
                await this.node.build(state, task, input, scriptFormat)
                const { manifest, entries } = await verifyUiBuildInput(input, framework, scriptFormat)
                let engine: string | undefined
                if (scriptFormat === 'bytecode') {
                    const modules = join(stage, 'modules.txt')
                    await writeFile(modules, entries.filter(row => row.kind === 'module').map(row => row.path).join('\n') + '\n')
                    engine = await this.cmake.compileUi(state, flavor, task, input, assembled, modules, await native)
                }
                for (const row of entries) {
                    if (row.kind === 'module' && scriptFormat === 'bytecode') {
                        const bytes = await readFile(join(assembled, row.path))
                        row.size = bytes.length
                        row.sha256 = createHash('sha256').update(bytes).digest('hex')
                    } else {
                        const target = join(assembled, row.path)
                        await mkdir(dirname(target), { recursive: true })
                        await copyFile(join(input, row.path), target)
                    }
                }
                await writeFile(join(assembled, uiManifestName), JSON.stringify({ ...manifest, scriptFormat, engine }, null, 2) + '\n')
                const final = await verifyUiPackage(assembled, framework)
                await safeUiOutputDirectory(state)
                let moved = false
                try {
                    await rename(output, backup)
                    moved = true
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
                }
                try {
                    await rename(assembled, output)
                } catch (error) {
                    if (moved) {
                        try { await rename(backup, output) } catch (rollback) {
                            keepStage = true
                            throw new AggregateError([error, rollback], `UI 输出替换和恢复失败，原输出保留在 ${backup}`)
                        }
                    }
                    throw error
                }
                return { path: output, digest: final.digest, engine }
            } finally {
                if (!keepStage) await rm(stage, { recursive: true, force: true })
            }
        }, result => result)
        return build.path
    }
}
