import { intro, isCancel, log, select } from "@clack/prompts"
import { readFile, stat } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { defaultProjectDirectories, frameworkPackageName } from "../CliMetadata.ts"
import type { FrameworkRegistryClient } from "../framework/FrameworkRegistryClient.ts"
import type { ConfigRegistry } from "../config/ConfigRegistry.ts"
import { createInitialProjectState } from "../project/CreateProject.ts"
import type { AdoptProjectRequest, SubprojectInput } from "../project/ProjectInitializer.ts"
import { PromptCancelled, requiredText } from "../util/PromptUtils.ts"
import { isJsonObject } from "../util/Utils.ts"
import { promptManagedItems, promptProjectDetails, validateRelativeDirectory, type ProjectWizardInput, type UiSuggestions } from "./Project.ts"

interface SubprojectChoice {
    readonly directory: string
    readonly input: SubprojectInput
    readonly source?: string
}

export async function runAdoptWizard(registry: FrameworkRegistryClient, config: ConfigRegistry, input: ProjectWizardInput = {}): Promise<false | AdoptProjectRequest> {
    try {
        intro("接入已有 Arrange 工程")
        const rootDir = process.cwd()
        const native = await promptSubproject("native", rootDir)
        const ui = await promptSubproject("ui", rootDir)
        const suggestions = ui.source ? await readUiSuggestions(ui.source) : {}
        const details = await promptProjectDetails(registry, input, suggestions)
        const target = native.input.kind === "new" ? details.projectName : await requiredText("已有 JUCE 插件根 target（请按 CMake 实际名称填写）", { validate: value => /^[A-Za-z_][A-Za-z0-9_.+-]*$/.test(value) ? undefined : "请输入合法的 CMake target 名称" })
        const artifactsDirectory = await requiredText("Artifacts 目录", { initialValue: defaultProjectDirectories.artifacts, validate: validateRelativeDirectory })
        const managedItems = await promptManagedItems(config.items.filter(item => native.input.kind === "new" || details.iconSource !== undefined || item.id !== "cmake.product-icon"))
        const state = createInitialProjectState({ ...details, rootDir, uiDirectory: ui.directory, nativeDirectory: native.directory, artifactsDirectory, managedItems })
        state.project.native.target = target
        log.info("已有源文件不生成或替换；选中的文本托管项将在 CONFIG 中由你补 Wrapper 或放 Marker，受管正文按共享配置更新")
        return { state, ui: ui.input, native: native.input, iconSource: details.iconSource }
    } catch (error) {
        if (error instanceof PromptCancelled) {
            log.info("已取消接入；未写工程文件")
            return false
        }

        throw error
    }
}

async function promptSubproject(scope: "ui" | "native", rootDir: string): Promise<SubprojectChoice> {
    const choice = await select({ message: `${scope} 接入方式`, options: [{ label: "原位引用已有目录", value: "existing" as const }, { label: "复制已有目录", value: "copy" as const }, { label: "新建", value: "new" as const }] })
    if (isCancel(choice)) throw new PromptCancelled()

    if (choice === "new") return { directory: await requiredText(`${scope} 新建目录`, { initialValue: defaultProjectDirectories[scope], validate: validateRelativeDirectory }), input: { kind: "new" } }
    const source = resolve(await requiredText(`${scope} 已有目录（相对于当前目录或绝对路径）`))
    const entry = resolve(source, scope === "ui" ? "package.json" : "CMakeLists.txt")
    if (!(await stat(entry)).isFile()) throw new Error(`${entry} 不是可接入的文件`)
    const relativeSource = relative(rootDir, source).replaceAll("\\", "/") || "."
    if (choice === "existing") return { directory: relativeSource, input: { kind: "existing" }, source }
    const directory = await requiredText(`${scope} 复制目的目录`, { initialValue: defaultProjectDirectories[scope], validate: validateRelativeDirectory })
    return { directory, input: resolve(rootDir, directory) === source ? { kind: "existing" } : { kind: "copy", sourceDir: source }, source }
}

export async function readUiSuggestions(source: string): Promise<UiSuggestions> {
    const json: unknown = JSON.parse(await readFile(resolve(source, "package.json"), "utf8"))
    if (!isJsonObject(json)) throw new Error("UI package.json 须为 JSON 对象")
    log.info(`UI package.json：${typeof json.name === "string" ? json.name : "未声明 name"} / ${typeof json.version === "string" ? json.version : "未声明 version"}；以下建议请自行确认`)
    const dependency = isJsonObject(json.dependencies) ? json.dependencies[frameworkPackageName] : undefined
    const packageManager = typeof json.packageManager === "string" ? json.packageManager.split("@")[0] : undefined
    return { name: typeof json.name === "string" ? json.name : undefined, version: typeof json.version === "string" ? json.version : undefined, frameworkVersion: typeof dependency === "string" ? dependency : undefined, packageManager: packageManager === "npm" || packageManager === "pnpm" ? packageManager : undefined }
}
