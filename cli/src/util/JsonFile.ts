import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"

export async function readJsonFile(path: string): Promise<unknown | null> {
    try { return JSON.parse(await readFile(path, "utf8")) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
        throw new Error(`无法读取 JSON：${path}`, { cause: error })
    }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`

    try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" })
        await rename(temporary, path)
    } finally {
        await rm(temporary, { force: true }).catch(() => { })
    }
}
