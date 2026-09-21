import type { TextRegion } from "./TextRegion.ts"
import type { JsonRegion } from "./JsonRegion.ts"
import { fetchContentRepositoryRegion, frameworkVersionRegion, pluginVersionRegion, pluginIdentityRegion, pluginFormatsRegion, productNameRegion } from "../cmake/CmakeStuffs.ts"
import { registryRegion, packageNameRegion, frameworkDependencyRegion } from "../node-js/NodeJsStuffs.ts"

export type Region = TextRegion | JsonRegion

export interface ManagedItem {
    readonly id: string
    readonly label: string
    readonly regions: readonly Region[]
}

export const projectName = { id: "project.name", label: "项目名称（CMake 产品名和 UI 包名）", regions: [productNameRegion, packageNameRegion] } as const satisfies ManagedItem
export const frameworkVersion = { id: "framework.version", label: "Framework 版本（CMake GIT_TAG 和 npm 依赖）", regions: [frameworkVersionRegion, frameworkDependencyRegion] } as const satisfies ManagedItem
export const fetchContentRepository = { id: "cmake.fetch-content-repository", label: "CMake FetchContent 仓库地址", regions: [fetchContentRepositoryRegion] } as const satisfies ManagedItem
export const pluginVersion = { id: "cmake.plugin-version", label: "插件版本", regions: [pluginVersionRegion] } as const satisfies ManagedItem
export const pluginIdentity = { id: "cmake.plugin-identity", label: "插件厂商与标识", regions: [pluginIdentityRegion] } as const satisfies ManagedItem
export const pluginFormats = { id: "cmake.plugin-formats", label: "插件格式", regions: [pluginFormatsRegion] } as const satisfies ManagedItem
export const registry = { id: "node.npmrc.arrange-registry", label: "Framework registry", regions: [registryRegion] } as const satisfies ManagedItem

export const managedItems = [projectName, frameworkVersion, fetchContentRepository, pluginVersion, pluginIdentity, pluginFormats, registry] as const