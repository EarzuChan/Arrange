import type {ProjectState} from "../project/ProjectState.ts"
import {textRegionWrapper, type TextSpan} from "./TextRegionWrapper.ts"

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

export type TextRegionExpected = { readonly kind: "present"; readonly body: string } | { readonly kind: "default" } | { readonly kind: "invalid"; readonly message: string }

export type TextRegionResult = { readonly kind: "ok" } | { readonly kind: "missing" } | { readonly kind: "outdated"; readonly current: string; readonly expected: string }
    | { readonly kind: "unwrapped-existing"; readonly current: string; readonly expected: string | null } | { readonly kind: "extraneous"; readonly current: string }
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

export abstract class RequiredTextRegion implements TextRegion {
    abstract readonly id: string
    abstract readonly clusterId: string

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const unwrapped = this.seekUnwrapped(clusterText)
        if (unwrapped !== null) return unwrapped

        return {kind: "missing", insertAt: this.missingInsertAt(clusterText)}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        const expected = this.resolveExpected(state)
        if (expected.kind === "invalid") return {kind: "invalid", message: expected.message}
        if (expected.kind === "default") return {kind: "invalid", message: `${this.id} is required but resolved to default.`}

        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}
        if (circumstances.kind === "missing") return {kind: "missing"}

        if (circumstances.kind === "unwrapped") return {
            kind: "unwrapped-existing",
            current: circumstances.content,
            expected: expected.body,
        }

        return normalizeText(circumstances.content) === normalizeText(expected.body) ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected: expected.body}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const expected = this.resolveExpected(state)
        if (expected.kind === "invalid") throw new Error(expected.message)
        if (expected.kind === "default") throw new Error(`${this.id} is required but resolved to default.`)

        return options.managed ? textRegionWrapper.wrap(this.id, expected.body) : withTrailingNewline(expected.body)
    }

    protected abstract seekUnwrapped(clusterText: string): TextRegionCircumstances | null

    protected abstract missingInsertAt(clusterText: string): number

    protected abstract resolveExpected(state: ProjectState): TextRegionExpected
}

export abstract class OptionalTextRegion implements TextRegion {
    abstract readonly id: string
    abstract readonly clusterId: string

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const unwrapped = this.seekUnwrapped(clusterText)
        if (unwrapped !== null) return unwrapped

        return {kind: "missing", insertAt: this.missingInsertAt(clusterText)}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        const expected = this.resolveExpected(state)
        if (expected.kind === "invalid") return {kind: "invalid", message: expected.message}

        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}

        if (expected.kind === "default") {
            if (circumstances.kind === "missing") return {kind: "ok"}

            if (circumstances.kind === "unwrapped") return {
                kind: "unwrapped-existing",
                current: circumstances.content,
                expected: null,
            }

            return {kind: "extraneous", current: circumstances.content}
        }

        if (circumstances.kind === "missing") return {kind: "missing"}

        if (circumstances.kind === "unwrapped") return {
            kind: "unwrapped-existing",
            current: circumstances.content,
            expected: expected.body,
        }

        return normalizeText(circumstances.content) === normalizeText(expected.body) ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected: expected.body}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const expected = this.resolveExpected(state)
        if (expected.kind === "invalid") throw new Error(expected.message)
        if (expected.kind === "default") return ""

        return options.managed ? textRegionWrapper.wrap(this.id, expected.body) : withTrailingNewline(expected.body)
    }

    protected abstract seekUnwrapped(clusterText: string): TextRegionCircumstances | null

    protected abstract missingInsertAt(clusterText: string): number

    protected abstract resolveExpected(state: ProjectState): TextRegionExpected
}

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
}

function withTrailingNewline(value: string): string {
    return value.endsWith("\n") ? value : `${value}\n`
}
