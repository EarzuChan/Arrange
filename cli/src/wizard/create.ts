import {confirm, group, intro, isCancel, log, multiselect, outro, select} from "@clack/prompts"
import {resolve} from "node:path"
import {cmakeManagedItemKeys} from "../cmake/CmakeManagedItems.ts"
import {nodeManagedItemKeys} from "../node/NodeManagedItems.ts"
import type {CreateProjectRequest, PluginType} from "../project/CreateProject.ts"
import type {NativeProduct, PackageManagerName} from "../project/ProjectState.ts"
import {PromptCancelled, requiredText, validateFourCharCode, validateSemver} from "../utils/promptUtils.ts"
import {selectFrameworkVersion} from "./frameworkVersion.ts"

export interface CreateWizardInput {
    readonly nodeRegistryUrl?: string
    readonly cmakeFetchContentUrl?: string
}

const projectNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/

// THINK：以后能不能让每一项的Ctrl+C变为“上一步”
export async function runCreateWizard(input: CreateWizardInput = {}): Promise<false | CreateProjectRequest> {
    try {
        intro("Create Arrange project")

        const answers = await group({
            projectName: () => requiredText("Project name", {
                placeholder: "e.g YourPlugin",
                validate: (value) => projectNamePattern.test(value) ? undefined : "Use letters, numbers, and underscore; start with a letter.",
            }),
            projectVersion: () => requiredText("Project version", {
                placeholder: "e.g 1.0.0",
                validate: validateSemver,
            }),
            frameworkVersion: () => selectFrameworkVersion({registryUrl: input.nodeRegistryUrl}),
            vendorName: () => requiredText("Vendor name", {
                placeholder: "Your name or company"
            }),
            vendorCode: () => requiredText("Vendor code", {
                placeholder: "e.g AbCd",
                validate: validateFourCharCode,
            }),
            pluginCode: () => requiredText("Plugin code", {
                placeholder: "e.g EfGh",
                validate: validateFourCharCode,
            }),
            pluginType: () => select({
                message: "Plugin type",
                options: [
                    {label: "Effect", value: "effect"},
                    {label: "Instrument", value: "instrument"},
                ],
            }),
            packageManager: () => select({
                message: "Package manager of the UI subproject",
                options: [
                    {label: "pnpm", value: "pnpm"},
                    {label: "npm", value: "npm"},
                ],
            }),
            products: () => multiselect({
                message: "Products", // TODO：未来支持更多类型
                required: true,
                options: [
                    {label: "Standalone", value: "standalone", hint: "recommended"},
                    {label: "VST3", value: "vst3", hint: "recommended"},
                ],
                initialValues: ["standalone", "vst3"],
            }),
            location: ({results}) => select({
                message: "Where should the project be created?",
                options: [
                    {label: `Create in ./${results.projectName}`, value: "subdir", hint: "recommended"},
                    {label: "Create in the current directory", value: "current"},
                ],
            }),
        }, {
            onCancel: () => {
                throw new PromptCancelled()
            },
        })

        const managedItems = await promptManagedItems()
        const directories = await promptProjectDirectories()

        const rootDir = answers.location === "subdir" ? resolve(process.cwd(), answers.projectName) : process.cwd()
        const pluginType = answers.pluginType as PluginType
        const packageManager = answers.packageManager as PackageManagerName
        const products = answers.products as NativeProduct[]

        log.info(`Arrange project summary:\n\nroot: ${rootDir}\nproject: ${answers.projectName}@${answers.projectVersion}\nframework: ${answers.frameworkVersion}\ncompany: ${answers.vendorName} (${answers.vendorCode})\nplugin: ${answers.pluginCode}, ${pluginType}\nproducts: ${products.join(", ")}\nui: ${directories.uiDirectory}, ${packageManager}\nnative: ${directories.nativeDirectory}\nartifacts: ${directories.artifactsDirectory}`)

        const confirmed = await confirm({message: "Create this Arrange project?", initialValue: true})
        if (isCancel(confirmed) || !confirmed) throw new PromptCancelled()

        outro("Started to create project...")
        return {
            rootDir,
            projectName: answers.projectName,
            projectVersion: answers.projectVersion,
            frameworkVersion: answers.frameworkVersion,
            frameworkNodeRegistryUrl: input.nodeRegistryUrl,
            frameworkCmakeFetchContentUrl: input.cmakeFetchContentUrl,
            vendorName: answers.vendorName,
            vendorCode: answers.vendorCode,
            pluginCode: answers.pluginCode,
            pluginType,
            packageManager,
            products,
            uiDirectory: directories.uiDirectory,
            nativeDirectory: directories.nativeDirectory,
            artifactsDirectory: directories.artifactsDirectory,
            managedItems,
        }
    } catch (error) {
        if (error instanceof PromptCancelled) {
            log.error("Create cancelled.")
            return false
        }

        outro("Encountered error while creating project.")
        throw error
    }
}

interface ProjectDirectories {
    readonly uiDirectory: string
    readonly nativeDirectory: string
    readonly artifactsDirectory: string
}

