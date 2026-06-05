import type {FrameworkMetadata, FrameworkVersionCandidate} from "./FrameworkMamba.ts"

export const defaultFrameworkRegistryUrl = "https://registry.npmjs.org"

export function normalizeRegistryUrl(registryUrl?: string): string { // CHECK：是否带派
    const raw = registryUrl?.trim() || defaultFrameworkRegistryUrl
    return raw.replace(/\/+$/, "")
}

export const frameworkPackageName = "@arrange/framework"

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
    // 对于一个特定版本。缺陷：无法获得版本发布时间
    async fetchCandidateByVersion(version: string, registryUrl?: string): Promise<FrameworkVersionCandidate> {
        // 原 fetchManifest 逻辑
        const registry = normalizeRegistryUrl(registryUrl)
        const response = await fetch(`${registry}/@arrange%2fframework/${encodeURIComponent(version)}`, {headers: {Accept: "application/json"}})

        if (!response.ok) throw new Error(`Cannot read ${frameworkPackageName}@${version} from ${registry}: HTTP ${response.status}`)

        const manifest = await response.json() as FrameworkManifest

        // 后续处理逻辑
        const actualVersion = typeof manifest.version === "string" ? manifest.version : version
        const cliCompatibility = readCliCompatibility(manifest)
        if (cliCompatibility === null) throw new Error(`${frameworkPackageName}@${actualVersion} does not declare arrange.cliCompatibility.`)

        return {version: actualVersion, cliCompatibility, markedLatest: false, publishedAt: null}
    }

    // TIPS：对于所有版本
    async fetchCandidates(recentLimit = 5, registryUrl?: string): Promise<FrameworkVersionCandidate[]> {
        const registry = normalizeRegistryUrl(registryUrl)
        const response = await fetch(`${registry}/@arrange%2fframework`, {headers: {Accept: "application/json"}})

        if (!response.ok) throw new Error(`Cannot read ${frameworkPackageName} packument from ${registry}: HTTP ${response.status}`)

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

        if (latestCandidate) result.push({...latestCandidate, markedLatest: true})

        result.push(...[...allCandidates].sort(comparePublishedTimeDesc).slice(0, recentLimit))
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
    return b.version.localeCompare(a.version, undefined, {numeric: true, sensitivity: "base"})
}
