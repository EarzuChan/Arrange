import { execFileSync } from "node:child_process"

// 子进程输出解码：按字节切行（0x0A 在 UTF-8 与 GBK 等双字节编码里都不会作为尾字节出现），
// 每行先按严格 UTF-8 解码，失败再用回退编码。Windows 上 cl 等原生工具经管道输出时使用控制台代码页
// （简体中文系统默认 936/GBK），而 node、pnpm、cmake 输出 UTF-8，所以必须逐行判断

const maximumPendingBytes = 64 * 1024
const utf8 = new TextDecoder("utf-8", { fatal: true })

export type DecoderFactory = () => TextDecoder

const codePageLabels: Readonly<Record<number, string>> = {
    437: "windows-1252", 850: "windows-1252", 858: "windows-1252", 866: "ibm866", 874: "windows-874",
    932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5", 1200: "utf-16le", 1201: "utf-16be",
    1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253", 1254: "windows-1254",
    1255: "windows-1255", 1256: "windows-1256", 1257: "windows-1257", 1258: "windows-1258",
    20866: "koi8-r", 21866: "koi8-u", 28591: "iso-8859-1", 28592: "iso-8859-2", 28595: "iso-8859-5",
    51932: "euc-jp", 54936: "gb18030", 65001: "utf-8",
}

export function codePageDecoder(codePage: number | undefined): TextDecoder {
    const label = codePage === undefined ? undefined : codePageLabels[codePage]
    try { return new TextDecoder(label ?? "windows-1252") } catch { return new TextDecoder("windows-1252") }
}

export function parseCodePage(output: string): number | undefined {
    const match = output.match(/(\d{3,5})\s*$/m) ?? output.match(/(\d{3,5})/)
    return match ? Number(match[1]) : undefined
}

let cachedCodePage: number | undefined
let codePageRead = false

function consoleCodePage(): number | undefined {
    if (codePageRead) return cachedCodePage
    codePageRead = true
    if (process.platform !== "win32") return cachedCodePage = undefined
    try {
        const command = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\chcp.com` : "chcp.com"
        cachedCodePage = parseCodePage(execFileSync(command, [], { encoding: "latin1", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }))
    } catch { cachedCodePage = undefined }
    return cachedCodePage
}

// 子进程与本进程共用同一个控制台，chcp 报告的就是子进程写管道时使用的代码页；只在第一次遇到非 UTF-8 行时探测一次
export function consoleFallbackDecoder(): TextDecoder {
    return codePageDecoder(consoleCodePage())
}

export function decodeLineBytes(bytes: Uint8Array, fallback: DecoderFactory = consoleFallbackDecoder): string {
    let text: string
    try { text = utf8.decode(bytes) } catch { text = fallback().decode(bytes) }
    return overwriteCarriageReturns(text)
}

export class TerminalTextDecoder {
    private pending = Buffer.alloc(0)
    private fallback?: TextDecoder
    constructor(private readonly createFallback: DecoderFactory = consoleFallbackDecoder) { }
    push(chunk: Uint8Array): string {
        let text = '', start = 0
        for (let index = 0; index < chunk.length; index++) if (chunk[index] === 0x0a) {
            text += this.decode(chunk.subarray(start, index + 1))
            if (this.fallback) text += this.fallback.decode()
            this.fallback = undefined
            start = index + 1
        }
        if (start < chunk.length) text += this.decode(chunk.subarray(start))
        return text
    }
    private decode(chunk: Uint8Array): string {
        if (this.fallback) return this.fallback.decode(chunk, { stream: true })
        const bytes = this.pending.length ? Buffer.concat([this.pending, chunk]) : Buffer.from(chunk)
        this.pending = Buffer.alloc(0)
        // 只保留末尾尚未到齐的 UTF-8 字符，其余字节立即交给终端解析
        let end = bytes.length, start = Math.max(0, end - 1)
        while (start > 0 && (bytes[start]! & 0xc0) === 0x80 && end - start < 4) start--
        const first = bytes[start] ?? 0
        const expected = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 1
        if (expected > end - start) end = start
        try {
            const result = utf8.decode(bytes.subarray(0, end))
            this.pending = bytes.subarray(end)
            return result
        } catch {
            this.fallback = this.createFallback()
            return this.fallback.decode(bytes, { stream: true })
        }
    }
    flush(): string {
        if (this.fallback) return this.fallback.decode()
        if (!this.pending.length) return ''
        const text = this.createFallback().decode(this.pending)
        this.pending = Buffer.alloc(0)
        return text
    }
}

// 行内的 \r 表示回到行首覆盖（进度刷新），保留最后一段非空内容
export function overwriteCarriageReturns(text: string): string {
    if (!text.includes("\r")) return text
    const segments = text.split("\r")
    for (let index = segments.length - 1; index >= 0; index--) if (segments[index] !== "") return segments[index]!
    return ""
}

export class LineDecoder {
    private pending: Buffer[] = []
    private pendingLength = 0

    constructor(private readonly onLine: (line: string) => void, private readonly fallback: DecoderFactory = consoleFallbackDecoder) { }

    push(chunk: Uint8Array): void {
        let start = 0
        for (let index = 0; index < chunk.length; index++) {
            if (chunk[index] !== 0x0a) continue
            this.append(chunk.subarray(start, index))
            this.emit()
            start = index + 1
        }
        if (start < chunk.length) {
            this.append(chunk.subarray(start))
            if (this.pendingLength > maximumPendingBytes) this.emit()
        }
    }

    // 进程结束时输出没有换行结尾的最后一行
    flush(): void {
        if (this.pendingLength) this.emit()
    }

    // 尚未换行的当前行，用于实时显示进度类输出
    get partial(): string | undefined {
        if (!this.pendingLength) return undefined
        const text = decodeLineBytes(Buffer.concat(this.pending, this.pendingLength), this.fallback)
        return text === "" ? undefined : text
    }

    private append(bytes: Uint8Array): void {
        if (!bytes.length) return
        this.pending.push(Buffer.from(bytes))
        this.pendingLength += bytes.length
    }

    private emit(): void {
        let bytes = Buffer.concat(this.pending, this.pendingLength)
        this.pending = []
        this.pendingLength = 0
        if (bytes.length && bytes[bytes.length - 1] === 0x0d) bytes = bytes.subarray(0, bytes.length - 1)
        this.onLine(decodeLineBytes(bytes, this.fallback))
    }
}
