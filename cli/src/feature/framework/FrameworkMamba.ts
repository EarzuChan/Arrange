import { cliCompatibility } from "../../CliMetadata.ts"

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
    return candidates.map(candidate => ({ ...candidate, incompatibility: frameworkIncompatibility(candidate) }))
}

export function readCliCompatibility(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export function frameworkIncompatibility(candidate: Pick<FrameworkVersionCandidate, 'cliCompatibility'>): string | null {
    const compatibility = readCliCompatibility(candidate.cliCompatibility)
    if (compatibility === null) return '不兼容：未声明有效的 arrange.cliCompatibility'
    return compatibility === cliCompatibility ? null : `不兼容：cliCompatibility 为 ${compatibility}，需要 ${cliCompatibility}`
}

export function assertFrameworkCompatible<T extends Pick<FrameworkVersionCandidate, 'version' | 'cliCompatibility'>>(candidate: T): asserts candidate is T & { readonly cliCompatibility: number } {
    const problem = frameworkIncompatibility(candidate)
    if (problem) throw new Error(`CLI 兼容契约不一致：Framework ${candidate.version} ${problem}（本 CLI 需要 ${cliCompatibility}）`)
}
