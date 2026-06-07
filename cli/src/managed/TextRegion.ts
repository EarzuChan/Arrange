import type {ProjectState} from "../project/ProjectState.ts"
import type {TextSpan} from "./TextRegionWrapper.ts"

export type TextRegionCircumstances = | {
    readonly kind: "wrapped"
    readonly wrapperSpan: TextSpan
    readonly contentSpan: TextSpan
    readonly content: string
} | {
    readonly kind: "unwrapped"
    readonly contentSpan: TextSpan
    readonly content: string
} | {
    readonly kind: "missing"
    readonly insertAt: number
} | {
    readonly kind: "damaged"
    readonly span: TextSpan
    readonly message: string
}

export type TextRegionResult = | { readonly kind: "ok" } | { readonly kind: "missing" } | { readonly kind: "outdated"; readonly current: string; readonly expected: string }
    | { readonly kind: "unwrapped-existing"; readonly current: string; readonly expected: string } | { readonly kind: "extraneous"; readonly current: string }
    | { readonly kind: "damaged"; readonly message: string } | { readonly kind: "invalid"; readonly message: string }

export interface TextRegionEditOptions {
    readonly managed: boolean // 不要删掉我：这是为了Generator生成Unmanaged Region Content
}

export interface TextRegion {
    readonly id: string
    readonly clusterId: string

    seek(clusterText: string): TextRegionCircumstances

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult

    renderText(state: ProjectState, options: TextRegionEditOptions): string
}
