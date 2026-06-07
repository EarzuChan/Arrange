import {NpmrcArrangeRegistryCluster} from "./NpmrcArrangeRegistryCluster.ts"
import type {TextRegion, TextRegionEditOptions, TextRegionCircumstances, TextRegionResult} from "../managed/TextRegion.ts"
import {textRegionWrapper} from "../managed/TextRegionWrapper.ts"
import type {ProjectState} from "../project/ProjectState.ts"

export class NpmrcArrangeRegistryRegion implements TextRegion {
    static readonly key = "node.npmrc.arrange-registry"

    readonly id = NpmrcArrangeRegistryRegion.key
    readonly clusterId = NpmrcArrangeRegistryCluster.key

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break

            if (/^\s*@arrange:registry\s*=/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) return {
                kind: "unwrapped",
                contentSpan: {start: match.index, end: match.index + match[0].length},
                content: match[0],
            }
        }

        return {kind: "missing", insertAt: clusterText.length}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}

        const registryUrl = state.project.framework.nodeRegistryUrl
        if (!registryUrl) {
            if (circumstances.kind === "missing") return {kind: "ok"}
            return {kind: "extraneous", current: circumstances.content}
        }

        const expected = `@arrange:registry=${registryUrl.replace(/\/+$/, "")}`
        if (circumstances.kind === "missing") return {kind: "missing"}

        if (circumstances.kind === "unwrapped") return {kind: "unwrapped-existing", current: circumstances.content, expected}

        return circumstances.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() === expected.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
            ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const registryUrl = state.project.framework.nodeRegistryUrl
        if (!registryUrl) return ""

        const expected = `@arrange:registry=${registryUrl.replace(/\/+$/, "")}`
        return options.managed ? textRegionWrapper.wrap(this.id, expected) : expected.endsWith("\n") ? expected : `${expected}\n`
    }
}
