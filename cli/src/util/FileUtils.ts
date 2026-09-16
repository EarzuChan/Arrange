import {readFile} from "node:fs/promises"

export interface FileSnapshot {readonly path: string, readonly content: string | null}

export async function readSnapshot(path: string): Promise<FileSnapshot> {
    try { return {path, content: await readFile(path, "utf8")} } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {path, content: null}
        throw error
    }
}

export async function assertSnapshots(snapshots: readonly FileSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
        if ((await readSnapshot(snapshot.path)).content !== snapshot.content) throw new Error(`文件在扫描后发生变化，请重新运行 sync：${snapshot.path}`)
    }
}
