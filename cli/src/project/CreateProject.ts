import type {NativeProduct, PackageManagerName, ProjectState} from "./ProjectState.ts"

export type PluginType = "effect" | "instrument"

export interface CreateProjectRequest {
    readonly rootDir: string
    readonly projectName: string
    readonly projectVersion: string
    readonly frameworkVersion: string
    readonly frameworkNodeRegistryUrl?: string
    readonly frameworkCmakeFetchContentUrl?: string
    readonly vendorName: string
    readonly vendorCode: string
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
        rootDir: request.rootDir,
        project: {
            project: {
                name: request.projectName,
                version: request.projectVersion,
                vendorName: request.vendorName,
                vendorCode: request.vendorCode,
                pluginCode: request.pluginCode,
                products: request.products,
            },
            framework: {
                version: request.frameworkVersion,
                ...(request.frameworkNodeRegistryUrl ? {nodeRegistryUrl: request.frameworkNodeRegistryUrl} : {}),
                ...(request.frameworkCmakeFetchContentUrl ? {cmakeFetchContentUrl: request.frameworkCmakeFetchContentUrl} : {}),
            },
            ui: {
                directory: request.uiDirectory,
                packageManager: request.packageManager,
            },
            native: {
                directory: request.nativeDirectory,
            },
            artifacts: {
                directory: request.artifactsDirectory,
                includeVersionDirectory: true,
            },
            "managed-items": Object.entries(request.managedItems)
                .filter(([, managed]) => managed)
                .map(([key]) => key),
        },
        local: null, // TIPS：初次创建时尚未有Local配置，这个是被Sync阶段生成
    }
}
