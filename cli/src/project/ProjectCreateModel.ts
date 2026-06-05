import type { NativeProduct, PackageManagerName, PluginType, ProjectState } from "./ProjectState.ts"

export interface CreateProjectRequest {
    readonly rootDir: string
    readonly projectName: string
    readonly projectVersion: string
    readonly frameworkVersion: string
    readonly frameworkRegistryUrl?: string
    readonly companyName: string
    readonly companyCode: string
    readonly pluginCode: string
    readonly pluginType: PluginType
    readonly packageManager: PackageManagerName
    readonly products: NativeProduct[]
    readonly uiDirectory: string
    readonly nativeDirectory: string
    readonly artifactsDirectory: string
    readonly managedItems: Record<string, boolean>
}

// Wizard返回的Request包装为State，Vamos！
export function createInitialProjectState(request: CreateProjectRequest): ProjectState {
    return {
        project: {
            name: request.projectName,
            version: request.projectVersion,
            companyName: request.companyName,
            companyCode: request.companyCode,
            pluginCode: request.pluginCode,
            pluginType: request.pluginType,
            framework: {
                version: request.frameworkVersion,
                registryUrl: request.frameworkRegistryUrl,
            },
            ui: {
                directory: request.uiDirectory,
                packageManager: request.packageManager,
            },
            native: {
                directory: request.nativeDirectory,
                products: request.products,
            },
            artifacts: {
                directory: request.artifactsDirectory,
                includeVersionDirectory: true,
            },
            managed: {
                items: Object.fromEntries(
                    Object.entries(request.managedItems).map(([key, managed]) => [key, { managed }]),
                ),
            },
        },
        local: null, // TIPS：初次创建时尚未有Local配置，这个是被Sync阶段生成
    }
}
