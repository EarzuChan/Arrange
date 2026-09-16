import type {TextRegion} from "./TextRegion.ts"
import type {JsonRegion} from "./JsonRegion.ts"

export type Region = TextRegion | JsonRegion

export interface ManagedItem {
    readonly id: string
    readonly label: string
    readonly regions: readonly Region[]
}

export const managedItemIds = {
    projectName: "project.name",
    frameworkVersion: "framework.version",
    fetchContentRepository: "cmake.fetch-content-repository",
    pluginVersion: "cmake.plugin-version",
    pluginIdentity: "cmake.plugin-identity",
    pluginFormats: "cmake.plugin-formats",
    registry: "node.npmrc.arrange-registry",
} as const
