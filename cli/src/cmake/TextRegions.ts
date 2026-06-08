import {CmakeFetchContentCluster, CmakeJuceAddPluginCluster} from "./CmakeClusters.ts"
import {RequiredTextRegion, type TextRegionCircumstances, type TextRegionExpected} from "../managed/TextRegion.ts"
import type {ProjectState} from "../project/ProjectState.ts"

const defaultCmakeFetchContentUrl = "https://github.com/EarzuChan/Arrange.git"

export class CmakeFetchContentRegion extends RequiredTextRegion { // TIPS：The only region of that item
    static readonly key = "cmake.fetch-content"

    readonly id = CmakeFetchContentRegion.key
    readonly clusterId = CmakeFetchContentCluster.key

    protected seekUnwrapped(clusterText: string): TextRegionCircumstances | null {
        const match = /include\s*\(\s*FetchContent\s*\)[\s\S]*?FetchContent_Declare\s*\(\s*arrange[\s\S]*?FetchContent_MakeAvailable\s*\(\s*arrange\s*\)\s*/m.exec(clusterText)
        if (match === null) return null

        return {
            kind: "unwrapped",
            contentSpan: {start: match.index, end: match.index + match[0].length},
            content: match[0],
        }
    }

    protected missingInsertAt(clusterText: string): number {
        return clusterText.length
    }

    protected resolveExpected(state: ProjectState): TextRegionExpected {
        const version = state.project.framework.version.trim()
        if (!version) return {kind: "invalid", message: "framework.version is required."}

        const repositoryUrl = state.project.framework.cmakeFetchContentUrl?.trim() || defaultCmakeFetchContentUrl
        if (!repositoryUrl) return {kind: "invalid", message: "framework.cmakeFetchContentUrl is invalid."}

        return {
            kind: "present",
            body: [
                "include(FetchContent)",
                "FetchContent_Declare(arrange",
                `  GIT_REPOSITORY ${repositoryUrl}`,
                `  GIT_TAG v${version}`,
                ")",
                "FetchContent_MakeAvailable(arrange)",
            ].join("\n"),
        }
    }
}

export class CmakePluginFormatsRegion extends RequiredTextRegion {
    static readonly key = "cmake.plugin-formats"

    readonly id = CmakePluginFormatsRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    protected seekUnwrapped(clusterText: string): TextRegionCircumstances | null {
        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) return null
            if (match[0] === "" && match.index === clusterText.length) return null

            if (/^\s*FORMATS\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) return {
                kind: "unwrapped",
                contentSpan: {start: match.index, end: match.index + match[0].length},
                content: match[0],
            }
        }
    }

    protected missingInsertAt(clusterText: string): number {
        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        let insertAt = firstLineMatch === null ? 0 : firstLineMatch[0].length
        const linePattern = /.*(?:\r\n|\n|\r|$)/g

        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) return insertAt
            if (match[0] === "" && match.index === clusterText.length) return insertAt

            const line = match[0].replace(/(?:\r\n|\n|\r)$/, "")
            if (/^\s*PLUGIN_CODE\s+/.test(line) || /^\s*PLUGIN_MANUFACTURER_CODE\s+/.test(line) || /^\s*COMPANY_NAME\s+/.test(line) || /^\s*VERSION\s+/.test(line)) insertAt = match.index + match[0].length
        }
    }

    protected resolveExpected(state: ProjectState): TextRegionExpected {
        const formats = state.project.project.products.map((product) => product === "standalone" ? "Standalone" : "VST3")
        if (formats.length === 0) return {kind: "invalid", message: "project.products must not be empty."}

        return {kind: "present", body: `  FORMATS ${formats.join(" ")}`}
    }
}

export class CmakePluginVersionRegion extends RequiredTextRegion {
    static readonly key = "cmake.plugin-version"

    readonly id = CmakePluginVersionRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    protected seekUnwrapped(clusterText: string): TextRegionCircumstances | null {
        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) return null
            if (match[0] === "" && match.index === clusterText.length) return null

