import { createHash } from "node:crypto"
import { lstat, mkdir, readdir } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { z } from "zod"
import { assertPlainDirectoryPath } from "../../util/PlainDirectoryPath.ts"
import { writeAtomicText } from "../../util/AtomicFile.ts"
import { canonicalResource } from "../operation/Resource.ts"
import { nativeVerificationFileName, nativeVerificationSchema } from "../../CliMetadata.ts"
import { UserDirectories } from "../user/UserDirectories.ts"
import { TransactionStore } from "../transaction/TransactionStore.ts"
import { DeleteTransaction } from "../transaction/DeleteTransaction.ts"
import { nativeVerificationRecordSchema as schema } from "./NativeVerificationRecord.ts"
import { readCurrentRecord } from "../../util/RecordInspection.ts"


// 验收目录只在可信归属下整体重建，连同第三方独立子构建缓存一起处理
export class NativeBuildTree {
    constructor(private readonly signal = new AbortController().signal, private readonly user = new UserDirectories()) { }

    async prepare(source: string, directory: string, configuration: readonly unknown[], clean = false): Promise<() => Promise<void>> {
        this.signal.throwIfAborted()
        source = await this.canonical(source)
        directory = resolve(directory)
        // macOS 的外部父目录允许系统或用户别名；只解析父目录，保留受管树自身的链接检查
        if (process.platform === "darwin" && directory !== dirname(directory)) directory = resolve((await canonicalResource({ kind: "directory", path: dirname(directory), mode: "write" })).path, basename(directory))
        const normalized = (await canonicalResource({ kind: "directory", path: directory, mode: "write" })).path
        const ancestorPart = relative(normalized, source)
        if (!ancestorPart || (!isAbsolute(ancestorPart) && ancestorPart !== ".." && !ancestorPart.startsWith(`..${sep}`))) throw new Error("验收构建目录不能覆盖源码根或其祖先")
        if (directory === dirname(directory)) throw new Error("验收构建目录不能为文件系统根")
        await this.assertAncestors(directory)
        await this.user.ensure(this.user.root)
        const transactions = new TransactionStore(this.user.root, this.user.transactions)
        const deletion = new DeleteTransaction(transactions, this.signal)
        for (const entry of await transactions.list()) if (entry.record?.kind === "delete") {
            const paths = deletion.paths(entry.record)
            if (paths.some(entry => resolve(entry.path) === directory) && paths.every(entry => resolve(entry.root) === dirname(directory) && (resolve(entry.path) === directory || dirname(resolve(entry.path)) === dirname(directory) && /^\.arrange-delete-[a-f0-9-]{36}$/.test(entry.path.split(/[\\/]/).at(-1)!)))) await deletion.apply(entry.record)
        }
        const identity = createHash("sha256").update(JSON.stringify(configuration)).digest("hex")
        const recordPath = resolve(directory, nativeVerificationFileName)
        let previous: z.infer<typeof schema> | undefined
        try { previous = await readCurrentRecord(recordPath, schema, { field: "version", supported: nativeVerificationSchema }) } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`验收构建归属记录损坏：${recordPath}`, { cause: error })
        }
        if (previous && previous.source !== source) throw new Error(`验收构建目录属于其它源码：${directory}`)
        if (!previous) {
            const entries = await readdir(directory).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
                throw error
            })
            if (entries.length) throw new Error(`已有验收目录缺少归属记录，拒绝自动删除：${directory}；请选择空目录或人工处理`)
        }
        this.signal.throwIfAborted()
        if (previous && (clean || previous.identity !== identity)) await deletion.apply(await deletion.prepare([{ root: dirname(directory), path: directory }]))
        await mkdir(directory, { recursive: true })
        await assertPlainDirectoryPath(dirname(directory), directory)
        const record = { version: nativeVerificationSchema, source, identity, complete: false }
        await writeAtomicText(recordPath, `${JSON.stringify(record)}\n`, this.signal)
        return () => writeAtomicText(recordPath, `${JSON.stringify({ ...record, complete: true })}\n`, this.signal)
    }

    private async canonical(path: string): Promise<string> {
        const { realpath } = await import("node:fs/promises")
        const result = await realpath(path)
        return process.platform === "win32" ? result.toLowerCase() : result
    }

    private async assertAncestors(path: string): Promise<void> {
        for (let current = path; current !== dirname(current); current = dirname(current)) {
            const info = await lstat(current).catch(error => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
                throw error
            })
            if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`验收构建路径不能包含链接或文件：${current}`)
        }
        if (!isAbsolute(path)) throw new Error("验收构建路径必须为绝对路径")
    }
}
