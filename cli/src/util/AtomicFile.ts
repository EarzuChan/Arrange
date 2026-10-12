import { randomUUID } from "node:crypto"
import { open, rename, rm } from "node:fs/promises"

// 调用方负责目录所有权与互斥；同目录发布保证读者只看到完整旧文件或完整新文件
export async function writeAtomicText(path: string, content: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const temporary = `${path}.${randomUUID()}.tmp`
    const file = await open(temporary, "wx")
    try {
        try { await file.writeFile(content, "utf8") } finally { await file.close() }
        signal?.throwIfAborted()
        await rename(temporary, path)
    } finally { await rm(temporary, { force: true }) }
}
