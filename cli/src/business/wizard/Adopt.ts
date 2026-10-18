import { isCancel, select } from "../../terminal/Prompts.ts"
import { readFile, stat } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { defaultProjectDirectories, frameworkPackageName } from "../../CliMetadata.ts"
import type { FrameworkRegistryClient } from "../../feature/framework/FrameworkRegistryClient.ts"
import type { ConfigRegistry } from "../../feature/config/ConfigRegistry.ts"
import { createInitialProjectState } from "../../feature/project/CreateProject.ts"
import type { AdoptProjectRequest, SubprojectInput } from "../../feature/project/ProjectInitializer.ts"
import { PromptCancelled, requiredText } from "../PromptUtils.ts"
import { isJsonObject } from "../../util/Utils.ts"
import type { CommandInterface } from "../CommandInterface.ts"
import type { Reporter } from "../../terminal/Reporter.ts"
import { promptManagedItems, promptProjectDetails, validateRelativeDirectory, type ProjectWizardInput, type UiSuggestions } from "./Project.ts"

interface SubprojectChoice {
    readonly directory: string
    readonly input: SubprojectInput
    readonly source?: string
}

export async function runAdoptWizard(terminal: CommandInterface, registry: FrameworkRegistryClient, config: ConfigRegistry, input: ProjectWizardInput = {}): Promise<false | AdoptProjectRequest> {
    const io = terminal.prompt
    try {
        terminal.reporter.intro("接入已有 Arrange 工程")
        const rootDir = process.cwd()
        const native = await promptSubproject(terminal, "native", rootDir)
        const ui = await promptSubproject(terminal, "ui", rootDir)
        const suggestions = ui.source ? await readUiSuggestions(ui.source, terminal.reporter) : {}
        const details = await promptProjectDetails(terminal, registry, input, suggestions)
        const target = native.input.kind === "new" ? details.projectName : await requiredText(io, "已有 JUCE 插件根 target（请按 CMake 实际名称填写）", { validate: value => /^[A-Za-z_][A-Za-z0-9_.+-]*$/.test(value) ? undefined : "请输入合法的 CMake target 名称" })
        const artifactsDirectory = await requiredText(io, "Artifacts 目录", { initialValue: defaultProjectDirectories.artifacts, validate: validateRelativeDirectory })
        const managedItems = await promptManagedItems(terminal, config.items.filter(item => native.input.kind === "new" || details.iconSource !== undefined || item.id !== "cmake.product-icon"))
        const state = createInitialProjectState({ ...details, rootDir, uiDirectory: ui.directory, nativeDirectory: native.directory, artifactsDirectory, managedItems })
        state.project.native.target = target
        terminal.reporter.info("已有源文件不生成或替换；选中的文本托管项将在 CONFIG 中由你补 Wrapper 或放 Marker，受管正文按共享配置更新")
        return { state, ui: ui.input, native: native.input, iconSource: details.iconSource }
    } catch (error) {
        if (error instanceof PromptCancelled) return false

        throw error
    }
}

async function promptSubproject(terminal: CommandInterface, scope: "ui" | "native", rootDir: string): Promise<SubprojectChoice> {
    const io = terminal.prompt
    const choice = await select({ ...io, message: `${scope} 接入方式`, options: [{ label: "原位引用已有目录", value: "existing" as const }, { label: "复制已有目录", value: "copy" as const }, { label: "新建", value: "new" as const }] })
    if (isCancel(choice)) throw new PromptCancelled()

    if (choice === "new") return { directory: await requiredText(io, `${scope} 新建目录`, { initialValue: defaultProjectDirectories[scope], validate: validateRelativeDirectory }), input: { kind: "new" } }
    const source = resolve(await requiredText(io, `${scope} 已有目录（相对于当前目录或绝对路径）`))
    const entry = resolve(source, scope === "ui" ? "package.json" : "CMakeLists.txt")
    if (!(await stat(entry)).isFile()) throw new Error(`${entry} 不是可接入的文件`)
    const relativeSource = relative(rootDir, source).replaceAll("\\", "/") || "."
    if (choice === "existing") return { directory: relativeSource, input: { kind: "existing" }, source }
    const directory = await requiredText(io, `${scope} 复制目的目录`, { initialValue: defaultProjectDirectories[scope], validate: validateRelativeDirectory })
    return { directory, input: resolve(rootDir, directory) === source ? { kind: "existing" } : { kind: "copy", sourceDir: source }, source }
}

export async function readUiSuggestions(source: string, reporter: Reporter): Promise<UiSuggestions> {
    const json: unknown = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"))
    if (!isJsonObject(json)) throw new Error("UI package.json 须为 JSON 对象")
    reporter.info(`UI package.json：${typeof json.name === "string" ? json.name : "未声明 name"} / ${typeof json.version === "string" ? json.version : "未声明 version"}；以下建议请自行确认`)
    if (!await stat(resolve(source, "tsconfig.json")).then(info => info.isFile(), () => false)) reporter.info("UI 目录没有 tsconfig.json。这不影响 SFA 构建，但编辑器提示和 SFA 类型检查需要它；可参考 arrange create 生成的 ui/tsconfig.json")
    const dependency = isJsonObject(json.dependencies) ? json.dependencies[frameworkPackageName] : undefined
    const packageManager = typeof json.packageManager === "string" ? json.packageManager.split("@")[0] : undefined
    return { name: typeof json.name === "string" ? json.name : undefined, version: typeof json.version === "string" ? json.version : undefined, frameworkVersion: typeof dependency === "string" ? dependency : undefined, packageManager: packageManager === "npm" || packageManager === "pnpm" ? packageManager : undefined }
}
