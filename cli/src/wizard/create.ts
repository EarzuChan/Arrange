import {confirm, group, intro, isCancel, log, multiselect, outro, select} from "@clack/prompts"
import {resolve} from "node:path"
import {cmakeManagedItemKeys} from "../cmake/CmakeManagedItems.ts"
import {packageJsonManagedItemKeys} from "../node/PackageJsonManagedItems.ts"
import type {CreateProjectRequest} from "../project/ProjectCreateModel.ts"
import type {NativeProduct, PackageManagerName, PluginType} from "../project/ProjectState.ts"
import {PromptCancelled, requiredText, validateFourCharCode, validateSemver} from "../utils/PromptUtils.ts"

export interface CreateWizardInput {
    readonly registryUrl?: string
}

export type CreateWizardResult = false | CreateProjectRequest

const projectNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/

export async function runCreateWizard(input: CreateWizardInput = {}): Promise<CreateWizardResult> {
    try {
        intro("Create Arrange project")

        const answers = await group({
            projectName: () => requiredText("Project name", {
                placeholder: "MyPlugin",
                validate: (value) => projectNamePattern.test(value) ? undefined : "Use letters, numbers, and underscore; start with a letter.",
            }),
            projectVersion: () => requiredText("Project version", {
                initialValue: "0.1.0", // TODO：正式版需变为Placeholder
                validate: validateSemver,
            }),
            // FIXME：从服务器拉取，甘霖娘
            frameworkVersion: () => requiredText("Arrange framework version", {
                initialValue: "0.0.0-m.2.2",
                validate: validateSemver,
            }),
            companyName: () => requiredText("Company name", {placeholder: "Your name or company"}),
            companyCode: () => requiredText("Company code", {
                placeholder: "Arng",
                validate: validateFourCharCode,
            }),
            pluginCode: () => requiredText("Plugin code", {
                placeholder: "Demo",
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
                message: "UI package manager",
                options: [
                    {label: "pnpm", value: "pnpm"},
                    {label: "npm", value: "npm"},
                ],
            }),
            products: () => multiselect({
                message: "Native products", // TODO：未来支持更多类型
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

        log.info(`Arrange project summary:\n\nroot: ${rootDir}\nproject: ${answers.projectName}@${answers.projectVersion}\nframework: ${answers.frameworkVersion}\ncompany: ${answers.companyName} (${answers.companyCode})\nplugin: ${answers.pluginCode}, ${pluginType}\nproducts: ${products.join(", ")}\nui: ${directories.uiDirectory}, ${packageManager}\nnative: ${directories.nativeDirectory}\nartifacts: ${directories.artifactsDirectory}`)

        const confirmed = await confirm({message: "Create this Arrange project?", initialValue: true})
        if (isCancel(confirmed) || !confirmed) throw new PromptCancelled()

        outro("Started to create project...")
        return {
            rootDir,
            projectName: answers.projectName,
            projectVersion: answers.projectVersion,
            frameworkVersion: answers.frameworkVersion,
            frameworkRegistryUrl: input.registryUrl,
            companyName: answers.companyName,
            companyCode: answers.companyCode,
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
    if (manageAll) return createManagedItems(true, true)

    const cmakeItems = await promptCmakeManagedItems()
    const nodeItems = await promptNodeManagedItems()
    return {...cmakeItems, ...nodeItems}
}

async function promptCmakeManagedItems(): Promise<Record<string, boolean>> {
    const manageAllCmake = await confirm({
        message: "Let Arrange manage all native CMake items?",
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
        message: "Let Arrange manage all UI package.json items?",
        initialValue: true,
    })
    if (isCancel(manageAllNode)) throw new PromptCancelled()
    if (manageAllNode) {
        return createNodeManagedItems(true, true, true)
    }

    const dependencies = await confirm({
        message: "Manage package.json dependencies?",
        initialValue: true,
    })
    if (isCancel(dependencies)) throw new PromptCancelled()
    const devDependencies = await confirm({
        message: "Manage package.json devDependencies?",
        initialValue: true,
    })
    if (isCancel(devDependencies)) throw new PromptCancelled()
    const scripts = await confirm({
        message: "Manage package.json scripts?",
        initialValue: true,
    })
    if (isCancel(scripts)) throw new PromptCancelled()

    return createNodeManagedItems(dependencies, devDependencies, scripts)
}

function createManagedItems(manageCmake: boolean, managePackageJson: boolean): Record<string, boolean> {
    return {
        ...createCmakeManagedItems(manageCmake, manageCmake, manageCmake),
        ...createNodeManagedItems(managePackageJson, managePackageJson, managePackageJson),
    }
}

function createCmakeManagedItems(fetchContent: boolean, pluginTarget: boolean, linkFramework: boolean): Record<string, boolean> {
    return {
        [cmakeManagedItemKeys.fetchContent]: fetchContent,
        [cmakeManagedItemKeys.pluginTarget]: pluginTarget,
        [cmakeManagedItemKeys.linkFramework]: linkFramework,
    }
}

function createNodeManagedItems(dependencies: boolean, devDependencies: boolean, scripts: boolean): Record<string, boolean> {
    return {
        [packageJsonManagedItemKeys.dependencies]: dependencies,
        [packageJsonManagedItemKeys.devDependencies]: devDependencies,
        [packageJsonManagedItemKeys.scripts]: scripts,
    }
}
