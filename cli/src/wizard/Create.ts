import { intro, isCancel, log, select } from "@clack/prompts"
import { resolve } from "node:path"
import { defaultProjectDirectories } from "../CliMetadata.ts"
import type { FrameworkRegistryClient } from "../framework/FrameworkRegistryClient.ts"
import type { ConfigRegistry } from "../config/ConfigRegistry.ts"
import type { CreateProjectRequest } from "../project/CreateProject.ts"
import { PromptCancelled, requiredText } from "../util/PromptUtils.ts"
import { confirmPrompt, promptManagedItems, promptProjectDetails, validateRelativeDirectory, type ProjectWizardInput } from "./Project.ts"

export type CreateWizardInput = ProjectWizardInput

export async function runCreateWizard(registry: FrameworkRegistryClient, config: ConfigRegistry, input: CreateWizardInput = {}): Promise<false | CreateProjectRequest> {
    try {
        intro("创建 Arrange 工程")
        const details = await promptProjectDetails(registry, input)
        const location = await select({ message: "创建位置", options: [{ label: `./${details.projectName}`, value: "subdir" }, { label: "当前目录", value: "current" }] })
        if (isCancel(location)) throw new PromptCancelled()
        const rootDir = location === "subdir" ? resolve(process.cwd(), details.projectName) : process.cwd()
        let directories: { uiDirectory: string, nativeDirectory: string, artifactsDirectory: string } = { uiDirectory: defaultProjectDirectories.ui, nativeDirectory: defaultProjectDirectories.native, artifactsDirectory: defaultProjectDirectories.artifacts }
        if (!await confirmPrompt("使用默认 ui、native、artifacts 目录？")) directories = {
            uiDirectory: await requiredText("UI 目录", { initialValue: defaultProjectDirectories.ui, validate: validateRelativeDirectory }),
            nativeDirectory: await requiredText("Native 目录", { initialValue: defaultProjectDirectories.native, validate: validateRelativeDirectory }),
            artifactsDirectory: await requiredText("Artifacts 目录", { initialValue: defaultProjectDirectories.artifacts, validate: validateRelativeDirectory }),
        }
        return { ...details, rootDir, ...directories, managedItems: await promptManagedItems(config.items) }
    } catch (error) {
        if (error instanceof PromptCancelled) {
            log.info("已取消创建；未写工程文件")
            return false
        }
        throw error
    }
}
