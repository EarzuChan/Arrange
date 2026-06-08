import {join} from "node:path"
import type {TextCluster, TextClusterLocation} from "../managed/TextCluster.ts"
import type {ProjectContext} from "../project/ProjectState.ts"

export class CmakeFetchContentCluster implements TextCluster {
    static readonly key = "CmakeFetchContentCluster"

    readonly id = CmakeFetchContentCluster.key
    readonly canEditMissingCluster = true

    filePath(context: ProjectContext): string {
        return join(context.state.project.native.directory, "CMakeLists.txt")
    }

    locate(fileText: string): TextClusterLocation {
        return {
            kind: "found",
            span: {start: 0, end: fileText.length}, // ？？根本没定位CmakeFetchContentCluster吧，这不爆炸了？
            text: fileText,
        }
    }

}

export class CmakeJuceAddPluginCluster implements TextCluster {
    static readonly key = "CmakeJuceAddPluginCluster"

    readonly id = CmakeJuceAddPluginCluster.key
    readonly canEditMissingCluster = false

    filePath(context: ProjectContext): string {
        return join(context.state.project.native.directory, "CMakeLists.txt")
    }

    locate(fileText: string): TextClusterLocation {
        const commandStart = fileText.search(/\bjuce_add_plugin\s*\(/)
        if (commandStart < 0) return {kind: "missing"}

        const openParen = fileText.indexOf("(", commandStart)
        if (openParen < 0) return {
            kind: "damaged",
            span: {start: commandStart, end: commandStart + "juce_add_plugin".length},
            message: "Found juce_add_plugin without opening parenthesis.",
        }

        const closeParen = findMatchingParen(fileText, openParen)
        if (closeParen < 0) return {
            kind: "damaged",
            span: {start: commandStart, end: fileText.length},
            message: "Found juce_add_plugin without matching closing parenthesis.",
        }

        const end = includeFollowingLineBreak(fileText, closeParen + 1)
        return {
            kind: "found",
            span: {start: commandStart, end},
            text: fileText.slice(commandStart, end),
        }
    }

}

export function createCmakeTextClusters(): readonly TextCluster[] {
    return [new CmakeFetchContentCluster(), new CmakeJuceAddPluginCluster(),]
}

function findMatchingParen(text: string, openParen: number): number {
    let depth = 0
    let quoted = false
    let escaped = false

    for (let index = openParen; index < text.length; index++) {
        const char = text[index]

        if (quoted) {
            if (escaped) {
                escaped = false
                continue
            }

            if (char === "\\") {
                escaped = true
                continue
            }

            if (char === "\"") quoted = false
            continue
        }

        if (char === "\"") {
            quoted = true
            continue
        }

        if (char === "(") depth++

        if (char === ")") {
            depth--
            if (depth === 0) return index
        }
    }

    return -1
}

function includeFollowingLineBreak(text: string, index: number): number {
    if (text.startsWith("\r\n", index)) return index + 2
    if (text[index] === "\n" || text[index] === "\r") return index + 1
    return index
}