async function promptProjectDirectories(): Promise<ProjectDirectories> {
    const useDefaultDirectories = await confirm({
        message: "Use default subdirectory names? (\\ui, \\native, \\artifacts)",
        initialValue: true,
    })
    if (isCancel(useDefaultDirectories)) throw new PromptCancelled()
    if (useDefaultDirectories) return defaultProjectDirectories()

    const useDefaultUiDirectory = await confirm({
        message: "Use default UI subdirectory name? (ui)",
        initialValue: true,
    })
    if (isCancel(useDefaultUiDirectory)) throw new PromptCancelled()
    const uiDirectory = useDefaultUiDirectory ? "ui" : await requiredText("UI subdirectory", {
        initialValue: "ui",
        validate: validateRelativeDirectory,
    })

    const useDefaultNativeDirectory = await confirm({
        message: "Use default native subdirectory name? (native)",
        initialValue: true,
    })
    if (isCancel(useDefaultNativeDirectory)) throw new PromptCancelled()
    const nativeDirectory = useDefaultNativeDirectory ? "native" : await requiredText("Native subdirectory", {
        initialValue: "native",
        validate: validateRelativeDirectory,
    })

    const useDefaultArtifactsDirectory = await confirm({
        message: "Use default artifacts subdirectory name? (artifacts)",
        initialValue: true,
    })
    if (isCancel(useDefaultArtifactsDirectory)) throw new PromptCancelled()
    const artifactsDirectory = useDefaultArtifactsDirectory ? "artifacts" : await requiredText("Artifacts subdirectory", {
        initialValue: "artifacts",
        validate: validateRelativeDirectory,
    })

    return {uiDirectory, nativeDirectory, artifactsDirectory}
}

function defaultProjectDirectories(): ProjectDirectories {
    return {
        uiDirectory: "ui",
        nativeDirectory: "native",
        artifactsDirectory: "artifacts",
    }
}

function validateRelativeDirectory(value: string): string | undefined {
    if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return "Use a relative directory name."
    if (value === "." || value === ".." || value.includes("..")) return "Directory must not contain '..'."
    if (/[<>:"|?*]/.test(value)) return "Directory contains invalid characters."
    return undefined
}

async function promptManagedItems(): Promise<Record<string, boolean>> {
    const manageAll = await confirm({
        message: "Let Arrange continuously manage all supported project configuration items?",
        initialValue: true,
    })
    if (isCancel(manageAll)) throw new PromptCancelled()

    if (manageAll) return {...createCmakeManagedItems(true, true, true), ...createNodeManagedItems(true, true)}

    const cmakeItems = await promptCmakeManagedItems()
    const nodeItems = await promptNodeManagedItems()
    return {...cmakeItems, ...nodeItems}
}

async function promptCmakeManagedItems(): Promise<Record<string, boolean>> {
    const manageAllCmake = await confirm({
        message: "Let Arrange manage all native config items?",
        initialValue: true,
    })
    if (isCancel(manageAllCmake)) throw new PromptCancelled()
    if (manageAllCmake) return createCmakeManagedItems(true, true, true)

    const fetchContent = await confirm({
        message: "Manage CMake FetchContent block?",
        initialValue: true,
    })
    if (isCancel(fetchContent)) throw new PromptCancelled()
    const pluginTarget = await confirm({
        message: "Manage CMake JUCE plugin target block?",
        initialValue: true,
    })
    if (isCancel(pluginTarget)) throw new PromptCancelled()
    const linkFramework = await confirm({
        message: "Manage CMake Arrange framework link block?",
        initialValue: true,
    })
    if (isCancel(linkFramework)) throw new PromptCancelled()

    return createCmakeManagedItems(fetchContent, pluginTarget, linkFramework)
}

async function promptNodeManagedItems(): Promise<Record<string, boolean>> {
    const manageAllNode = await confirm({
        message: "Let Arrange manage all UI config items?",
        initialValue: true,
    })
    if (isCancel(manageAllNode)) throw new PromptCancelled()
    if (manageAllNode) return createNodeManagedItems(true, true)

    const packageJsonFrameworkDependency = await confirm({
        message: "Manage package.json @arrange/framework dependency version?",
        initialValue: true,
    })
    if (isCancel(packageJsonFrameworkDependency)) throw new PromptCancelled()

    const npmrcArrangeRegistry = await confirm({
        message: "Manage .npmrc @arrange:registry entry?",
        initialValue: true,
    })
    if (isCancel(npmrcArrangeRegistry)) throw new PromptCancelled()

    return createNodeManagedItems(packageJsonFrameworkDependency, npmrcArrangeRegistry)
}

function createCmakeManagedItems(fetchContent: boolean, pluginTarget: boolean, linkFramework: boolean): Record<string, boolean> {
    return {
        [cmakeManagedItemKeys.fetchContent]: fetchContent,
        [cmakeManagedItemKeys.pluginTarget]: pluginTarget,
        [cmakeManagedItemKeys.linkFramework]: linkFramework,
    }
}

function createNodeManagedItems(packageJsonFrameworkDependency: boolean, npmrcArrangeRegistry: boolean): Record<string, boolean> {
    return {
        [nodeManagedItemKeys.packageJsonFrameworkDependency]: packageJsonFrameworkDependency,
        [nodeManagedItemKeys.npmrcArrangeRegistry]: npmrcArrangeRegistry,
    }
}