            if (/^\s*VERSION\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) return {
                kind: "unwrapped",
                contentSpan: {start: match.index, end: match.index + match[0].length},
                content: match[0],
            }
        }
    }

    protected missingInsertAt(clusterText: string): number {
        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        return firstLineMatch === null ? 0 : firstLineMatch[0].length
    }

    protected resolveExpected(state: ProjectState): TextRegionExpected {
        const version = state.project.project.version.trim()
        if (!version) return {kind: "invalid", message: "project.version is required."}

        return {kind: "present", body: `  VERSION ${version}`}
    }
}

export class CmakePluginIdentityRegion extends RequiredTextRegion {
    static readonly key = "cmake.plugin-identity"

    readonly id = CmakePluginIdentityRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    protected seekUnwrapped(clusterText: string): TextRegionCircumstances | null {
        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        let start: number | null = null
        let end: number | null = null

        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break

            const line = match[0].replace(/(?:\r\n|\n|\r)$/, "")
            if (/^\s*COMPANY_NAME\s+/.test(line) || /^\s*PLUGIN_MANUFACTURER_CODE\s+/.test(line) || /^\s*PLUGIN_CODE\s+/.test(line)) {
                start ??= match.index
                end = match.index + match[0].length
            }
        }

        // noinspection PointlessBooleanExpressionJS，下行IDE说always true，但实际上不是：AI说并非，所以应得到保留
        if (start === null || end === null) return null

        return {
            kind: "unwrapped",
            contentSpan: {start, end},
            content: clusterText.slice(start, end),
        }
    }

    protected missingInsertAt(clusterText: string): number {
        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        let insertAt = firstLineMatch === null ? 0 : firstLineMatch[0].length
        const linePattern = /.*(?:\r\n|\n|\r|$)/g

        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) return insertAt
            if (match[0] === "" && match.index === clusterText.length) return insertAt

            if (/^\s*VERSION\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) insertAt = match.index + match[0].length
        }
    }

    protected resolveExpected(state: ProjectState): TextRegionExpected {
        const vendorName = state.project.project.vendorName.trim()
        const vendorCode = state.project.project.vendorCode.trim()
        const pluginCode = state.project.project.pluginCode.trim()

        if (!vendorName) return {kind: "invalid", message: "project.vendorName is required."}
        if (!/^[A-Za-z0-9]{4}$/.test(vendorCode)) return {kind: "invalid", message: "project.vendorCode must be a four-character code."}
        if (!/^[A-Za-z0-9]{4}$/.test(pluginCode)) return {kind: "invalid", message: "project.pluginCode must be a four-character code."}

        return {
            kind: "present",
            body: [
                `  COMPANY_NAME "${vendorName}"`,
                `  PLUGIN_MANUFACTURER_CODE ${vendorCode}`,
                `  PLUGIN_CODE ${pluginCode}`,
            ].join("\n"),
        }
    }
}

export class CmakeProductNameRegion extends RequiredTextRegion {
    static readonly key = "cmake.product-name"

    readonly id = CmakeProductNameRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    protected seekUnwrapped(clusterText: string): TextRegionCircumstances | null {
        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) return null
            if (match[0] === "" && match.index === clusterText.length) return null

            if (/^\s*PRODUCT_NAME\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) return {
                kind: "unwrapped",
                contentSpan: {start: match.index, end: match.index + match[0].length},
                content: match[0],
            }
        }
    }

    protected missingInsertAt(clusterText: string): number {
        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        let insertAt = firstLineMatch === null ? 0 : firstLineMatch[0].length
        const linePattern = /.*(?:\r\n|\n|\r|$)/g

        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) return insertAt
            if (match[0] === "" && match.index === clusterText.length) return insertAt

            const line = match[0].replace(/(?:\r\n|\n|\r)$/, "")
            if (/^\s*FORMATS\s+/.test(line) || /^\s*PLUGIN_CODE\s+/.test(line) || /^\s*PLUGIN_MANUFACTURER_CODE\s+/.test(line) || /^\s*COMPANY_NAME\s+/.test(line) || /^\s*VERSION\s+/.test(line)) insertAt = match.index + match[0].length
        }
    }

    protected resolveExpected(state: ProjectState): TextRegionExpected {
        const name = state.project.project.name.trim()
        if (!name) return {kind: "invalid", message: "project.name is required."}

        return {kind: "present", body: `  PRODUCT_NAME "${name}"`}
    }
}