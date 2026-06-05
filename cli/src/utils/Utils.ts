import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export async function writeTextFile(filePath: string, content: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, "utf8")
}

export function formatTimestampToDate(value: string): string {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) return value

    return new Date(timestamp).toISOString().slice(0, 10)
}