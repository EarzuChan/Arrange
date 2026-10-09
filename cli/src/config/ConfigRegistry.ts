import { cmakeListsFile } from "../cmake/CmakeStuffs.ts"
import type { ManagedFile } from "../managed/ManagedFile.ts"
import type { ManagedItem, ManagedItemMetadata, Region } from "../managed/ManageItems.ts"
import { npmrcFile, packageJsonFile } from "../node-js/NodeJsStuffs.ts"

export interface ConfigRegistry {
    readonly files: readonly ManagedFile[]
    readonly items: readonly ManagedItem[]
}

export function createConfigRegistry(files: readonly ManagedFile[], metadata: readonly ManagedItemMetadata[]): ConfigRegistry {
    const items = new Map<string, { id: string, label: string, regions: Region[] }>()
    for (const item of metadata) {
        if (items.has(item.id)) throw new Error(`ManagedItem 重复：${item.id}`)
        items.set(item.id, { ...item, regions: [] })
    }
    const physical = new Set<Region>()
    const registeredFiles = new Set<ManagedFile>()
    for (const file of files) {
        if (registeredFiles.has(file)) throw new Error(`File 重复：${file.id}`)
        registeredFiles.add(file)
        const regions = file.kind === "text-file" ? file.clusters.flatMap(cluster => cluster.regions) : file.regions
        for (const region of regions) {
            if (physical.has(region)) throw new Error(`Region 物理归属冲突：${region.id}`)
            physical.add(region)
            const item = items.get(region.managedItemId)
            if (!item) throw new Error(`Region 关联未知 ManagedItem：${region.id} → ${region.managedItemId}`)
            item.regions.push(region)
        }
    }
    for (const item of items.values()) if (!item.regions.length) throw new Error(`ManagedItem 缺少物理 Region：${item.id}`)
    return Object.freeze({ files: Object.freeze([...files]), items: Object.freeze([...items.values()].map(item => Object.freeze({ ...item, regions: Object.freeze(item.regions) }))) })
}

export const configRegistry = createConfigRegistry([packageJsonFile, npmrcFile, cmakeListsFile], [
    { id: "project.name", label: "项目机器名与产品显示名（UI 包名和 CMake 产品名）" },
    { id: "framework.version", label: "Framework 版本（CMake GIT_TAG 和 npm 依赖）" },
    { id: "cmake.fetch-content-repository", label: "CMake FetchContent 仓库地址" },
    { id: "cmake.plugin-version", label: "插件版本" },
    { id: "cmake.plugin-identity", label: "插件厂商与标识" },
    { id: "cmake.plugin-formats", label: "插件格式" },
    { id: "cmake.product-icon", label: "产品图标（CLI 生成的原生成品资源）" },
    { id: "node.npmrc.arrange-registry", label: "Framework registry" },
])
