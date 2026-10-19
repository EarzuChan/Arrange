import { confirm, group, isCancel, multiselect, select, text } from "../../terminal/Prompts.ts"
import { resolve } from "node:path"
import type { ManagedItem } from "../../feature/managed/ManageItems.ts"
import type { FrameworkService, VerifiedFrameworkVersion } from "../../feature/framework/FrameworkService.ts"
import type { CreateProjectRequest } from "../../feature/project/CreateProject.ts"
import type { InitializationPlan } from "../../feature/project/ProjectInitializer.ts"
import type { NativeProduct } from "../../feature/project/ProjectState.ts"
import { PromptCancelled, requiredText, validateFourCharCode, validateSemver } from "../PromptUtils.ts"
import { selectFrameworkVersion } from "./FrameworkVersion.ts"
import type { ProjectInteractionInput } from "../../feature/project/ProjectInteraction.ts"
import { effectiveBundleId, effectiveDisplayName, generateDefaultBundleId, validateBundleId, validateDisplayName } from "../../feature/project/ProjectMetadata.ts"
import type { CommandInterface } from "../CommandInterface.ts"
import { interactionStep } from '../InteractionStep.ts'

export type ProjectWizardInput = ProjectInteractionInput

export type ProjectDetails = Omit<CreateProjectRequest, "rootDir" | "uiDirectory" | "nativeDirectory" | "artifactsDirectory" | "managedItems" | "frameworkVersion"> & { readonly framework: VerifiedFrameworkVersion }

export interface UiSuggestions {
    readonly name?: string
    readonly version?: string
    readonly frameworkVersion?: string
    readonly packageManager?: "npm" | "pnpm"
}

export async function promptProjectDetails(terminal: CommandInterface, framework: FrameworkService, input: ProjectWizardInput, suggestions: UiSuggestions = {}): Promise<ProjectDetails> {
    const io = terminal.prompt
    const answers = await group({
        projectName: () => requiredText(io, "项目名称", { initialValue: suggestions.name && /^[A-Za-z][A-Za-z0-9_]*$/.test(suggestions.name) ? suggestions.name : undefined, validate: value => /^[A-Za-z][A-Za-z0-9_]*$/.test(value) ? undefined : "须以字母开头，仅使用字母、数字、下划线" }),
        projectVersion: () => requiredText(io, "项目版本", { initialValue: suggestions.version && !validateSemver(suggestions.version) ? suggestions.version : "1.0.0", validate: validateSemver }),
        framework: () => selectFrameworkVersion(terminal, framework, { registryUrl: input.nodeRegistryUrl, repositoryUrl: input.cmakeFetchContentUrl, suggestion: suggestions.frameworkVersion }),
        vendorName: () => requiredText(io, "厂商名称"),
        vendorCode: () => requiredText(io, "厂商四字符代码", { placeholder: "AbCd", validate: validateFourCharCode }),
        pluginCode: () => requiredText(io, "插件四字符代码", { placeholder: "EfGh", validate: validateFourCharCode }),
        pluginType: () => select({ ...io, message: "插件类型", options: [{ label: "效果器", value: "effect" as const }, { label: "乐器", value: "instrument" as const }] }),
        packageManager: () => select({ ...io, message: "UI 包管理器", initialValue: suggestions.packageManager ?? "pnpm", options: [{ label: "pnpm", value: "pnpm" as const }, { label: "npm", value: "npm" as const }] }),
        products: () => multiselect<NativeProduct>({ ...io, message: "产品", required: true, options: [{ label: "独立程序（Standalone）", value: "standalone" }, { label: "VST3", value: "vst3" }], initialValues: ["standalone", "vst3"] }),
    }, { onCancel: () => { throw new PromptCancelled() } })
    const displayName = await optionalText(terminal, "产品显示名称（留空使用项目名称）", { placeholder: answers.projectName, validate: validateDisplayName })
    const bundleId = await optionalText(terminal, "macOS Bundle ID（留空生成并保存）", { placeholder: generateDefaultBundleId(answers), validate: validateBundleId })
    const iconSource = await optionalText(terminal, "PNG 图标源文件（留空使用系统默认或保留已有图标）", { placeholder: "正方形 PNG，边长至少 256 像素" })
    return { ...answers, displayName: displayName ?? answers.projectName, bundleId, iconSource: iconSource ? resolve(iconSource.trim()) : undefined, frameworkNodeRegistryUrl: input.nodeRegistryUrl, frameworkCmakeFetchContentUrl: input.cmakeFetchContentUrl }
}

async function optionalText(terminal: CommandInterface, message: string, options: { readonly placeholder?: string, readonly validate?: (value: string) => string | undefined }): Promise<string | undefined> {
    const value = await text({ ...terminal.prompt, message, placeholder: options.placeholder, validate: input => input?.trim() ? options.validate?.(input) : undefined })
    if (isCancel(value)) throw new PromptCancelled()
    return value.trim() ? value : undefined
}

export async function promptManagedItems(terminal: CommandInterface, items: readonly ManagedItem[]): Promise<Record<string, boolean>> {
    return interactionStep(terminal, async region => {
        const all = await confirmPrompt(region.current, "持续托管全部支持的配置项？")
        const choices: Record<string, boolean> = {}
        for (const item of items) choices[item.id] = all || await confirmPrompt(region.replace(), `持续托管${item.label}？`)
        return choices
    }, choices => ({ question: '持续托管配置项', answer: items.filter(item => choices[item.id]).map(item => item.label).join('、') || '无' }))
}

export async function confirmPrompt(terminal: CommandInterface, message: string, initialValue = true): Promise<boolean> {
    const value = await confirm({ ...terminal.prompt, message, initialValue })
    if (isCancel(value)) throw new PromptCancelled()
    return value
}

export async function confirmInitialization(terminal: CommandInterface, plan: InitializationPlan, verb: string): Promise<boolean> {
    const state = plan.state
    const { reporter } = terminal
    reporter.info(`工程根：${state.rootDir}\n项目：${state.project.project.name}@${state.project.project.version}\n产品显示名称：${effectiveDisplayName(state)}\nmacOS Bundle ID：${effectiveBundleId(state)}\nFramework：${state.project.framework.version}\nNative target：${state.project.native.target}\n产品：${state.project.project.products.join(", ")}\n托管项：${state.project["managed-items"].join(", ") || "无"}`)
    for (const copy of plan.copies) reporter.info(`复制：${copy.source} → ${copy.destination}（跳过 .git、node_modules、本机配置与 .arrange）`)
    for (const icon of plan.icons) reporter.info(icon.kind === "existing" ? `引用已有图标：${icon.destination}` : `复制图标：${icon.source} → ${icon.destination}`)
    for (const file of plan.files) reporter.info(`${file.before.content === null ? "新建" : "更新"}：${file.before.path}`)
    return confirmPrompt(terminal, `确认${verb}？`)
}

export function validateRelativeDirectory(value: string): string | undefined {
    if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) return "请使用工程根内的相对目录"
    if (value === "." || value.split(/[\\/]/).some(part => part === ".." || part === "")) return "不能使用根目录、空路径段或 '..'"
    if (/[<>:"|?*]/.test(value)) return "目录含有无效字符"
    return undefined
}
