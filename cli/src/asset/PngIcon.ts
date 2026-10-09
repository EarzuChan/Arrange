import { createHash } from "node:crypto"
import { lstat, readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path"
import { PNG } from "pngjs"
import type { ProjectState } from "../project/ProjectState.ts"

export const minimumIconSize = 256
export const recommendedIconSize = 1024
const maximumIconPixels = 4096 * 4096
const maximumPngBytes = 64 * 1024 * 1024
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export interface IconPixels {
    readonly size: number
    readonly data: Buffer
}

export interface PngIconSource {
    readonly path: string
    readonly bytes: Buffer
    readonly size: number
    readonly fingerprint: string
}

export interface IconSourceSummary {
    readonly path: string
    readonly size: number
    readonly fingerprint: string
}

export function iconFingerprint(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex") }

function validatePngStructure(bytes: Buffer): void {
    if (bytes.length > maximumPngBytes) throw new Error("图标 PNG 文件不得超过 64 MiB")
    if (bytes.length < 33 || !bytes.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error("图标必须是 PNG 文件")
    if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("图标 PNG 的 IHDR 损坏")
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (width !== height || width < minimumIconSize) throw new Error(`图标必须是至少 ${minimumIconSize}×${minimumIconSize} 的正方形 PNG，推荐 ${recommendedIconSize}×${recommendedIconSize}`)
    if (width * height > maximumIconPixels) throw new Error("图标 PNG 像素总数不得超过 4096×4096")
    let offset = pngSignature.length
    while (offset < bytes.length) {
        if (bytes.length - offset < 12) throw new Error("图标 PNG 数据块不完整")
        const length = bytes.readUInt32BE(offset)
        const end = offset + length + 12
        if (end > bytes.length) throw new Error("图标 PNG 数据块不完整")
        const type = bytes.toString("ascii", offset + 4, offset + 8)
        if (type === "IHDR" && offset !== pngSignature.length) throw new Error("图标 PNG 不能包含重复 IHDR")
        if (["acTL", "fcTL", "fdAT"].includes(type)) throw new Error("图标必须是静态 PNG，不支持 APNG 动画")
        if (type === "IEND") {
            if (length !== 0 || end !== bytes.length) throw new Error("图标 PNG 的结束数据块损坏或含有尾随数据")
            return
        }
        offset = end
    }
    throw new Error("图标 PNG 缺少结束数据块")
}

export async function readDecodedPngIconSource(path: string): Promise<{ source: PngIconSource, pixels: IconPixels }> {
    const sourcePath = resolve(path)
    const info = await stat(sourcePath)
    if (!info.isFile()) throw new Error(`图标源不是普通文件：${sourcePath}`)
    if (info.size > maximumPngBytes) throw new Error("图标 PNG 文件不得超过 64 MiB")
    const bytes = await readFile(sourcePath)
    try {
        validatePngStructure(bytes)
        const decoded = PNG.sync.read(bytes, { checkCRC: true })
        return { source: { path: sourcePath, bytes, size: decoded.width, fingerprint: iconFingerprint(bytes) }, pixels: { size: decoded.width, data: decoded.data } }
    } catch (error) {
        throw new Error(`无法读取图标 PNG ${sourcePath}：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
}

export async function loadPngIconSource(path: string): Promise<PngIconSource> { return (await readDecodedPngIconSource(path)).source }

export async function projectIconSourcePath(state: ProjectState): Promise<string | null> {
    const icon = state.project.project.icon
    if (icon == null) return null
    if (!icon || isAbsolute(icon) || win32.isAbsolute(icon) || /^[A-Za-z]:/.test(icon)) throw new Error("project.icon 必须是工程根内的相对 PNG 路径")
    const root = resolve(state.rootDir)
    const source = resolve(root, icon)
    const part = relative(root, source)
    if (!part || part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error("project.icon 不能超出工程根")
    let current = await realpath(root)
    const segments = part.split(sep)
    for (const [index, segment] of segments.entries()) {
        current = join(current, segment)
        const info = await lstat(current)
        if (info.isSymbolicLink()) throw new Error(`图标路径不能包含符号链接：${current}`)
        if (index < segments.length - 1 && !info.isDirectory()) throw new Error(`图标路径不是目录：${current}`)
        if (index === segments.length - 1 && !info.isFile()) throw new Error(`图标源不是普通文件：${current}`)
    }
    return source
}

export async function loadProjectIconSource(state: ProjectState): Promise<PngIconSource | null> {
    const path = await projectIconSourcePath(state)
    return path === null ? null : loadPngIconSource(path)
}
