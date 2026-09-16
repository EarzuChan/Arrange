import {cmakeListsFile, fetchContentRepositoryRegion, frameworkVersionRegion, pluginVersionRegion, pluginIdentityRegion, pluginFormatsRegion, productNameRegion} from "../cmake/CmakeTextStuffs.ts"
import {npmrcFile, packageJsonFile, registryRegion, packageNameRegion, frameworkDependencyRegion} from "../node-js/NodeFiles.ts"
import {managedItemIds, type ManagedItem} from "./ManagedItem.ts"
import type {ManagedFile} from "./ManagedFile.ts"

export const managedItems: readonly ManagedItem[] = [
    {id: managedItemIds.projectName, label: "项目名称（CMake 产品名和 UI 包名）", regions: [productNameRegion, packageNameRegion]},
    {id: managedItemIds.frameworkVersion, label: "Framework 版本（CMake GIT_TAG 和 npm 依赖）", regions: [frameworkVersionRegion, frameworkDependencyRegion]},
    {id: managedItemIds.fetchContentRepository, label: "CMake FetchContent 仓库地址", regions: [fetchContentRepositoryRegion]},
    {id: managedItemIds.pluginVersion, label: "插件版本", regions: [pluginVersionRegion]},
    {id: managedItemIds.pluginIdentity, label: "插件厂商与标识", regions: [pluginIdentityRegion]},
    {id: managedItemIds.pluginFormats, label: "插件格式", regions: [pluginFormatsRegion]},
    {id: managedItemIds.registry, label: "Framework registry", regions: [registryRegion]},
]

export const managedFiles: readonly ManagedFile[] = [packageJsonFile, npmrcFile, cmakeListsFile]
