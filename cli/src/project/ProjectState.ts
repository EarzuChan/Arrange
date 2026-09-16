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
    version: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "需要具体版本号"),
    nodeRegistryUrl: z.string().refine(value => !/[\r\n]/.test(value), "registry 不得包含换行").nullish(),
    cmakeFetchContentUrl: z.string().min(1).refine(value => !/[\r\n]/.test(value), "FetchContent URL 不得包含换行").nullish(),
})
export type FrameworkDefinition = z.infer<typeof frameworkDefinitionSchema>

export const uiProjectDefinitionSchema = z.object({
    directory: z.string().min(1),
    packageManager: packageManagerNameSchema,
})
export type UiProjectDefinition = z.infer<typeof uiProjectDefinitionSchema>

export const nativeProjectDefinitionSchema = z.object({
    directory: z.string().min(1),
    pluginType: z.enum(["effect", "instrument"]).default("effect"),
})
export type NativeProjectDefinition = z.infer<typeof nativeProjectDefinitionSchema>

export const artifactDefinitionSchema = z.object({
    directory: z.string().min(1),
    includeVersionDirectory: z.boolean(),
})
export type ArtifactDefinition = z.infer<typeof artifactDefinitionSchema>

export const projectMetadataSchema = z.object({
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "名称须以字母开头，仅含字母、数字、下划线"),
    version: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "需要具体版本号"),
    vendorName: z.string().min(1).refine(value => !/[\r\n]/.test(value), "厂商名称不得包含换行"),
    vendorCode: z.string().regex(/^[A-Za-z0-9]{4}$/),
    pluginCode: z.string().regex(/^[A-Za-z0-9]{4}$/),
    products: z.array(nativeProductSchema).min(1),
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
