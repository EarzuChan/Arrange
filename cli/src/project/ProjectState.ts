import {z} from "zod"

export const arrangeSubprojectSchema = z.enum(["ui", "native"])
export type ArrangeSubproject = z.infer<typeof arrangeSubprojectSchema>

export const buildFlavorSchema = z.enum(["debug", "release"])
export type BuildFlavor = z.infer<typeof buildFlavorSchema>

export const nativeProductSchema = z.enum(["standalone", "vst3"])
export type NativeProduct = z.infer<typeof nativeProductSchema>

export const packageManagerNameSchema = z.enum(["pnpm", "npm", "yarn"])
export type PackageManagerName = z.infer<typeof packageManagerNameSchema>

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
})
export type NativeProjectDefinition = z.infer<typeof nativeProjectDefinitionSchema>

export const artifactDefinitionSchema = z.object({
    directory: z.string(),
    includeVersionDirectory: z.boolean(),
})
export type ArtifactDefinition = z.infer<typeof artifactDefinitionSchema>

export const projectMetadataSchema = z.object({
    name: z.string(),
    version: z.string(),
    vendorName: z.string(),
    vendorCode: z.string(),
    pluginCode: z.string(),
    products: z.array(nativeProductSchema),
})
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>

export const projectDefinitionSchema = z.object({
    project: projectMetadataSchema,
    framework: frameworkDefinitionSchema,
    ui: uiProjectDefinitionSchema,
    native: nativeProjectDefinitionSchema,
    artifacts: artifactDefinitionSchema,
    "managed-items": z.array(z.string()),
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
    rootDir: z.string(),
    project: projectDefinitionSchema,
    local: localDefinitionSchema.nullable(),
})
export type ProjectState = z.infer<typeof projectStateSchema>

// 一个小工具方法
export function isManagedItem(state: ProjectState, key: string): boolean {
    return state.project["managed-items"].includes(key)
}
