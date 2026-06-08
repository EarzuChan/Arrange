export interface TextSpan {
    readonly start: number
    readonly end: number
}

export type TextRegionWrapperLocation = {
    readonly kind: "wrapped"
    readonly wrapperSpan: TextSpan
    readonly contentSpan: TextSpan
    readonly content: string
} | { readonly kind: "missing" } | {
    readonly kind: "damaged"
    readonly message: string
}

export interface TextRegionWrapperOptions {
    readonly commentPrefix?: string
    readonly newline?: string
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

        // 使用正则匹配整行标记，允许前后有空格，并捕获换行符
        const beginRegex = new RegExp(`^[ \\t]*${escapeRegExp(beginMarker)}[ \\t]*(?:\\r?\\n|\\r|$)`, "gm")
        const endRegex = new RegExp(`^[ \\t]*${escapeRegExp(endMarker)}[ \\t]*(?:\\r?\\n|\\r|$)`, "gm")

        const beginMatches = Array.from(text.matchAll(beginRegex))
        const endMatches = Array.from(text.matchAll(endRegex))

        if (beginMatches.length === 0 && endMatches.length === 0) return {kind: "missing"}

        // TIPS：如前后wrapper mark任不为一，Damaged：span区间失真！Damage 系需要用户未来的介入才能修复
        if (beginMatches.length !== 1 || endMatches.length !== 1) return {
            kind: "damaged",
            message: `Damaged managed wrapper for ${regionId}.`,
        }

        const beginMatch = beginMatches[0]!
        const endMatch = endMatches[0]!

        const beginStart = beginMatch.index!
        const beginEnd = beginStart + beginMatch[0].length

        const endStart = endMatch.index!
        const endEnd = endStart + endMatch[0].length

        if (beginStart >= endStart) return {
            kind: "damaged",
            message: `Managed wrapper end appears before begin for ${regionId}.`,
        }

        return {
            kind: "wrapped",
            wrapperSpan: {start: beginStart, end: endEnd},
            contentSpan: {start: beginEnd, end: endStart},
            content: text.slice(beginEnd, endStart),
        }
    },
} as const

// 辅助函数：转义正则安全字符
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}