import { isCancel, select } from "../../terminal/Prompts.ts"
import { resolve } from "node:path"
import { defaultProjectDirectories } from "../../CliMetadata.ts"
import type { FrameworkService } from "../../feature/framework/FrameworkService.ts"
import type { ConfigRegistry } from "../../feature/config/ConfigRegistry.ts"
import type { CreateProjectRequest } from "../../feature/project/CreateProject.ts"
import { PromptCancelled, requiredText } from "../PromptUtils.ts"
import type { CommandInterface } from "../CommandInterface.ts"
import { interactionStep } from '../InteractionStep.ts'
import { confirmPrompt, promptManagedItems, promptProjectDetails, validateRelativeDirectory, type ProjectWizardInput } from "./Project.ts"

export type CreateWizardInput = ProjectWizardInput

export async function runCreateWizard(terminal: CommandInterface, framework: FrameworkService, config: ConfigRegistry, input: CreateWizardInput = {}): Promise<false | CreateProjectRequest> {
    const io = terminal.prompt

    try {
        terminal.reporter.intro("创建 Arrange 工程")
        const details = await promptProjectDetails(terminal, framework, input)
        const location = await select({ ...io, message: "创建位置", options: [{ label: `./${details.projectName}`, value: "subdir" }, { label: "当前目录", value: "current" }] })
        if (isCancel(location)) throw new PromptCancelled()

        const rootDir = location === "subdir" ? resolve(process.cwd(), details.projectName) : process.cwd()
        const directories = await interactionStep(terminal, async region => {
            if (await confirmPrompt(region.current, "使用默认 ui、native、artifacts 目录？")) return { uiDirectory: defaultProjectDirectories.ui, nativeDirectory: defaultProjectDirectories.native, artifactsDirectory: defaultProjectDirectories.artifacts }
            const uiDirectory = await requiredText(region.replace().prompt, "UI 目录", { initialValue: defaultProjectDirectories.ui, validate: validateRelativeDirectory })
            const nativeDirectory = await requiredText(region.replace().prompt, "原生源码目录", { initialValue: defaultProjectDirectories.native, validate: validateRelativeDirectory })
            const artifactsDirectory = await requiredText(region.replace().prompt, "交付产物目录", { initialValue: defaultProjectDirectories.artifacts, validate: validateRelativeDirectory })
            return { uiDirectory, nativeDirectory, artifactsDirectory }
        }, directories => ({ question: '工程目录', answer: `UI：${directories.uiDirectory}；Native：${directories.nativeDirectory}；Artifacts：${directories.artifactsDirectory}` }))

        const { framework: selectedFramework, ...project } = details
        return { ...project, frameworkVersion: selectedFramework.version, rootDir, ...directories, managedItems: await promptManagedItems(terminal, config.items) }
    } catch (error) {
        if (error instanceof PromptCancelled) return false
        throw error
    }
}
