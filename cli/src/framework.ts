import {resolve} from "node:path"
import {CLI_COMPATIBILITY} from "./constants.ts"
import {readFrameworkPackageJson} from "./package-resolve.ts"

export type FrameworkMetadata = {
    version: string
    cliCompatibility: number
}

export type FrameworkVersionCandidate = FrameworkMetadata & {
    latest: boolean
    stable: boolean
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
    if (!response.ok) throw new Error(`无法从 npm registry ${registryUrl} 读取 @arrange/framework@${version}: HTTP ${response.status}`)
    const json = await response.json() as {version?: unknown; arrange?: {cliCompatibility?: unknown}}
    const actualVersion = typeof json.version === "string" ? json.version : version
    const compatibility = json.arrange?.cliCompatibility
    if (typeof compatibility !== "number" || !Number.isInteger(compatibility)) {
        throw new Error(`@arrange/framework@${actualVersion} 缺少 arrange.cliCompatibility。`)
    }
    return {version: actualVersion, cliCompatibility: compatibility}
}

export async function fetchFrameworkCandidates(limit = 6, registry?: string): Promise<FrameworkVersionCandidate[]> {
    const registryUrl = normalizeRegistryUrl(registry)
    const response = await fetch(`${registryUrl}/@arrange%2fframework`, {headers: {Accept: "application/json"}})
    if (!response.ok) throw new Error(`无法从 npm registry ${registryUrl} 读取 @arrange/framework packument: HTTP ${response.status}`)
    const json = await response.json() as {
        "dist-tags"?: Record<string, string>
        versions?: Record<string, {version?: string; arrange?: {cliCompatibility?: number}}>
    }
    const latest = json["dist-tags"]?.latest
    const versions = Object.values(json.versions ?? {})
        .map((manifest) => {
            const version = manifest.version
            const compatibility = manifest.arrange?.cliCompatibility
            if (typeof version !== "string" || typeof compatibility !== "number" || !Number.isInteger(compatibility)) return null
            return {version, cliCompatibility: compatibility, latest: version === latest, stable: !version.includes("-")}
        })
        .filter((item): item is FrameworkVersionCandidate => item !== null)
        .sort((a, b) => b.version.localeCompare(a.version, undefined, {numeric: true, sensitivity: "base"}))
    const selected: FrameworkVersionCandidate[] = []
    const latestCandidate = versions.find((item) => item.latest)
    if (latestCandidate) selected.push(latestCandidate)
    for (const candidate of versions) {
        if (selected.some((item) => item.version === candidate.version)) continue
        selected.push(candidate)
        if (selected.length >= limit) break
    }
    return selected
}

export function assertCompatible(metadata: FrameworkMetadata): void {
    if (metadata.cliCompatibility !== CLI_COMPATIBILITY) {
        throw new Error(`CLI 兼容性不一致：当前 CLI 是 ${CLI_COMPATIBILITY}，@arrange/framework@${metadata.version} 是 ${metadata.cliCompatibility}。`)
    }
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
