import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import { z } from 'zod'
import { uiManifestName, uiPackageFormat } from '../../CliMetadata.ts'

const maxEntryBytes = 64 * 1024 * 1024
const maxZipBytes = 2 ** 31
const compressed = /\.(?:png|jpe?g|gif|webp|zip|gz|mp3|ogg|flac|mp4|woff2)$/iu
const schema = z.object({
    format: z.literal(uiPackageFormat),
    framework: z.string(),
    protocol: z.number().int().positive(),
    entry: z.string(),
    scriptFormat: z.enum(['js', 'bytecode']),
    engine: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
    entries: z.array(z.object({
        path: z.string(),
        file: z.string().optional(),
        kind: z.enum(['module', 'asset']),
        size: z.number().int().min(0).max(maxEntryBytes),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    })).min(1).max(8192),
})

export function bytecodeFile(path: string): string { return `${path}.qbc` }

export class PackagePaths {
    private readonly names = new Map([[uiManifestName, uiManifestName]])
    private readonly directories = new Map<string, string>()

    add(path: string): string[] {
        const parts = path.split('/')
        if (Buffer.byteLength(path) > 1024 || /[\x00-\x1f\x7f\\:*?"<>|]/u.test(path) || parts.some(part => !part || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))) throw new Error(`UI 包条目路径无效：${path}`)
        const key = path.normalize('NFC').toLowerCase()
        if (this.names.has(key) || this.directories.has(key)) throw new Error(`UI 包条目重名：${path}`)
        this.names.set(key, path)
        for (let i = 1; i < parts.length; i++) {
            const dir = parts.slice(0, i).join('/')
            const folded = dir.normalize('NFC').toLowerCase()
            if (this.names.has(folded) || this.directories.has(folded) && this.directories.get(folded) !== dir) throw new Error(`UI 包目录重名：${dir}`)
            this.directories.set(folded, dir)
        }
        return parts
    }
}

export async function verifyUiPackage(root: string, framework: string, signal?: AbortSignal) {
    const file = join(root, uiManifestName)
    if (!(await lstat(root).catch(() => undefined))?.isDirectory()) throw new Error(`UI dist 不是普通目录，缺少 ${uiManifestName}：${root}`)
    const info = await lstat(file).catch(() => undefined)
    if (!info?.isFile() || info.size > 4 * 1024 * 1024) throw new Error(`UI dist 缺少有效的 ${uiManifestName}：${root}；请重新构建 UI`)
    const contents = await readFile(file)
    let json: unknown
    try { json = JSON.parse(contents.toString('utf8')) } catch (cause) { throw new Error(`UI dist 清单 JSON 无效：${file}`, { cause }) }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new Error(`UI dist 清单格式无效：${file}`)
    const manifest = parsed.data
    if (manifest.framework !== framework) throw new Error(`UI dist 的 Framework ${manifest.framework} 不匹配工程 ${framework}；请重新构建 UI`)
    if ((manifest.scriptFormat === 'bytecode') !== (manifest.engine !== undefined)) throw new Error('UI 包字节码引擎声明无效')
    const logicalPaths = new PackagePaths()
    const physicalPaths = new PackagePaths()
    for (const entry of manifest.entries) {
        signal?.throwIfAborted()
        const file = entry.kind === 'module' && manifest.scriptFormat === 'bytecode' ? bytecodeFile(entry.path) : undefined
        if (entry.file !== file) throw new Error(`UI 包条目载荷名无效：${entry.path}`)
        logicalPaths.add(entry.path)
        const physical = physicalPaths.add(file ?? entry.path)
        let path = root
        for (const part of physical.slice(0, -1)) {
            path = join(path, part)
            if (!(await lstat(path).catch(() => undefined))?.isDirectory()) throw new Error(`UI 包缺少普通目录：${path}`)
        }
        path = join(path, physical.at(-1)!)
        const info = await lstat(path).catch(() => undefined)
        if (!info?.isFile() || info.size !== entry.size) throw new Error(`UI 包缺少普通文件或大小不符：${entry.path}`)
        const hash = createHash('sha256')
        let size = 0
        for await (const block of createReadStream(path, { signal })) {
            size += block.length
            if (size > entry.size) throw new Error(`UI 包文件长度发生变化：${entry.path}`)
            hash.update(block)
        }
        if (size !== entry.size || hash.digest('hex') !== entry.sha256) throw new Error(`UI 包条目摘要不符：${entry.path}`)
    }
    const entry = manifest.entries.find(item => item.path === manifest.entry && item.kind === 'module')
    if (!entry) throw new Error(`UI 包入口不是已登记模块：${manifest.entry}`)
    return { contents, manifest, entries: manifest.entries, entry, digest: createHash('sha256').update(contents).digest('hex') }
}

export async function stageUiPackage(source: string, staged: string, framework: string, format: 'directory' | 'zip', expected: string, signal?: AbortSignal) {
    // 两种载体都从同一个已核验的暂存快照生成，避免源输出变动产生混合包。
    const input = await verifyUiPackage(source, framework, signal)
    if (input.digest !== expected) throw new Error('打包期间 UI 清单发生变化')
    const directory = format === 'directory' ? staged : await mkdtemp(join(dirname(staged), '.arrange-ui-'))
    try {
        if (format === 'directory') await mkdir(directory)
        await writeFile(join(directory, uiManifestName), input.contents, { flag: 'wx' })
        for (const entry of input.entries) {
            signal?.throwIfAborted()
            const file = entry.file ?? entry.path
            const target = join(directory, file)
            await mkdir(dirname(target), { recursive: true })
            await copyFile(join(source, file), target)
        }
        await verifyUiPackage(directory, framework, signal)
        if (format === 'zip') {
            const total = input.entries.reduce((sum, entry) => sum + entry.size + Buffer.byteLength(entry.file ?? entry.path) * 2 + 256, input.contents.length + 1024)
            if (total >= maxZipBytes) throw new Error('UI ZIP 超过 2 GiB 预算，请使用目录包')
            const zip = new ZipFile()
            zip.on('error', error => zip.outputStream.emit('error', error))
            const written = pipeline(zip.outputStream, createWriteStream(staged, { flags: 'wx' }), { signal })
            const mtime = new Date(2000, 0, 1)
            zip.addBuffer(input.contents, uiManifestName, { mtime, compress: false })
            for (const entry of input.entries) {
                const file = entry.file ?? entry.path
                zip.addFile(join(directory, file), file, { mtime, compress: !compressed.test(file) })
            }
            zip.end()
            await written
            if ((await lstat(staged)).size >= maxZipBytes) throw new Error('UI ZIP 超过 2 GiB 预算，请使用目录包')
        }
    } finally {
        if (format === 'zip') await rm(directory, { recursive: true, force: true })
    }
}
