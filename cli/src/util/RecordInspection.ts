import { lstat, readFile } from "node:fs/promises"
import type { z } from "zod"

export type InspectionState = "ready" | "missing" | "damaged" | "incompatible" | "unavailable" | "unknown" | "replaced" | "stale" | "incomplete"
export interface InspectionFact {
    readonly state: InspectionState
    readonly path: string
    readonly reason: string
}
export class InspectionError extends Error {
    constructor(readonly fact: InspectionFact) { super(`${fact.reason}：${fact.path}`) }
}
export function inspectionFailure(error: unknown, path: string): InspectionFact {
    if (error instanceof InspectionError) return error.fact
    const code = (error as NodeJS.ErrnoException).code
    const actualPath = (error as NodeJS.ErrnoException).path
    const reasons: Record<string, string> = { ENOENT: "目录或文件不存在", EACCES: "权限不足，无法访问", EPERM: "系统拒绝访问", EIO: "文件系统读取失败", ENOTDIR: "路径层级不是目录" }
    return { state: code === "ENOENT" ? "missing" : code ? "unavailable" : "damaged", path: typeof actualPath === "string" ? actualPath : path, reason: code && reasons[code] ? `${reasons[code]}（${code}）` : error instanceof Error ? error.message : String(error) }
}

// 只读取版本头判断兼容性，不解析或迁移其它版本的业务字段
export async function readCurrentRecord<T>(path: string, schema: z.ZodType<T>, version?: { readonly field: string, readonly supported: number }): Promise<T> {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new InspectionError({ state: "damaged", path, reason: "记录必须为普通文件，不能为链接" })
    const raw: unknown = JSON.parse(await readFile(path, "utf8"))
    if (version) {
        const actual = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[version.field] : undefined
        if (!Number.isInteger(actual)) throw new InspectionError({ state: "damaged", path, reason: `缺少有效的 ${version.field} 格式版本` })
        if (actual !== version.supported) throw new InspectionError({ state: "incompatible", path, reason: `记录格式 ${actual}，当前仅支持 ${version.supported}` })
    }
    const result = schema.safeParse(raw)
    if (!result.success) throw new InspectionError({ state: "damaged", path, reason: result.error.issues.map(issue => `${issue.path.join(".") || "记录"}：${issue.message}`).join("；") })
    return result.data
}
