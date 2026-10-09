import { randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { setImmediate } from "node:timers/promises"
import { z } from "zod"
import { containedDirectory } from "../project/ProjectPaths.ts"
import type { ProjectState } from "../project/ProjectState.ts"
import { assertPlainDirectoryPath } from "../util/PlainDirectoryPath.ts"
import { encodeIcns, encodeIco, icnsSlots, icoSizes } from "./IconContainer.ts"
import { resizeIcon } from "./IconResize.ts"
import { iconFingerprint, loadProjectIconSource, projectIconSourcePath, readDecodedPngIconSource, type IconPixels, type IconSourceSummary } from "./PngIcon.ts"

const derivedFileNames = { ico: "icon.ico", icns: "icon.icns", manifest: "icon.json" } as const
const iconAssetsFormatVersion = 2
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z.object({
    formatVersion: z.literal(iconAssetsFormatVersion),
    sourceFingerprint: fingerprintSchema,
    sourceSize: z.number().int().positive(),
    icoFingerprint: fingerprintSchema,
    icnsFingerprint: fingerprintSchema,
})

export interface PreparedIconAssets {
    readonly ico: string
    readonly icns: string
    readonly fingerprint: string
    readonly size: number
}

export interface IconAssetsInspection {
    readonly source: IconSourceSummary | null
    readonly assets: PreparedIconAssets | null
    readonly ready: boolean
    readonly reason?: string
}

function summarize(source: IconSourceSummary): IconSourceSummary { return { path: source.path, size: source.size, fingerprint: source.fingerprint } }

export class IconAssetsService {
    constructor(private readonly signal?: AbortSignal) { }

    private async paths(state: ProjectState, outputDirectory: string): Promise<{ directory: string, ico: string, icns: string, manifest: string }> {
        const directory = containedDirectory(state.rootDir, outputDirectory, "图标派生目录")
        await assertPlainDirectoryPath(state.rootDir, directory)
        const paths = { directory, ico: join(directory, derivedFileNames.ico), icns: join(directory, derivedFileNames.icns), manifest: join(directory, derivedFileNames.manifest) }
        for (const path of [paths.ico, paths.icns, paths.manifest]) {
            const info = await lstat(path).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
                return null
            })
            if (info && !info.isFile()) throw new Error(`图标派生路径必须是普通文件，不能包含符号链接或目录：${path}`)
        }
        return paths
    }

    async inspect(state: ProjectState, outputDirectory: string): Promise<IconAssetsInspection> {
        this.signal?.throwIfAborted()
        const source = await loadProjectIconSource(state)
        const paths = await this.paths(state, outputDirectory)
        const files = await Promise.all([paths.ico, paths.icns, paths.manifest].map(async path => {
            try { return await readFile(path) } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
                return null
            }
        }))
        this.signal?.throwIfAborted()
        if (!source) return files.every(file => file === null) ? { source: null, ready: true, assets: null } : { source: null, ready: false, assets: null, reason: "图标已取消配置，旧派生资源尚未清除" }
        const base = { source: summarize(source), ready: false, assets: null }
        if (files.some(file => file === null)) return { ...base, reason: "图标派生资源缺失，请运行 native SETUP" }
        let manifest: z.infer<typeof manifestSchema>
        try { manifest = manifestSchema.parse(JSON.parse(files[2]!.toString("utf8"))) } catch { return { ...base, reason: "图标派生记录损坏，请运行 native SETUP" } }
        if (manifest.sourceFingerprint !== source.fingerprint || manifest.sourceSize !== source.size) return { ...base, reason: "图标源内容已变化，请运行 native SETUP" }
        if (manifest.icoFingerprint !== iconFingerprint(files[0]!) || manifest.icnsFingerprint !== iconFingerprint(files[1]!)) return { ...base, reason: "图标派生资源已变化，请运行 native SETUP" }
        return { source: summarize(source), ready: true, assets: { ico: paths.ico, icns: paths.icns, fingerprint: source.fingerprint, size: source.size } }
    }

    async prepare(state: ProjectState, outputDirectory: string): Promise<PreparedIconAssets | null> {
        this.signal?.throwIfAborted()
        const paths = await this.paths(state, outputDirectory)
        const sourcePath = await projectIconSourcePath(state)
        if (!sourcePath) {
            for (const path of [paths.ico, paths.icns, paths.manifest]) {
                this.signal?.throwIfAborted()
                await rm(path, { force: true })
            }
            return null
        }
        const sourceRelative = relative(paths.directory, resolve(sourcePath))
        if (!sourceRelative || sourceRelative !== ".." && !sourceRelative.startsWith(`..${sep}`) && !isAbsolute(sourceRelative)) throw new Error("图标派生目录不能包含图标源")
        const previous = await this.inspect(state, outputDirectory)
        if (previous.ready) return previous.assets
        const { source, pixels } = await readDecodedPngIconSource(sourcePath)
        const sizes = [...new Set([...icoSizes, ...icnsSlots.map(slot => slot.size)])].filter(size => size <= pixels.size)
        const images = new Map<number, IconPixels>()
        for (const size of sizes) {
            await setImmediate()
            images.set(size, resizeIcon(pixels, size, this.signal))
        }
        const ico = encodeIco(images)
        const icns = encodeIcns(images)
        const manifest = JSON.stringify({ formatVersion: iconAssetsFormatVersion, sourceFingerprint: source.fingerprint, sourceSize: source.size, icoFingerprint: iconFingerprint(ico), icnsFingerprint: iconFingerprint(icns) }, null, 2) + "\n"
        this.signal?.throwIfAborted()
        await mkdir(paths.directory, { recursive: true })
        const staged = [
            { path: paths.ico, content: ico },
            { path: paths.icns, content: icns },
            { path: paths.manifest, content: Buffer.from(manifest) },
        ].map(file => ({ ...file, temporary: `${file.path}.${randomUUID()}.tmp` }))
        try {
            for (const file of staged) {
                this.signal?.throwIfAborted()
                await writeFile(file.temporary, file.content, { flag: "wx" })
            }
            if (iconFingerprint(await readFile(sourcePath)) !== source.fingerprint) throw new Error("图标源在生成过程中发生变化，请重新运行 native SETUP")
            await this.paths(state, outputDirectory)
            for (const file of staged) {
                this.signal?.throwIfAborted()
                await rename(file.temporary, file.path)
            }
        } finally {
            for (const file of staged) await rm(file.temporary, { force: true }).catch(() => { })
        }
        return { ico: paths.ico, icns: paths.icns, fingerprint: source.fingerprint, size: source.size }
    }
}
