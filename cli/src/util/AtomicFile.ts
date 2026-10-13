import { randomUUID } from "node:crypto"
import { open, realpath, rename, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

// 调用方负责目录所有权与互斥；同目录发布保证读者只看到完整旧文件或完整新文件
export async function writeAtomicText(path: string, content: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    // 工程根可由目录别名访问；用已核验父目录的真实路径执行排他创建，避免 Windows reparse 路径误报 EEXIST
    path = join(await realpath(dirname(path)), basename(path))
    const temporary = `${path}.${randomUUID()}.tmp`
    const file = await open(temporary, "wx")
    try {
        try { await file.writeFile(content, "utf8") } finally { await file.close() }
        signal?.throwIfAborted()
        await rename(temporary, path)
    } finally { await rm(temporary, { force: true }) }
}
