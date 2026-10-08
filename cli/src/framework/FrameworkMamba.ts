import { cliCompatibility } from "../CliMetadata.ts"

export interface FrameworkMetadata {
    readonly version: string
    readonly cliCompatibility: number
}

export interface FrameworkVersionCandidate {
    readonly version: string
    readonly cliCompatibility: number | null
    readonly markedLatest: boolean
    readonly publishedAt: string | null
}

export interface FrameworkVersionSelectionCandidate extends FrameworkVersionCandidate {
    readonly incompatibility: string | null
}

export function addIncompatibilityIfPresenceFor(candidates: readonly FrameworkVersionCandidate[]): FrameworkVersionSelectionCandidate[] {
    return candidates.map((candidate) => {
        const compatibility = candidate.cliCompatibility

        return { ...candidate, incompatibility: compatibility === null ? "不兼容：未声明 arrange.cliCompatibility" : (compatibility !== cliCompatibility ? `不兼容：cliCompatibility 为 ${compatibility}，需要 ${cliCompatibility}` : null) }
    })
}

export function assertFrameworkCompatible(candidate: FrameworkVersionCandidate): void {
    if (candidate.cliCompatibility !== cliCompatibility) throw new Error(`CLI 兼容契约不一致：本 CLI 需要 ${cliCompatibility}，Framework ${candidate.version} 声明的是 ${candidate.cliCompatibility ?? "未声明"}`)
}
