import type { NativeProduct, PackageManagerName, ProjectState } from "./ProjectState.ts"
import { defaultProjectIconPath } from "../CliMetadata.ts"
import { generateDefaultBundleId } from "./ProjectMetadata.ts"

export type PluginType = "effect" | "instrument"

export interface CreateProjectRequest {
    readonly rootDir: string
    readonly projectName: string
    readonly displayName?: string
    readonly bundleId?: string
    readonly iconSource?: string
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

// 将向导返回的请求包装为项目状态
export function createInitialProjectState(request: CreateProjectRequest): ProjectState {
    return {
        rootDir: request.rootDir,
        project: {
            project: {
                name: request.projectName,
                displayName: request.displayName ?? request.projectName,
                bundleId: request.bundleId ?? generateDefaultBundleId(request),
                ...(request.iconSource !== undefined ? { icon: defaultProjectIconPath } : {}),
                version: request.projectVersion,
                vendorName: request.vendorName,
                vendorCode: request.vendorCode,
                pluginCode: request.pluginCode,
                products: request.products,
            },
            framework: {
                version: request.frameworkVersion,
                ...(request.frameworkNodeRegistryUrl !== undefined ? { nodeRegistryUrl: request.frameworkNodeRegistryUrl } : {}),
                ...(request.frameworkCmakeFetchContentUrl !== undefined ? { cmakeFetchContentUrl: request.frameworkCmakeFetchContentUrl } : {}),
            },
            ui: {
                directory: request.uiDirectory,
                packageManager: request.packageManager,
            },
            native: {
                directory: request.nativeDirectory,
                target: request.projectName,
                pluginType: request.pluginType,
            },
            artifacts: {
                directory: request.artifactsDirectory,
                includeVersionDirectory: true,
            },
            "managed-items": Object.entries(request.managedItems).filter(([, managed]) => managed).map(([key]) => key),
        },
        local: null, // TIPS：初次创建时尚未有Local配置，这个是被Sync阶段生成
    }
}
