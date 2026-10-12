import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { mkdir } from "node:fs/promises"
import { userDirectoryEnvironment, userDirectoryName } from "../CliMetadata.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"

// 用户级根与工程级 .arrange 各自独立；解析路径不创建目录，SCAN 保持只读
export class UserDirectories {
    readonly root: string

    constructor(root = process.env[userDirectoryEnvironment] ?? join(homedir(), userDirectoryName)) {
        if (!isAbsolute(root)) throw new Error(`${userDirectoryEnvironment} 必须是绝对路径：${root}`)
        this.root = resolve(root)
    }

    get builds(): string { return join(this.root, "builds") }
    get sources(): string { return join(this.root, "sources") }
    get temporary(): string { return join(this.root, "tmp") }
    get runtime(): string { return join(this.root, "runtime") }

    async ensure(directory: string): Promise<void> {
        await mkdir(this.root, { recursive: true })
        await assertPlainDirectoryPath(this.root, directory)
        await mkdir(directory, { recursive: true })
    }
}
