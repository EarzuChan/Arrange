import { createHash } from "node:crypto"
import { z } from "zod"

const singleLine = z.string().min(1).refine(value => !/[\r\n\0]/.test(value), "源码标识不得包含换行或 NUL")
export const sourceSpecSchema = z.object({ repository: singleLine, ref: singleLine, commit: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i).optional() })
export type SourceSpec = z.infer<typeof sourceSpecSchema>

export function sourceIdentity(spec: SourceSpec): string {
    return sourceHash([sourceRepositoryIdentity(spec.repository), spec.ref, spec.commit ?? null])
}

export function sourceRepositoryIdentity(repository: string): string { return repository.replace(/(\/\/)[^/@\s]+@/g, "$1") }

export function sourceHash(parts: readonly unknown[]): string {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

export function redactSourceUrl(value: string): string {
    return value.replace(/(\/\/)[^/@\s]+@/g, "$1***@")
}
