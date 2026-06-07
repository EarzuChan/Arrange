import {CmakeFetchContentCluster, CmakeJuceAddPluginCluster} from "./CmakeClusters.ts"
import type {TextRegion, TextRegionEditOptions, TextRegionCircumstances, TextRegionResult} from "../managed/TextRegion.ts"
import {textRegionWrapper} from "../managed/TextRegionWrapper.ts"
import type {ProjectState} from "../project/ProjectState.ts"

const defaultCmakeFetchContentUrl = "https://github.com/EarzuChan/Arrange.git"

export class CmakeFetchContentRegion implements TextRegion {
    static readonly key = "cmake.fetch-content"

    readonly id = CmakeFetchContentRegion.key
    readonly clusterId = CmakeFetchContentCluster.key

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const unwrappedMatch = /include\s*\(\s*FetchContent\s*\)[\s\S]*?FetchContent_Declare\s*\(\s*arrange[\s\S]*?FetchContent_MakeAvailable\s*\(\s*arrange\s*\)\s*/m.exec(clusterText)
        if (unwrappedMatch !== null) return {
            kind: "unwrapped",
            contentSpan: {start: unwrappedMatch.index, end: unwrappedMatch.index + unwrappedMatch[0].length},
            content: unwrappedMatch[0],
        }

        return {kind: "missing", insertAt: clusterText.length}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}
        if (circumstances.kind === "missing") return {kind: "missing"}

        const expected = [
            "include(FetchContent)",
            "FetchContent_Declare(arrange",
            `  GIT_REPOSITORY ${state.project.framework.cmakeFetchContentUrl ?? defaultCmakeFetchContentUrl}`,
            `  GIT_TAG v${state.project.framework.version}`,
            ")",
            "FetchContent_MakeAvailable(arrange)",
        ].join("\n")

        if (circumstances.kind === "unwrapped") return {kind: "unwrapped-existing", current: circumstances.content, expected}

        return circumstances.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() === expected.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
            ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const expected = [
            "include(FetchContent)",
            "FetchContent_Declare(arrange",
            `  GIT_REPOSITORY ${state.project.framework.cmakeFetchContentUrl ?? defaultCmakeFetchContentUrl}`,
            `  GIT_TAG v${state.project.framework.version}`,
            ")",
            "FetchContent_MakeAvailable(arrange)",
        ].join("\n")
        return options.managed ? textRegionWrapper.wrap(this.id, expected) : expected.endsWith("\n") ? expected : `${expected}\n`
    }
}

export class CmakePluginFormatsRegion implements TextRegion {
    static readonly key = "cmake.plugin-formats"

    readonly id = CmakePluginFormatsRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break
            if (/^\s*FORMATS\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) return {
                kind: "unwrapped",
                contentSpan: {start: match.index, end: match.index + match[0].length},
                content: match[0],
            }
        }

        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        let insertAt = firstLineMatch === null ? 0 : firstLineMatch[0].length
        const insertLinePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = insertLinePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break
            const line = match[0].replace(/(?:\r\n|\n|\r)$/, "")
            if (/^\s*PLUGIN_CODE\s+/.test(line) || /^\s*PLUGIN_MANUFACTURER_CODE\s+/.test(line) || /^\s*COMPANY_NAME\s+/.test(line) || /^\s*VERSION\s+/.test(line)) insertAt = match.index + match[0].length
        }

        return {kind: "missing", insertAt}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}
        if (circumstances.kind === "missing") return {kind: "missing"}

        const expected = `  FORMATS ${state.project.project.products.map((product) => product === "standalone" ? "Standalone" : "VST3").join(" ")}`

        if (circumstances.kind === "unwrapped") return {kind: "unwrapped-existing", current: circumstances.content, expected}

        return circumstances.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() === expected.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
            ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const expected = `  FORMATS ${state.project.project.products.map((product) => product === "standalone" ? "Standalone" : "VST3").join(" ")}`
        return options.managed ? textRegionWrapper.wrap(this.id, expected) : expected.endsWith("\n") ? expected : `${expected}\n`
    }
}

export class CmakePluginVersionRegion implements TextRegion {
    static readonly key = "cmake.plugin-version"

    readonly id = CmakePluginVersionRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break
            if (/^\s*VERSION\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) {
                return {
                    kind: "unwrapped",
                    contentSpan: {start: match.index, end: match.index + match[0].length},
                    content: match[0],
                }
            }
        }

        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        return {kind: "missing", insertAt: firstLineMatch === null ? 0 : firstLineMatch[0].length}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}
        if (circumstances.kind === "missing") return {kind: "missing"}

        const expected = `  VERSION ${state.project.project.version}`
        if (circumstances.kind === "unwrapped") return {kind: "unwrapped-existing", current: circumstances.content, expected}

        return circumstances.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() === expected.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
            ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const expected = `  VERSION ${state.project.project.version}`
        return options.managed ? textRegionWrapper.wrap(this.id, expected) : expected.endsWith("\n") ? expected : `${expected}\n`
    }
}

