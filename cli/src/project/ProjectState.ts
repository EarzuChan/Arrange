export type ArrangeSide = "ui" | "native"
export type BuildFlavor = "debug" | "release"
export type NativeProduct = "standalone" | "vst3"
export type PackageManagerName = "pnpm" | "npm" | "yarn"

export interface ProjectState {
    readonly project: ProjectDefinition
    readonly local: LocalDefinition | null
}

export interface ProjectDefinition {
    readonly name: string
    readonly version: string
    readonly vendorName: string
    readonly vendorCode: string
    readonly pluginCode: string
    readonly pluginType: PluginType
    readonly framework: FrameworkDefinition
    readonly ui: UiProjectDefinition
    readonly native: NativeProjectDefinition
    readonly artifacts: ArtifactDefinition
    readonly managed: ManagedProjectDefinition
}

export type PluginType = "effect" | "instrument"

export interface FrameworkDefinition {
    readonly version: string
    readonly registryUrl?: string
}

export interface UiProjectDefinition {
    readonly directory: string
    readonly packageManager: PackageManagerName
}

export interface NativeProjectDefinition {
    readonly directory: string
    readonly products: NativeProduct[]
}

export interface ArtifactDefinition {
    readonly directory: string
    readonly includeVersionDirectory: boolean
}

export interface ManagedProjectDefinition {
    readonly items: Record<string, ManagedItemState>
}

export interface ManagedItemState {
    readonly managed: boolean
}

export interface LocalDefinition {
    readonly node?: ToolPathDefinition
    readonly packageManager?: ToolPathDefinition
    readonly cmake?: ToolPathDefinition
    readonly nativeCompiler?: ToolPathDefinition
}

export interface ToolPathDefinition {
    readonly path: string
    readonly version?: string
}
