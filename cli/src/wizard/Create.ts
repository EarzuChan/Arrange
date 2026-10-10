import { isCancel, select } from "@clack/prompts"
import { resolve } from "node:path"
import { defaultProjectDirectories } from "../CliMetadata.ts"
import type { FrameworkRegistryClient } from "../framework/FrameworkRegistryClient.ts"
import type { ConfigRegistry } from "../config/ConfigRegistry.ts"
import type { CreateProjectRequest } from "../project/CreateProject.ts"
import { PromptCancelled, requiredText } from "../util/PromptUtils.ts"
import type { CliTerminal } from "../ui/Terminal.ts"
import { confirmPrompt, promptManagedItems, promptProjectDetails, validateRelativeDirectory, type ProjectWizardInput } from "./Project.ts"

export type CreateWizardInput = ProjectWizardInput

export async function runCreateWizard(terminal: CliTerminal, registry: FrameworkRegistryClient, config: ConfigRegistry, input: CreateWizardInput = {}): Promise<false | CreateProjectRequest> {
    const io = terminal.prompt
    try {
        terminal.reporter.intro("创建 Arrange 工程")
        const details = await promptProjectDetails(terminal, registry, input)
        const location = await select({ ...io, message: "创建位置", options: [{ label: `./${details.projectName}`, value: "subdir" }, { label: "当前目录", value: "current" }] })
        if (isCancel(location)) throw new PromptCancelled()
        const rootDir = location === "subdir" ? resolve(process.cwd(), details.projectName) : process.cwd()
        let directories: { uiDirectory: string, nativeDirectory: string, artifactsDirectory: string } = { uiDirectory: defaultProjectDirectories.ui, nativeDirectory: defaultProjectDirectories.native, artifactsDirectory: defaultProjectDirectories.artifacts }
        if (!await confirmPrompt(terminal, "使用默认 ui、native、artifacts 目录？")) directories = {
            uiDirectory: await requiredText(io, "UI 目录", { initialValue: defaultProjectDirectories.ui, validate: validateRelativeDirectory }),
            nativeDirectory: await requiredText(io, "Native 目录", { initialValue: defaultProjectDirectories.native, validate: validateRelativeDirectory }),
            artifactsDirectory: await requiredText(io, "Artifacts 目录", { initialValue: defaultProjectDirectories.artifacts, validate: validateRelativeDirectory }),
        }
        return { ...details, rootDir, ...directories, managedItems: await promptManagedItems(terminal, config.items) }
    } catch (error) {
        if (error instanceof PromptCancelled) return false
        throw error
    }
}
