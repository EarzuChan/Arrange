import { confirm, group, isCancel, log, multiselect, select, text } from "@clack/prompts"
import { resolve } from "node:path"
import type { ManagedItem } from "../managed/ManageItems.ts"
import type { FrameworkRegistryClient } from "../framework/FrameworkRegistryClient.ts"
import { assertFrameworkCompatible } from "../framework/FrameworkMamba.ts"
import type { CreateProjectRequest } from "../project/CreateProject.ts"
import type { InitializationPlan } from "../project/ProjectInitializer.ts"
import type { NativeProduct } from "../project/ProjectState.ts"
import { PromptCancelled, requiredText, validateFourCharCode, validateSemver } from "../util/PromptUtils.ts"
import { errorMessage } from "../util/Utils.ts"
import { selectFrameworkVersion } from "./FrameworkVersion.ts"
import type { ProjectInteractionInput } from "../project/ProjectInteraction.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"
import { effectiveBundleId, effectiveDisplayName, generateDefaultBundleId, validateBundleId, validateDisplayName } from "../project/ProjectMetadata.ts"

export type ProjectWizardInput = ProjectInteractionInput

export type ProjectDetails = Omit<CreateProjectRequest, "rootDir" | "uiDirectory" | "nativeDirectory" | "artifactsDirectory" | "managedItems">

export interface UiSuggestions {
    readonly name?: string
    readonly version?: string
    readonly frameworkVersion?: string
    readonly packageManager?: "npm" | "pnpm"
}

export async function promptProjectDetails(registry: FrameworkRegistryClient, input: ProjectWizardInput, suggestions: UiSuggestions = {}): Promise<ProjectDetails> {
    const answers = await group({
        projectName: () => requiredText("项目名称", { initialValue: suggestions.name && /^[A-Za-z][A-Za-z0-9_]*$/.test(suggestions.name) ? suggestions.name : undefined, validate: value => /^[A-Za-z][A-Za-z0-9_]*$/.test(value) ? undefined : "须以字母开头，仅使用字母、数字、下划线" }),
        projectVersion: () => requiredText("项目版本", { initialValue: suggestions.version && !validateSemver(suggestions.version) ? suggestions.version : "1.0.0", validate: validateSemver }),
        frameworkVersion: () => promptFrameworkVersion(registry, input, suggestions.frameworkVersion),
        vendorName: () => requiredText("厂商名称"),
        vendorCode: () => requiredText("厂商四字符代码", { placeholder: "AbCd", validate: validateFourCharCode }),
        pluginCode: () => requiredText("插件四字符代码", { placeholder: "EfGh", validate: validateFourCharCode }),
        pluginType: () => select({ message: "插件类型", options: [{ label: "Effect", value: "effect" as const }, { label: "Instrument", value: "instrument" as const }] }),
        packageManager: () => select({ message: "UI 包管理器", initialValue: suggestions.packageManager ?? "pnpm", options: [{ label: "pnpm", value: "pnpm" as const }, { label: "npm", value: "npm" as const }] }),
        products: () => multiselect<NativeProduct>({ message: "产品", required: true, options: [{ label: "Standalone", value: "standalone" }, { label: "VST3", value: "vst3" }], initialValues: ["standalone", "vst3"] }),
    }, { onCancel: () => { throw new PromptCancelled() } })
    const displayName = await optionalText("产品显示名称（留空使用项目名称）", { placeholder: answers.projectName, validate: validateDisplayName })
    const bundleId = await optionalText("macOS Bundle ID（留空生成并保存）", { placeholder: generateDefaultBundleId(answers), validate: validateBundleId })
    const iconSource = await optionalText("PNG 图标源文件（留空使用系统默认或保留已有图标）", { placeholder: "正方形 PNG，边长至少 256 像素" })
    return { ...answers, displayName: displayName ?? answers.projectName, bundleId, iconSource: iconSource ? resolve(iconSource.trim()) : undefined, frameworkNodeRegistryUrl: input.nodeRegistryUrl, frameworkCmakeFetchContentUrl: input.cmakeFetchContentUrl }
}

async function optionalText(message: string, options: { readonly placeholder?: string, readonly validate?: (value: string) => string | undefined }): Promise<string | undefined> {
    const value = await text({ message, placeholder: options.placeholder, validate: input => input?.trim() ? options.validate?.(input) : undefined })
    if (isCancel(value)) throw new PromptCancelled()
    return value.trim() ? value : undefined
}

async function promptFrameworkVersion(registry: FrameworkRegistryClient, input: ProjectWizardInput, suggestion?: string): Promise<string> {
    if (suggestion && !validateSemver(suggestion) && await confirmPrompt(`使用 package.json 中的 Framework ${suggestion}？`)) {
        try {
            const candidate = await registry.fetchCandidateByVersion(suggestion, input.nodeRegistryUrl)
            assertFrameworkCompatible(candidate)
            if (candidate.version !== suggestion) throw new Error("registry 返回的版本与候选不符")
            return suggestion
        } catch (error) {
            if (isAbortError(error)) throw error
            log.warn(`已有 Framework 版本未通过验证：${errorMessage(error)}；请重新选择`)
        }
    }
    return selectFrameworkVersion(registry, { registryUrl: input.nodeRegistryUrl })
}

export async function promptManagedItems(items: readonly ManagedItem[]): Promise<Record<string, boolean>> {
    if (await confirmPrompt("持续托管全部支持的配置项？")) return Object.fromEntries(items.map(item => [item.id, true]))
    const choices: Record<string, boolean> = {}
    for (const item of items) choices[item.id] = await confirmPrompt(`持续托管${item.label}？`)
    return choices
}

export async function confirmPrompt(message: string, initialValue = true): Promise<boolean> {
    const value = await confirm({ message, initialValue })
    if (isCancel(value)) throw new PromptCancelled()
    return value
}

export async function confirmInitialization(plan: InitializationPlan, verb: string): Promise<boolean> {
    const state = plan.state
    log.info(`工程根：${state.rootDir}\n项目：${state.project.project.name}@${state.project.project.version}\n产品显示名称：${effectiveDisplayName(state)}\nmacOS Bundle ID：${effectiveBundleId(state)}\nFramework：${state.project.framework.version}\nNative target：${state.project.native.target}\n产品：${state.project.project.products.join(", ")}\n托管项：${state.project["managed-items"].join(", ") || "无"}`)
    for (const copy of plan.copies) log.info(`复制：${copy.source} → ${copy.destination}（跳过 .git、node_modules、本机配置与 .arrange）`)
    for (const icon of plan.icons) log.info(icon.kind === "existing" ? `引用已有图标：${icon.destination}` : `复制图标：${icon.source} → ${icon.destination}`)
    for (const file of plan.files) log.info(`${file.before.content === null ? "新建" : "更新"}：${file.before.path}`)
    return confirmPrompt(`确认${verb}？`)
}

export function validateRelativeDirectory(value: string): string | undefined {
    if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) return "请使用工程根内的相对目录"
    if (value === "." || value.split(/[\\/]/).some(part => part === ".." || part === "")) return "不能使用根目录、空路径段或 '..'"
    if (/[<>:"|?*]/.test(value)) return "目录含有无效字符"
    return undefined
}
