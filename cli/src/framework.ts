import {resolve} from "node:path"
import {CLI_COMPATIBILITY} from "./constants.ts"
import {readFrameworkPackageJson} from "./package-resolve.ts"

export type FrameworkMetadata = {
    version: string
    cliCompatibility: number
}

export type FrameworkVersionCandidate = {
    version: string
    cliCompatibility: number | null
    latest: boolean
    stable: boolean
    publishedAt: string | null
}

export function normalizeRegistryUrl(registry?: string): string {
    const raw = registry?.trim() || "https://registry.npmjs.org"
    return raw.replace(/\/+$/, "")
}

export function localFrameworkMetadata(version: string): FrameworkMetadata {
    return {version, cliCompatibility: CLI_COMPATIBILITY}
}

export async function fetchFrameworkMetadata(version: string, registry?: string): Promise<FrameworkMetadata> {
    const registryUrl = normalizeRegistryUrl(registry)
    const url = `${registryUrl}/@arrange%2fframework/${encodeURIComponent(version)}`
    const response = await fetch(url, {headers: {Accept: "application/json"}})
    if (!response.ok) throw new Error(`Cannot read @arrange/framework@${version} from ${registryUrl}: HTTP ${response.status}`)
    const json = await response.json() as {version?: unknown; arrange?: {cliCompatibility?: unknown}}
    const actualVersion = typeof json.version === "string" ? json.version : version
    const compatibility = json.arrange?.cliCompatibility
    if (typeof compatibility !== "number" || !Number.isInteger(compatibility)) {
        throw new Error(`@arrange/framework@${actualVersion} does not declare arrange.cliCompatibility.`)
    }
    return {version: actualVersion, cliCompatibility: compatibility}
}

export async function fetchFrameworkCandidates(recentLimit = 5, registry?: string): Promise<FrameworkVersionCandidate[]> {
    // 获取并校验数据
    const registryUrl = normalizeRegistryUrl(registry)
    const response = await fetch(`${registryUrl}/@arrange%2fframework`, { headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`Cannot read @arrange/framework packument from ${registryUrl}: HTTP ${response.status}`)

    const packument = await response.json() as {
        "dist-tags"?: Record<string, string>
        time?: Record<string, string>
        versions?: Record<string, { version?: string; arrange?: { cliCompatibility?: unknown } }>
    }

    const latestVersion = packument["dist-tags"]?.latest
    const times = packument.time ?? {}

    // 干净地解析所有候选版本（不在这里处理繁琐的 latest 标记）
    const allCandidates: FrameworkVersionCandidate[] = Object.values(packument.versions ?? {})
        .filter((manifest): manifest is { version: string; arrange?: { cliCompatibility?: unknown } } => typeof manifest?.version === "string")
        .map((manifest) => {
            const compatibility = manifest.arrange?.cliCompatibility
            return {
                version: manifest.version,
                cliCompatibility: typeof compatibility === "number" && Number.isInteger(compatibility) ? compatibility : null,
                latest: false, // 默认全部为 false
                stable: !manifest.version.includes("-"), // HACK：这里是简单粗暴筛选是否有“-”而已
                publishedAt: times[manifest.version] ?? null,
            }
        })

    const result: FrameworkVersionCandidate[] = []

    // 第一项：雷打不动的 latest 版本，单独找出并将其最新状态标为 true
    if (latestVersion) {
        const latestCandidate = allCandidates.find(c => c.version === latestVersion)
        if (latestCandidate) result.push({...latestCandidate, latest: true})
    }

    // 第二到六项：按发布时间倒序取前 5 个追加到后面（其 latest 属性**故意**保持默认的 false，即使版本号与 latest 一致也无需特别标出）
    const sorted = [...allCandidates].sort((a, b) => comparePublishedTimeDesc(a, b))
    const recentCandidates = sorted.slice(0, recentLimit)

    result.push(...recentCandidates)

    return result
}

function comparePublishedTimeDesc(a: FrameworkVersionCandidate, b: FrameworkVersionCandidate): number {
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0
    if (aTime !== bTime) return bTime - aTime
    return b.version.localeCompare(a.version, undefined, {numeric: true, sensitivity: "base"})
}

export function candidateIncompatibility(candidate: FrameworkVersionCandidate): string | null {
    if (candidate.cliCompatibility === null) return "incompatible: no compatibility code"
    if (candidate.cliCompatibility !== CLI_COMPATIBILITY) return `incompatible: ${candidate.cliCompatibility}`
    return null
}

export function assertCompatible(metadata: FrameworkMetadata): void {
    if (metadata.cliCompatibility !== CLI_COMPATIBILITY) throw new Error(`CLI compatibility mismatch: this CLI is ${CLI_COMPATIBILITY}, but @arrange/framework@${metadata.version} is ${metadata.cliCompatibility}.`)
}

export function readInstalledFrameworkMetadata(projectRoot: string, uiPath: string): FrameworkMetadata | null {
    try {
        const manifest = readFrameworkPackageJson(resolve(projectRoot, uiPath)) as {version?: string; arrange?: {cliCompatibility?: number}}
        if (typeof manifest.version !== "string" || typeof manifest.arrange?.cliCompatibility !== "number") return null
        return {
            version: manifest.version,
            cliCompatibility: manifest.arrange.cliCompatibility,
        }
    } catch {
        return null
    }
}
