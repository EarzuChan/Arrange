// 托管内容的换行规则：编辑已有文件时遵循文件自身的换行风格，新建文件一律 LF
// 逻辑文本（生成的区块正文、比较用的期望值）统一使用 LF，只在写入已有文件时转换
export type LineEnding = "\n" | "\r\n"

// CRLF 多于孤立 LF 时视为 CRLF；没有换行或持平时取 LF
export function detectLineEnding(text: string): LineEnding {
    const crlf = text.match(/\r\n/g)?.length ?? 0
    const lf = (text.match(/\n/g)?.length ?? 0) - crlf
    return crlf > lf ? "\r\n" : "\n"
}

export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, "\n")
}

export function toLineEnding(text: string, lineEnding: LineEnding): string {
    const normalized = normalizeLineEndings(text)
    return lineEnding === "\n" ? normalized : normalized.replace(/\n/g, "\r\n")
}

export interface JsonLayout {
    readonly indent: string
    readonly lineEnding: LineEnding
}

// 读取 JSON 文本的缩进（制表符或空格）与换行风格，重新序列化时保留，不整份重排
export function detectJsonLayout(text: string): JsonLayout {
    return { indent: text.match(/\n([\t ]+)"/)?.[1] ?? "  ", lineEnding: detectLineEnding(text) }
}

export function serializeJson(value: unknown, layout: JsonLayout): string {
    return toLineEnding(`${JSON.stringify(value, null, layout.indent)}\n`, layout.lineEnding)
}
