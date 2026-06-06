import {cliCompatibility} from "../cliMetadata.ts"

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

        return {...candidate, incompatibility: compatibility === null ? "incompatible: no compatibility code" : (compatibility !== cliCompatibility ? `incompatible: ${compatibility}` : null)}
    })
}

export function assertFrameworkCompatible(candidate: FrameworkVersionCandidate): void {
    if (candidate.cliCompatibility !== cliCompatibility) throw new Error(`CLI compatibility mismatch: this CLI is ${cliCompatibility}, but your ${candidate.version} is ${candidate.cliCompatibility}.`)
}