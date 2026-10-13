import { z } from "zod"

// 准备凭据的结构只定义一次，内容是否过期由 CmakeService 对照工程判断
export const preparationRecordSchema = z.object({ signature: z.string(), inputHashes: z.record(z.string(), z.string()), sourceDirectories: z.record(z.string(), z.string()) })