export class CmakePluginIdentityRegion implements TextRegion {
    static readonly key = "cmake.plugin-identity"

    readonly id = CmakePluginIdentityRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const unwrapped = /^\s*COMPANY_NAME\s+.+(?:\r?\n|\r)\s*PLUGIN_MANUFACTURER_CODE\s+.+(?:\r?\n|\r)\s*PLUGIN_CODE\s+.+(?:\r?\n|\r)?/m.exec(clusterText)
        if (unwrapped !== null) return {
            kind: "unwrapped",
            contentSpan: {start: unwrapped.index, end: unwrapped.index + unwrapped[0].length},
            content: unwrapped[0],
        }

        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        let insertAt = firstLineMatch === null ? 0 : firstLineMatch[0].length
        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break
            if (/^\s*VERSION\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) insertAt = match.index + match[0].length
        }

        return {kind: "missing", insertAt}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}
        if (circumstances.kind === "missing") return {kind: "missing"}

        const expected = [
            `  COMPANY_NAME "${state.project.project.vendorName}"`,
            `  PLUGIN_MANUFACTURER_CODE ${state.project.project.vendorCode}`,
            `  PLUGIN_CODE ${state.project.project.pluginCode}`,
        ].join("\n")
        if (circumstances.kind === "unwrapped") return {kind: "unwrapped-existing", current: circumstances.content, expected}

        return circumstances.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() === expected.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
            ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const expected = [
            `  COMPANY_NAME "${state.project.project.vendorName}"`,
            `  PLUGIN_MANUFACTURER_CODE ${state.project.project.vendorCode}`,
            `  PLUGIN_CODE ${state.project.project.pluginCode}`,
        ].join("\n")
        return options.managed ? textRegionWrapper.wrap(this.id, expected) : expected.endsWith("\n") ? expected : `${expected}\n`
    }
}

export class CmakeProductNameRegion implements TextRegion {
    static readonly key = "cmake.product-name"

    readonly id = CmakeProductNameRegion.key
    readonly clusterId = CmakeJuceAddPluginCluster.key

    seek(clusterText: string): TextRegionCircumstances {
        const wrapped = textRegionWrapper.locate(this.id, clusterText)
        if (wrapped.kind === "wrapped") return wrapped
        if (wrapped.kind === "damaged") return wrapped

        const linePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = linePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break
            if (/^\s*PRODUCT_NAME\s+/.test(match[0].replace(/(?:\r\n|\n|\r)$/, ""))) return {
                kind: "unwrapped",
                contentSpan: {start: match.index, end: match.index + match[0].length},
                content: match[0],
            }
        }

        const firstLineMatch = /.*(?:\r\n|\n|\r|$)/.exec(clusterText)
        let insertAt = firstLineMatch === null ? 0 : firstLineMatch[0].length
        const insertLinePattern = /.*(?:\r\n|\n|\r|$)/g
        while (true) {
            const match = insertLinePattern.exec(clusterText)
            if (match === null) break
            if (match[0] === "" && match.index === clusterText.length) break
            const line = match[0].replace(/(?:\r\n|\n|\r)$/, "")
            if (/^\s*FORMATS\s+/.test(line) || /^\s*PLUGIN_CODE\s+/.test(line) || /^\s*PLUGIN_MANUFACTURER_CODE\s+/.test(line) || /^\s*COMPANY_NAME\s+/.test(line) || /^\s*VERSION\s+/.test(line)) insertAt = match.index + match[0].length
        }

        return {kind: "missing", insertAt}
    }

    check(state: ProjectState, circumstances: TextRegionCircumstances): TextRegionResult {
        if (circumstances.kind === "damaged") return {kind: "damaged", message: circumstances.message}
        if (circumstances.kind === "missing") return {kind: "missing"}

        const expected = `  PRODUCT_NAME "${state.project.project.name}"`
        if (circumstances.kind === "unwrapped") return {kind: "unwrapped-existing", current: circumstances.content, expected}

        return circumstances.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim() === expected.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
            ? {kind: "ok"} : {kind: "outdated", current: circumstances.content, expected}
    }

    renderText(state: ProjectState, options: TextRegionEditOptions): string {
        const expected = `  PRODUCT_NAME "${state.project.project.name}"`
        return options.managed ? textRegionWrapper.wrap(this.id, expected) : expected.endsWith("\n") ? expected : `${expected}\n`
    }
}
