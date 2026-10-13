import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { mkdir } from "node:fs/promises"
import { userDirectoryEnvironment, userDirectoryName } from "../CliMetadata.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"

// 用户级根与工程级 .arrange 各自独立；路径解析不创建目录，资源协调由操作层按需建立
export class UserDirectories {
    readonly root: string

    constructor(root = process.env[userDirectoryEnvironment] ?? join(homedir(), userDirectoryName)) {
        if (!isAbsolute(root)) throw new Error(`${userDirectoryEnvironment} 必须是绝对路径：${root}`)
        this.root = resolve(root)
    }

    get builds(): string { return join(this.root, "builds") }
    get dependencySources(): string { return join(this.root, "deps-src") }
    get temporary(): string { return join(this.root, "tmp") }
    get runtime(): string { return join(this.root, "runtime") }
    get operations(): string { return join(this.root, "operations") }
    get projects(): string { return join(this.root, "projects") }
    get transactions(): string { return join(this.root, "transactions") }

    async ensure(directory: string): Promise<void> {
        await mkdir(this.root, { recursive: true })
        await assertPlainDirectoryPath(this.root, directory)
        await mkdir(directory, { recursive: true })
    }
}
