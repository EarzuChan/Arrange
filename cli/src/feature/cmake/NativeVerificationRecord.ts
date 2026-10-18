import { z } from "zod"
import { nativeVerificationSchema } from "../../CliMetadata.ts"

export const nativeVerificationRecordSchema = z.object({ version: z.literal(nativeVerificationSchema), source: z.string(), identity: z.string(), complete: z.boolean() })
