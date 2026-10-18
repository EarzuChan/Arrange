import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { cmakeDefinitionsFileName, reservedCmakeDefinitions } from "../../CliMetadata.ts"
import { writeAtomicText } from "../../util/AtomicFile.ts"

export type CmakeDefinitionValues = Readonly<Record<string, string>>

const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/
const reserved = new Set<string>(reservedCmakeDefinitions)

export function mergeCmakeDefinitions(managed: CmakeDefinitionValues, custom: CmakeDefinitionValues = {}): CmakeDefinitionValues {
    for (const [key, value] of Object.entries(custom)) if (!validKey.test(key) || reserved.has(key) || /[\r\n\0]/.test(value)) throw new Error(`不支持的 CMake 自定义选项：${key}`)
    return { ...managed, ...custom }
}

// 只记录 CLI 可能写入过的键；值始终从当前工程配置和默认规则生成
export class CmakeDefinitions {
    private readonly path: string

    constructor(directory: string) { this.path = join(directory, cmakeDefinitionsFileName) }

    async readKeys(): Promise<readonly string[] | undefined> {
        let content: string
        try { content = await readFile(this.path, "utf8") } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
            throw error
        }
        let keys: unknown
        try { keys = JSON.parse(content) } catch { throw new Error(`CMake definitions 归属记录损坏：${this.path}`) }
        if (!Array.isArray(keys) || keys.some(key => typeof key !== "string" || !validKey.test(key)) || new Set(keys).size !== keys.length) throw new Error(`CMake definitions 归属记录损坏：${this.path}`)
        return keys as string[]
    }

    async begin(current: CmakeDefinitionValues, previous: readonly string[]): Promise<readonly string[]> {
        for (const [key, value] of Object.entries(current)) if (!validKey.test(key) || /[\r\n\0]/.test(value)) throw new Error(`不支持的 CMake definition：${key}`)
        const keys = Object.keys(current)
        // 先持久化并集再启动 CMake；失败或取消后，重试仍能清除所有可能残留的变量
        await this.writeKeys([...previous, ...keys])
        const present = new Set(keys)
        return [...previous.filter(key => !present.has(key)).map(key => `-U${key}`), ...Object.entries(current).map(([key, value]) => `-D${key}=${value}`)]
    }

    complete(current: CmakeDefinitionValues): Promise<void> { return this.writeKeys(Object.keys(current)) }

    private writeKeys(keys: readonly string[]): Promise<void> { return writeAtomicText(this.path, `${JSON.stringify([...new Set(keys)].sort())}\n`) }
}
