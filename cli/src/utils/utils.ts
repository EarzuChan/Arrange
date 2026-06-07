import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import {createHash} from "node:crypto"

// FILE
export async function writeTextFile(filePath: string, content: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, "utf8")
}

// TIME
export function formatTimestampToDate(value: string): string {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return value

    return new Date(timestamp).toISOString().slice(0, 10)
}

// CONTENT
export function hashText(text: string): string {
    return createHash("sha256").update(text).digest("hex")
}

// JSON
export function isJsonObject(json: unknown): json is Record<string, unknown> {
    return typeof json === "object" && json !== null && !Array.isArray(json)
}