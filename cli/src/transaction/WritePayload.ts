import { z } from "zod"

export const writeFileSchema = z.object({ path: z.string(), original: z.string().nullable(), expected: z.string(), written: z.boolean() })
export const writePayloadSchema = z.object({ files: z.array(writeFileSchema) })
export type WritePayload = z.infer<typeof writePayloadSchema>
