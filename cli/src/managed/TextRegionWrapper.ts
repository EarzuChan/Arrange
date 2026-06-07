export interface TextSpan {
    readonly start: number
    readonly end: number
}

export type TextRegionWrapperLocation = | {
    readonly kind: "wrapped"
    readonly wrapperSpan: TextSpan
    readonly contentSpan: TextSpan
    readonly content: string
} | { readonly kind: "missing" } | {
    readonly kind: "damaged"
    readonly span: TextSpan
    readonly message: string
}

export interface TextRegionWrapperOptions {
    readonly commentPrefix?: string
    readonly newline?: string
}

interface TextLine {
    readonly text: string
    readonly start: number
    readonly end: number
}

export const textRegionWrapper = {
    beginMarker(regionId: string, options: TextRegionWrapperOptions = {}): string {
        return `${options.commentPrefix ?? "#"} arrange:begin ${regionId}`
    },

    endMarker(regionId: string, options: TextRegionWrapperOptions = {}): string {
        return `${options.commentPrefix ?? "#"} arrange:end ${regionId}`
    },

    wrap(regionId: string, content: string, options: TextRegionWrapperOptions = {}): string {
        const newline = options.newline ?? "\n"
        const body = content.endsWith(newline) ? content : `${content}${newline}`

        return [
            this.beginMarker(regionId, options),
            body + this.endMarker(regionId, options),
            "",
        ].join(newline)
    },

    locate(regionId: string, text: string, options: TextRegionWrapperOptions = {}): TextRegionWrapperLocation {
        const beginMarker = this.beginMarker(regionId, options)
        const endMarker = this.endMarker(regionId, options)
        const lines = readLines(text)
        const beginLines = lines.filter((line) => isMarkerLine(line.text, beginMarker))
        const endLines = lines.filter((line) => isMarkerLine(line.text, endMarker))

        if (beginLines.length === 0 && endLines.length === 0) return {kind: "missing"}

        if (beginLines.length !== 1 || endLines.length !== 1) return {
            kind: "damaged",
            span: {start: 0, end: text.length},
            message: `Damaged managed wrapper for ${regionId}.`,
        }

        const beginLine = beginLines[0]!
        const endLine = endLines[0]!

        if (beginLine.start >= endLine.start) return {
            kind: "damaged",
            span: {start: beginLine.start, end: endLine.end},
            message: `Managed wrapper end appears before begin for ${regionId}.`,
        }

        const contentSpan = {start: beginLine.end, end: endLine.start}

        return {
            kind: "wrapped",
            wrapperSpan: {start: beginLine.start, end: endLine.end},
            contentSpan,
            content: text.slice(contentSpan.start, contentSpan.end),
        }
    },
} as const

function readLines(text: string): readonly TextLine[] {
    const lines: TextLine[] = []
    const pattern = /.*(?:\r\n|\n|\r|$)/g

    while (true) {
        const match = pattern.exec(text)
        if (match === null) break
        if (match[0] === "" && match.index === text.length) break

        lines.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
        })
    }

    return lines
}

function isMarkerLine(line: string, marker: string): boolean {
    return stripLineBreak(line).trim() === marker
}

function stripLineBreak(line: string): string {
    return line.replace(/(?:\r\n|\n|\r)$/, "")
}
