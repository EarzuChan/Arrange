import { compileScript, invalidateTypeCache, parse } from "@arrange/vue-compiler-sfc"
import type { RawSourceMap } from 'source-map-js'

const HMR_CLIENT_MARKER = "__ARRANGE_HMR_CLIENT__"
const HOT_EXTENSIONS = new Set([".sfa", ".ts", ".tsx", ".js", ".jsx"])

export type ArrangeSfaCompileResult = {
    code: string
    warnings: string[]
    needsTranspile: boolean
    map?: RawSourceMap
    dependencies: string[]
}

export function normalizePath(id: unknown): string {
    return String(id ?? "").split("?")[0].replace(/\\/g, "/")
}

function extensionOf(id: unknown): string {
    const normalized = normalizePath(id)
    const dot = normalized.lastIndexOf(".")
    return dot < 0 ? "" : normalized.slice(dot)
}

export function isEntryModule(id: unknown, entry: string): boolean {
    const normalized = normalizePath(id)
    const normalizedEntry = normalizePath(entry)
    return normalized === normalizedEntry || normalized.endsWith(`/${normalizedEntry}`)
}

export function isSfaModule(id: unknown): boolean {
    const normalized = normalizePath(id)
    return normalized.endsWith(".sfa") || normalized.includes(".sfa&")
}

export function isSfaQueryModule(id: unknown): boolean {
    const text = String(id ?? "")
    return text.includes("?") && isSfaModule(text)
}

export function isHotSourceFile(id: unknown): boolean {
    const normalized = normalizePath(id)
    if (normalized.includes("/node_modules/")) return false
    return HOT_EXTENSIONS.has(extensionOf(normalized))
}

export function injectHmrClient(code: string): string {
    if (code.includes(HMR_CLIENT_MARKER)) return code
    return `${code}
import { installArrangeHmrClient as ${HMR_CLIENT_MARKER} } from "@arrange/framework"
if (import.meta.hot) ${HMR_CLIENT_MARKER}(import.meta.hot)
`
}

function stripBom(code: string): string {
    return code.charCodeAt(0) === 0xfeff ? code.slice(1) : code
}

export function compileArrangeSfa(code: string, id: string): ArrangeSfaCompileResult {
    const filename = normalizePath(id)
    const source = stripBom(code)
    const describeError = (error: unknown) => {
        const located = error as {message?: string; loc?: {start: {line: number; column: number}}}
        const position = located.loc?.start
        return `${filename}${position ? `:${position.line}:${position.column}` : ''}：${located.message ?? String(error)}`
    }
    const descriptorResult = parse(source, { filename })
    if (descriptorResult.errors.length) {
        throw new Error(
            descriptorResult.errors
                .map(describeError)
                .join("\n"),
        )
    }

    let descriptor = descriptorResult.descriptor
    const warnings: string[] = []

    const compilerOptions = { runtimeModuleName: "@arrange/framework" }
    if (!descriptor.script) descriptor = parse(`${source}\n<script></script>`, { filename }).descriptor

    if (descriptor.script) {
        const script = compileScript(descriptor, {
            genDefaultAs: "_sfa_main",
            templateOptions: { compilerOptions },
            isProd: true,
        })

        let output = script.content
        if (!descriptor.template) {
            output += "\nexport default _sfa_main"
        } else if (!script.content.includes("export default")) {
            output += "\nexport default _sfa_main"
        }
        return {
            code: output,
            warnings,
            needsTranspile: true,
            map: script.map,
            dependencies: script.deps ?? [],
        }
    }

    throw new Error(`Arrange SFA ${filename} 未能建立脚本编译入口`)
}

export function invalidateSfaTypeDependency(filename: string): void {
    invalidateTypeCache(normalizePath(filename))
}
