import { z } from "zod"

export const projectYamlSchema = z.object({
    name: z.string(),
    version: z.string(),
    companyName: z.string(),
    companyCode: z.string(),
    pluginCode: z.string(),
    pluginType: z.enum(["effect", "instrument"]),
    framework: z.object({
        version: z.string(),
        registryUrl: z.string().optional(),
    }),
    ui: z.object({
        directory: z.string(),
        packageManager: z.enum(["pnpm", "npm", "yarn"]),
    }),
    native: z.object({
        directory: z.string(),
        products: z.array(z.enum(["standalone", "vst3"])),
    }),
    artifacts: z.object({
        directory: z.string(),
        includeVersionDirectory: z.boolean(),
    }),
    managed: z.object({
        items: z.record(z.string(), z.object({ managed: z.boolean() })),
    }),
})

export const localYamlSchema = z.object({
    node: z.object({ path: z.string(), version: z.string().optional() }).optional(),
    packageManager: z.object({ path: z.string(), version: z.string().optional() }).optional(),
    cmake: z.object({ path: z.string(), version: z.string().optional() }).optional(),
    nativeCompiler: z.object({ path: z.string(), version: z.string().optional() }).optional(),
})

export type ProjectYamlDto = z.infer<typeof projectYamlSchema>
export type LocalYamlDto = z.infer<typeof localYamlSchema>
