import { compileScript, invalidateTypeCache, parse } from "@arrange/compiler"
import type { RawSourceMap } from 'source-map-js'
import { withSfaHmr } from './sfa-hmr.ts'

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

export function isSfaModule(id: unknown): boolean {
    const normalized = normalizePath(id)
    return normalized.endsWith(".sfa") || normalized.includes(".sfa&")
}

export function isSfaQueryModule(id: unknown): boolean {
    const text = String(id ?? "")
    if (!isSfaModule(text)) return false
    const query = text.indexOf('?')
    return query >= 0 && new URLSearchParams(text.slice(query + 1)).has('type')
}

function stripBom(code: string): string {
    return code.charCodeAt(0) === 0xfeff ? code.slice(1) : code
}

export function compileArrangeSfa(code: string, id: string, hot = false): ArrangeSfaCompileResult {
    const filename = normalizePath(id)
    const source = stripBom(code)
    const describeError = (error: unknown) => {
        const located = error as { message?: string; loc?: { start: { line: number; column: number } } }
        const position = located.loc?.start
        return `${filename}${position ? `:${position.line}:${position.column}` : ''}：${located.message ?? String(error)}`
    }
    const descriptorResult = parse(source, { filename })
    if (descriptorResult.errors.length) {
        throw new Error(descriptorResult.errors.map(describeError).join("\n"))
    }

    let descriptor = descriptorResult.descriptor
    const warnings: string[] = []

    const compilerOptions = { runtimeModuleName: "@arrange/framework/internal" }
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
        const compiled = hot ? withSfaHmr(output, filename, descriptor.script.content, script.map) : { code: output, map: script.map }
        return {
            code: compiled.code,
            warnings,
            needsTranspile: true,
            map: compiled.map,
            dependencies: script.deps ?? [],
        }
    }

    throw new Error(`Arrange SFA ${filename} 未能建立脚本编译入口`)
}

export function invalidateSfaTypeDependency(filename: string): void {
    invalidateTypeCache(normalizePath(filename))
}
