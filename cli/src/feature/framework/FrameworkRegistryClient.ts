import { defaultNodeRegistryUrl, frameworkPackageName, frameworkRegistryTimeoutMs } from "../../CliMetadata.ts"
import { isAbortError } from "../platform/ProcessSpec.ts"
import { RegistryUnreachableError, describeFetchFailure } from "./FrameworkErrors.ts"
import type { FrameworkVersionCandidate } from "./FrameworkMamba.ts"

export function normalizeRegistryUrl(registryUrl?: string): string { // 是否带派
    const raw = registryUrl?.trim() || defaultNodeRegistryUrl
    return raw.replace(/\/+$/, "")
}

interface FrameworkPackument {
    readonly "dist-tags"?: Record<string, string>
    readonly time?: Record<string, string>
    readonly versions?: Record<string, FrameworkManifest>
}

interface FrameworkManifest {
    readonly version?: unknown
    readonly arrange?: {
        readonly cliCompatibility?: unknown
    }
}

export class FrameworkRegistryClient {
    constructor(private readonly signal?: AbortSignal) { }

    private requestSignal(): AbortSignal {
        const timeout = AbortSignal.timeout(frameworkRegistryTimeoutMs)
        return this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
    }

    // 连接失败与超时归为 RegistryUnreachableError，带上 registry 地址和真实原因；用户取消照常以 AbortError 传出
    private async request(registry: string, path: string): Promise<Response> {
        try {
            return await fetch(`${registry}${path}`, { headers: { Accept: "application/json" }, signal: this.requestSignal() })
        } catch (error) {
            if (isAbortError(error)) throw error
            throw new RegistryUnreachableError(registry, describeFetchFailure(error), { cause: error })
        }
    }

    // 单版本接口不返回发布时间
    async fetchCandidateByVersion(version: string, registryUrl?: string): Promise<FrameworkVersionCandidate> {
        const registry = normalizeRegistryUrl(registryUrl)
        const response = await this.request(registry, `/${frameworkPackageName.replace("/", "%2f")}/${encodeURIComponent(version)}`)

        if (!response.ok) throw new Error(`无法从 ${registry} 读取 ${frameworkPackageName}@${version}：HTTP ${response.status}`)

        const manifest = await response.json() as FrameworkManifest

        const actualVersion = typeof manifest.version === "string" ? manifest.version : version
        const cliCompatibility = readCliCompatibility(manifest)
        if (cliCompatibility === null) throw new Error(`${frameworkPackageName}@${actualVersion} 未声明有效的 arrange.cliCompatibility`)

        return { version: actualVersion, cliCompatibility, markedLatest: false, publishedAt: null }
    }

    // 从完整版本列表读取发布时间与最新版本标记
    async fetchCandidates(recentLimit = 5, registryUrl?: string): Promise<FrameworkVersionCandidate[]> {
        const registry = normalizeRegistryUrl(registryUrl)
        const response = await this.request(registry, `/${frameworkPackageName.replace("/", "%2f")}`)

        if (!response.ok) throw new Error(`无法从 ${registry} 读取 ${frameworkPackageName} 版本列表：HTTP ${response.status}`)

        const packument = await response.json() as FrameworkPackument

        const latestVersion = packument["dist-tags"]?.latest
        const times = packument.time ?? {}

        const allCandidates = Object.values(packument.versions ?? {})
            .filter((manifest): manifest is FrameworkManifest & { readonly version: string } => typeof manifest.version === "string")
            .map((manifest): FrameworkVersionCandidate => ({
                version: manifest.version,
                cliCompatibility: readCliCompatibility(manifest),
                markedLatest: false,
                publishedAt: times[manifest.version] ?? null,
            }))

        const result: FrameworkVersionCandidate[] = []
        const latestCandidate = latestVersion ? allCandidates.find((candidate) => candidate.version === latestVersion) : undefined

        if (latestCandidate) result.push({ ...latestCandidate, markedLatest: true })

        const included = new Set(result.map(candidate => candidate.version))
        for (const candidate of [...allCandidates].sort(comparePublishedTimeDesc).slice(0, recentLimit)) {
            if (included.has(candidate.version)) continue
            result.push(candidate)
            included.add(candidate.version)
        }
        return result
    }
}

function readCliCompatibility(manifest: FrameworkManifest): number | null {
    const value = manifest.arrange?.cliCompatibility
    return typeof value === "number" && Number.isInteger(value) ? value : null
}

function comparePublishedTimeDesc(a: FrameworkVersionCandidate, b: FrameworkVersionCandidate): number {
    const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0
    const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0
    if (aTime !== bTime) return bTime - aTime
    return b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: "base" })
}
