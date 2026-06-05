import {z} from "zod"

export const arrangeSubprojectSchema = z.enum(["ui", "native"])
export type ArrangeSubproject = z.infer<typeof arrangeSubprojectSchema>

export const buildFlavorSchema = z.enum(["debug", "release"])
export type BuildFlavor = z.infer<typeof buildFlavorSchema>

export const nativeProductSchema = z.enum(["standalone", "vst3"])
export type NativeProduct = z.infer<typeof nativeProductSchema>

export const packageManagerNameSchema = z.enum(["pnpm", "npm", "yarn"])
export type PackageManagerName = z.infer<typeof packageManagerNameSchema>

export const pluginTypeSchema = z.enum(["effect", "instrument"])
export type PluginType = z.infer<typeof pluginTypeSchema>

export const frameworkDefinitionSchema = z.object({
    version: z.string(),
    nodeRegistryUrl: z.string().optional(),
    cmakeFetchContentUrl: z.string().optional(),
})
export type FrameworkDefinition = z.infer<typeof frameworkDefinitionSchema>

export const uiProjectDefinitionSchema = z.object({
    directory: z.string(),
    packageManager: packageManagerNameSchema,
})
export type UiProjectDefinition = z.infer<typeof uiProjectDefinitionSchema>

export const nativeProjectDefinitionSchema = z.object({
    directory: z.string(),
    products: z.array(nativeProductSchema),
})
export type NativeProjectDefinition = z.infer<typeof nativeProjectDefinitionSchema>

export const artifactDefinitionSchema = z.object({
    directory: z.string(),
    includeVersionDirectory: z.boolean(),
})
export type ArtifactDefinition = z.infer<typeof artifactDefinitionSchema>

export const managedItemStateSchema = z.object({
    managed: z.boolean(),
})
export type ManagedItemState = z.infer<typeof managedItemStateSchema>

export const managedProjectDefinitionSchema = z.object({
    items: z.record(z.string(), managedItemStateSchema),
})
export type ManagedProjectDefinition = z.infer<typeof managedProjectDefinitionSchema>

export const projectDefinitionSchema = z.object({
    name: z.string(),
    version: z.string(),
    vendorName: z.string(),
    vendorCode: z.string(),
    pluginCode: z.string(),
    pluginType: pluginTypeSchema,
    framework: frameworkDefinitionSchema,
    ui: uiProjectDefinitionSchema,
    native: nativeProjectDefinitionSchema,
    artifacts: artifactDefinitionSchema,
    managed: managedProjectDefinitionSchema,
})
export type ProjectDefinition = z.infer<typeof projectDefinitionSchema>

export const toolPathDefinitionSchema = z.object({
    path: z.string(),
    version: z.string().optional(),
})
export type ToolPathDefinition = z.infer<typeof toolPathDefinitionSchema>

export const localDefinitionSchema = z.object({
    node: toolPathDefinitionSchema.optional(),
    packageManager: toolPathDefinitionSchema.optional(),
    cmake: toolPathDefinitionSchema.optional(),
    nativeCompiler: toolPathDefinitionSchema.optional(),
})
export type LocalDefinition = z.infer<typeof localDefinitionSchema>

export const projectStateSchema = z.object({
    project: projectDefinitionSchema,
    local: localDefinitionSchema.nullable(),
})
export type ProjectState = z.infer<typeof projectStateSchema>

export interface ProjectContext {
    readonly rootDir: string
    readonly state: ProjectState
}
