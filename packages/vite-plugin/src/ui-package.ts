import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { ARRANGE_PACKAGE_VERSION, ARRANGE_RUNTIME_VERSION } from '@arrange/framework/internal'

const manifestName = 'arrange-ui.json'
const maxEntryBytes = 64 * 1024 * 1024
type Kind = 'module' | 'asset'

function portableName(path: string): boolean {
    return Buffer.byteLength(path) <= 1024 && !/[\x00-\x1f\x7f\\:*?"<>|]/u.test(path) && path.split('/').every(part => part.length > 0 && !/[. ]$/u.test(part) && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))
}

async function publicFiles(directory: string, prefix = ''): Promise<string[]> {
    const children = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' && !prefix) return []
        throw error
    })
    const paths: string[] = []
    for (const child of children) {
        const path = prefix + child.name
        if (child.isDirectory()) paths.push(...await publicFiles(join(directory, child.name), path + '/'))
        else if (child.isFile()) paths.push(path)
        else throw new Error(`UI public 只允许普通文件：${path}`)
    }
    return paths
}

async function describe(directory: string, path: string, kind: Kind) {
    const file = join(directory, path)
    const info = await lstat(file)
    if (!info.isFile() || info.size > maxEntryBytes) throw new Error(`UI 包条目不是普通文件或超过大小限制：${path}`)
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of createReadStream(file)) {
        size += chunk.length
        if (size > maxEntryBytes) throw new Error(`UI 包条目超过大小限制：${path}`)
        hash.update(chunk)
    }
    if (size !== info.size) throw new Error(`生成清单期间 UI 包条目发生变化：${path}`)
    return { path, kind, size, sha256: hash.digest('hex') }
}

export function uiPackageHooks(): Pick<Plugin, 'configResolved' | 'writeBundle'> {
    let config: ResolvedConfig
    return {
        configResolved(value) { config = value },
        writeBundle: {
            order: 'post',
            sequential: true,
            async handler(output, bundle) {
                if (!output.dir || output.format !== 'es') throw new Error('Arrange UI 构建必须输出 ESM 目录')
                const items = Object.values(bundle)
                const entry = items.filter(item => item.type === 'chunk' && item.isEntry)
                if (entry.length !== 1) throw new Error('Arrange UI 包必须有且仅有一个 ESM 入口')
                const names = new Map<string, Kind>()
                const folded = new Map<string, string>([[manifestName, manifestName]])
                const directories = new Map<string, string>()
                const add = (path: string, kind: Kind) => {
                    if (!portableName(path)) throw new Error(`UI 包条目名称不适用于发布平台：${path}`)
                    const key = path.normalize('NFC').toLowerCase()
                    if (folded.has(key) || directories.has(key)) throw new Error(`UI 包条目重名：${path}`)
                    for (let slash = path.indexOf('/'); slash >= 0; slash = path.indexOf('/', slash + 1)) {
                        const parent = path.slice(0, slash)
                        const key = parent.normalize('NFC').toLowerCase()
                        if (folded.has(key) || directories.has(key) && directories.get(key) !== parent) throw new Error(`UI 包目录重名：${path}`)
                        directories.set(key, parent)
                    }
                    folded.set(key, path)
                    names.set(path, kind)
                }
                for (const item of items) add(item.fileName, item.type === 'chunk' ? 'module' : 'asset')
                if (config.publicDir && config.build.copyPublicDir) {
                    for (const path of await publicFiles(config.publicDir)) add(path, 'asset')
                }
                if (names.size > 8192) throw new Error('UI 包条目数量超过限制')
                const entries = []
                for (const path of [...names.keys()].sort()) entries.push(await describe(output.dir, path, names.get(path)!))
                const contents = JSON.stringify({ format: 1, framework: ARRANGE_PACKAGE_VERSION, protocol: ARRANGE_RUNTIME_VERSION, entry: entry[0].fileName, entries }) + '\n'
                if (Buffer.byteLength(contents) > 4 * 1024 * 1024) throw new Error('UI 包清单超过大小限制')
                const target = join(output.dir, manifestName)
                const staged = `${target}.${process.pid}.tmp`
                await writeFile(staged, contents, { flag: 'wx' })
                await rename(staged, target)
            },
        },
    }
}
