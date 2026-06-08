import {NpmrcArrangeRegistryCluster} from "./NpmrcArrangeRegistryCluster.ts"
import {OptionalTextRegion, type TextRegionCircumstances, type TextRegionExpected} from "../managed/TextRegion.ts"
import type {ProjectState} from "../project/ProjectState.ts"

export class NpmrcArrangeRegistryRegion extends OptionalTextRegion {
    static readonly key = "node.npmrc.arrange-registry"

    readonly id = NpmrcArrangeRegistryRegion.key
    readonly clusterId = NpmrcArrangeRegistryCluster.key

    protected seekUnwrapped(clusterText: string): TextRegionCircumstances | null {
        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) return null
            if (match[0] === "" && match.index === clusterText.length) return null

            if (/^\s*@arrange:registry\s*=/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) return {
                kind: "unwrapped",
                contentSpan: {start: match.index, end: match.index + match[0].length},
                content: match[0],
            }
        }
    }

    protected missingInsertAt(clusterText: string): number {
        return clusterText.length
    }

    protected resolveExpected(state: ProjectState): TextRegionExpected {
        const registryUrl = state.project.framework.nodeRegistryUrl?.trim()
        if (!registryUrl) return {kind: "default"}

        return {
            kind: "present",
            body: `@arrange:registry=${registryUrl.replace(/\/+$/, "")}`,
        }
    }
}