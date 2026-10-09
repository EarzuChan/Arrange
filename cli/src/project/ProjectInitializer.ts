import { randomUUID } from "node:crypto"
import { cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { stringify } from "yaml"
import { defaultProjectIconPath, defaultUiOutputDirectory, localWorkDirectory } from "../CliMetadata.ts"
import { iconFingerprint, loadPngIconSource, projectIconSourcePath } from "../asset/PngIcon.ts"
import { configRegistry } from "../config/ConfigRegistry.ts"
import type { FileTransaction, FileChange } from "../util/FileTransaction.ts"
import { assertSnapshots, readSnapshot, type FileSnapshot } from "../util/FileUtils.ts"
import { errorMessage } from "../util/Utils.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { writeJsonFile } from "../util/JsonFile.ts"
import { createInitialProjectState, type CreateProjectRequest } from "./CreateProject.ts"
import { projectStateSchema, type ProjectState } from "./ProjectState.ts"
import { projectFileNames } from "./ProjectStateStore.ts"
import { nativeStarterFiles, uiStarterFiles, type InitialFile } from "./StarterFiles.ts"

export type SubprojectInput = { readonly kind: "new" } | { readonly kind: "existing" } | { readonly kind: "copy", readonly sourceDir: string }

export interface AdoptProjectRequest {
    readonly state: ProjectState
    readonly ui: SubprojectInput
    readonly native: SubprojectInput
    readonly iconSource?: string
}

export interface CopyPlan {
    readonly source: string
    readonly destination: string
}

interface IconSourcePlan {
    readonly source: string
    readonly destination: string
    readonly fingerprint: string
}

export type IconPlan = IconSourcePlan & ({ readonly kind: "copy", readonly bytes: Buffer } | { readonly kind: "existing" })

export interface InitializationPlan {
    readonly state: ProjectState
    readonly files: readonly FileChange[]
    readonly guards: readonly FileSnapshot[]
    readonly copies: readonly CopyPlan[]
    readonly icons: readonly IconPlan[]
}

interface InitializationJournal {
    readonly id: string
    readonly state: ProjectState
    readonly files: readonly string[]
    readonly copies: { source: string, destination: string, copied: boolean }[]
    readonly icons: { kind: IconPlan["kind"], source: string, destination: string, fingerprint: string, copied: boolean }[]
    status: "initializing" | "complete" | "failed"
    error?: string
}

const excludedCopyNames = new Set([".git", localWorkDirectory, "node_modules", projectFileNames.local])

export class ProjectInitializer {
    constructor(private readonly writer: FileTransaction, private readonly defaultSignal?: AbortSignal) { }

    planCreate(request: CreateProjectRequest): Promise<InitializationPlan> {
        return this.plan({ state: createInitialProjectState(request), ui: { kind: "new" }, native: { kind: "new" }, iconSource: request.iconSource })
    }

    async create(request: CreateProjectRequest): Promise<ProjectState> {
        return this.apply(await this.planCreate(request))
    }

    planAdopt(request: AdoptProjectRequest): Promise<InitializationPlan> {
        return this.plan(request)
    }

    async adopt(request: AdoptProjectRequest): Promise<ProjectState> {
        return this.apply(await this.planAdopt(request))
    }

    private async plan(request: AdoptProjectRequest): Promise<InitializationPlan> {
        const state = projectStateSchema.parse({ ...request.state, rootDir: resolve(request.state.rootDir) })
        if (request.iconSource !== undefined) state.project.project.icon = defaultProjectIconPath
        if (request.native.kind !== "new" && state.project.project.icon === undefined) state.project["managed-items"] = state.project["managed-items"].filter(id => id !== "cmake.product-icon")
        const directories = [state.project.ui.directory, state.project.native.directory, state.project.artifacts.directory].map(directory => resolve(state.rootDir, directory))
        for (let i = 0; i < directories.length; i++) for (let j = i + 1; j < directories.length; j++) if (contains(directories[i], directories[j]) || contains(directories[j], directories[i])) throw new Error("UI、native 与 artifacts 目录必须相互独立")
        if (directories.some(directory => contains(directory, state.rootDir))) throw new Error("子项目和 artifacts 不能占用工程根或其祖先目录")
        const reservedPaths = [localWorkDirectory, ".git", "node_modules", ...Object.values(projectFileNames)].map(name => resolve(state.rootDir, name))
        if (directories.some(directory => reservedPaths.some(path => contains(directory, path) || contains(path, directory)))) throw new Error("UI、native 与 artifacts 目录不能与 CLI 保留路径重叠：.arrange、.git、node_modules、arrange.project.yaml、arrange.local.yaml")
        if (!contains(state.rootDir, directories[2])) throw new Error("artifacts 必须位于工程根内")

        const icons: IconPlan[] = []
        if (request.iconSource !== undefined) {
            const source = await loadPngIconSource(resolve(request.iconSource))
            const destination = resolve(state.rootDir, defaultProjectIconPath)
            const assets = dirname(destination)
            if (directories.some(directory => contains(directory, assets) || contains(assets, directory))) throw new Error("图标 assets 目录必须与 UI、native 和 artifacts 目录相互独立")
            if (source.path === destination) {
                await projectIconSourcePath(state)
                icons.push({ kind: "existing", source: source.path, destination, fingerprint: source.fingerprint })
            } else {
                await assertMissing(destination)
                icons.push({ kind: "copy", source: source.path, destination, bytes: source.bytes, fingerprint: source.fingerprint })
            }
        }

        const guards: FileSnapshot[] = []
        for (const name of Object.values(projectFileNames)) {
            const path = resolve(state.rootDir, name)
            await assertMissing(path)
            guards.push({ path, content: null })
        }

        const copies: CopyPlan[] = []
        const generated: InitialFile[] = []
        for (const scope of ["ui", "native"] as const) {
            const input = request[scope]
            const directory = resolve(state.rootDir, state.project[scope].directory)
            if (input.kind === "new") {
                if (!contains(state.rootDir, directory)) throw new Error(`新建 ${scope} 必须位于工程根内`)
                const definitions = configRegistry.files.filter(file => file.scope === (scope === "ui" ? "UI" : "Native"))
                generated.push(...definitions.map(file => ({ path: file.path(state), content: file.make(state) })), ...(scope === "ui" ? uiStarterFiles(state) : nativeStarterFiles(state)))
            } else {
                const source = input.kind === "copy" ? resolve(input.sourceDir) : directory
                const entry = resolve(source, scope === "ui" ? "package.json" : "CMakeLists.txt")
                if (!(await stat(entry)).isFile()) throw new Error(`不能接入 ${scope}：${entry} 不是文件`)
                if (input.kind === "copy" && source !== directory) {
                    if (!contains(state.rootDir, directory)) throw new Error(`复制 ${scope} 的目的目录必须位于工程根内`)
                    if (contains(source, directory) || contains(directory, source)) throw new Error("复制源与目的目录不能互相包含")
                    await assertMissing(directory)
                    copies.push({ source, destination: directory })
                }
            }
        }

        const files: FileChange[] = []
        for (const file of generated) {
            await assertMissing(file.path)
            files.push({ before: { path: file.path, content: null }, after: file.content })
        }

        const gitignore = await readSnapshot(resolve(state.rootDir, ".gitignore"))
        const uiOutput = relative(state.rootDir, resolve(directories[0], state.project.ui.outputDirectory ?? defaultUiOutputDirectory))
        const artifacts = relative(state.rootDir, directories[2])
        const patterns = [`/${localWorkDirectory}/`, `/${projectFileNames.local}`, "node_modules/", ...(!uiOutput.startsWith("..") && !isAbsolute(uiOutput) ? [`/${portablePath(uiOutput)}/`] : []), `/${portablePath(artifacts)}/`]
        const original = gitignore.content ?? ""
        const existingLines = new Set(original.split(/\r?\n/))
        const missingPatterns = patterns.filter(pattern => !existingLines.has(pattern))
        if (missingPatterns.length) {
            const newline = original.includes("\r\n") ? "\r\n" : "\n"
            files.push({ before: gitignore, after: original + (original && !original.endsWith("\n") ? newline : "") + missingPatterns.join(newline) + newline })
        }

        files.push({ before: guards[0], after: stringify(state.project) })
        return { state, copies, icons, files, guards }
    }

    async apply(plan: InitializationPlan): Promise<ProjectState> {
        this.defaultSignal?.throwIfAborted()
        await assertSnapshots([...plan.guards, ...plan.files.map(file => file.before)])
        for (const copy of plan.copies) await assertMissing(copy.destination)
        for (const icon of plan.icons) {
            await assertIconSource(plan.state, icon)
            if (icon.kind === "copy") await assertMissing(icon.destination)
        }
        this.defaultSignal?.throwIfAborted()
        await mkdir(plan.state.rootDir, { recursive: true })
        this.defaultSignal?.throwIfAborted()
        const id = randomUUID()
        const journalPath = resolve(plan.state.rootDir, localWorkDirectory, "initializations", `${id}.json`)
        const journal: InitializationJournal = { id, state: plan.state, files: plan.files.map(file => file.before.path), copies: plan.copies.map(copy => ({ ...copy, copied: false })), icons: plan.icons.map(icon => ({ kind: icon.kind, source: icon.source, destination: icon.destination, fingerprint: icon.fingerprint, copied: false })), status: "initializing" }
        await this.saveJournal(journalPath, journal)
        try {
            for (const copy of journal.copies) {
                this.defaultSignal?.throwIfAborted()
                await assertSnapshots(plan.guards)
                await this.copyDirectory(copy)
                copy.copied = true
                await this.saveJournal(journalPath, journal)
            }
            for (let i = 0; i < plan.icons.length; i++) {
                this.defaultSignal?.throwIfAborted()
                await assertSnapshots(plan.guards)
                const icon = plan.icons[i]
                await assertIconSource(plan.state, icon)
                if (icon.kind === "copy") {
                    await this.copyIcon(plan.state.rootDir, icon)
                    journal.icons[i].copied = true
                }
                await this.saveJournal(journalPath, journal)
            }
            await this.writer.write(plan.state.rootDir, plan.files, plan.guards)
        } catch (error) {
            journal.status = "failed"
            journal.error = errorMessage(error)
            if ((this.defaultSignal?.aborted && error === this.defaultSignal.reason) || (error instanceof Error && error.name === "AbortError")) {
                await this.saveJournal(journalPath, journal).catch(() => { })
                const cancelled = new Error(`工程初始化已取消；已创建内容与接入计划记录于 ${journalPath}：${journal.error}`, { cause: error })
                cancelled.name = "AbortError"
                throw cancelled
            }
            await this.saveJournal(journalPath, journal)
            throw new Error(`工程初始化未完成；已写内容保留，接入计划记录于 ${journalPath}。有共享配置时可用 sync 继续；配置未写入时请按记录检查已创建文件：${journal.error}`, { cause: error })
        }

        journal.status = "complete"
        try {
            await this.removeJournal(journalPath)
        } catch {
            await this.saveJournal(journalPath, journal).catch(() => { })
        }
        return plan.state
    }

    protected async copyDirectory(copy: CopyPlan): Promise<void> {
        this.defaultSignal?.throwIfAborted()
        await mkdir(dirname(copy.destination), { recursive: true })
        await mkdir(copy.destination)
        for (const name of await readdir(copy.source)) await cp(resolve(copy.source, name), resolve(copy.destination, name), {
            recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true, filter: source => {
                this.defaultSignal?.throwIfAborted()
                return !excludedCopyNames.has(basename(source))
            }
        })
    }

    protected async removeJournal(path: string): Promise<void> {
        await rm(path, { force: true })
    }

    private async copyIcon(root: string, icon: Extract<IconPlan, { kind: "copy" }>): Promise<void> {
        const directory = dirname(icon.destination)
        await assertPlainDirectoryPath(root, directory)
        await mkdir(directory, { recursive: true })
        this.defaultSignal?.throwIfAborted()
        await assertPlainDirectoryPath(root, directory)
        await writeFile(icon.destination, icon.bytes, { flag: "wx" })
    }

    private async saveJournal(path: string, journal: InitializationJournal): Promise<void> {
        await assertPlainDirectoryPath(journal.state.rootDir, dirname(path))
        await mkdir(dirname(path), { recursive: true })
        try {
            await writeFile(resolve(journal.state.rootDir, localWorkDirectory, ".gitignore"), "*\n", { flag: "wx" })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        }
        await writeJsonFile(path, journal)
    }
}

function contains(parent: string, child: string): boolean {
    const path = relative(parent, child)
    return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function portablePath(path: string): string { return path.replaceAll("\\", "/") }

async function assertMissing(path: string): Promise<void> {
    try {
        await lstat(path)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
    }
    throw new Error(`目标已经存在，不会覆盖：${path}`)
}

async function assertIconSource(state: ProjectState, icon: IconPlan): Promise<void> {
    if (icon.kind === "existing") await projectIconSourcePath(state)
    const fingerprint = iconFingerprint(await readFile(icon.source))
    if (fingerprint !== icon.fingerprint) throw new Error(`图标源文件在确认后发生变化：${icon.source}`)
}
