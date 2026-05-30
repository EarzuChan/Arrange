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
    const registryUrl = normalizeRegistryUrl(registry)
    const response = await fetch(`${registryUrl}/@arrange%2fframework`, {headers: {Accept: "application/json"}})
    if (!response.ok) throw new Error(`Cannot read @arrange/framework packument from ${registryUrl}: HTTP ${response.status}`)
    const json = await response.json() as {
        "dist-tags"?: Record<string, string>
        time?: Record<string, string>
        versions?: Record<string, {version?: string; arrange?: {cliCompatibility?: unknown}}>
    }
    const latest = json["dist-tags"]?.latest
    const versions = Object.values(json.versions ?? {})
        .map((manifest) => toCandidate(manifest, latest, json.time))
        .filter((item): item is FrameworkVersionCandidate => item !== null)
    const byPublishedTime = [...versions].sort((a, b) => comparePublishedTimeDesc(a, b))
    const selected: FrameworkVersionCandidate[] = []
    const latestCandidate = latest ? versions.find((item) => item.version === latest) : undefined
    if (latestCandidate) selected.push({...latestCandidate, latest: true})
    selected.push(...byPublishedTime.slice(0, recentLimit).map((item) => ({...item, latest: item.version === latest})))
    return selected
}

function toCandidate(manifest: {version?: string; arrange?: {cliCompatibility?: unknown}}, latest: string | undefined, time: Record<string, string> | undefined): FrameworkVersionCandidate | null {
    if (typeof manifest.version !== "string") return null
    const compatibility = manifest.arrange?.cliCompatibility
    return {
        version: manifest.version,
        cliCompatibility: typeof compatibility === "number" && Number.isInteger(compatibility) ? compatibility : null,
        latest: manifest.version === latest,
        stable: !manifest.version.includes("-"),
        publishedAt: time?.[manifest.version] ?? null,
    }
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
