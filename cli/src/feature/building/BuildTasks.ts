import type { CmakeModel } from '../cmake/CmakeService.ts'
import type { TaskEntry, TaskRunner } from '../operation/Work.ts'
import type { BuildFlavor, NativeProduct, ProjectState } from '../project/ProjectState.ts'
import type { NativeBuildService } from './NativeBuildService.ts'
import { uiScriptFormat, type UiBuildService } from './UiBuildService.ts'

export async function runBuilds(tasks: TaskRunner, state: ProjectState, flavor: BuildFlavor, ui: UiBuildService | undefined, native: NativeBuildService | undefined, products: readonly NativeProduct[], clean?: boolean): Promise<void> {
    const entries: TaskEntry[] = []
    const bytecode = ui !== undefined && uiScriptFormat(state) === 'bytecode'
    let resolveEngine: (model: CmakeModel) => void = () => { }
    let rejectEngine: (error: unknown) => void = () => { }
    const engine = bytecode && native ? new Promise<CmakeModel>((resolve, reject) => {
        resolveEngine = resolve
        rejectEngine = reject
    }) : undefined
    // Native can fail before Vite reaches the point where it needs the compiler.
    void engine?.catch(() => { })
    if (ui) entries.push({
        spec: { id: 'build-ui', title: '构建 UI', detail: `${state.project.ui.packageManager} run build`, rootDir: state.rootDir },
        run: output => ui.build(state, output, flavor, engine),
    })
    if (native) entries.push({
        spec: { id: `build-native-${flavor}`, title: `构建 native · ${flavor}`, detail: products.join(', '), rootDir: state.rootDir },
        async run(output) {
            try {
                const model = await native.build(state, flavor, products, output, clean, bytecode)
                resolveEngine(model)
            } catch (error) {
                rejectEngine(error)
                throw error
            }
        },
    })
    await tasks.all(entries)
}
