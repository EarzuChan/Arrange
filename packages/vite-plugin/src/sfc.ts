import { compileScript, compileTemplate, parse } from "@arrange/vue-compiler-sfc"

const HMR_CLIENT_MARKER = "__ARRANGE_HMR_CLIENT__"
const HOT_EXTENSIONS = new Set([".vue", ".ts", ".tsx", ".js", ".jsx"])

export type ArrangeSfcCompileResult = {
    code: string
    warnings: string[]
    needsTranspile: boolean
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

export function isVueModule(id: unknown): boolean {
    const normalized = normalizePath(id)
    return normalized.endsWith(".vue") || normalized.includes(".vue&")
}

export function isVueQueryModule(id: unknown): boolean {
    const text = String(id ?? "")
    return text.includes("?") && isVueModule(text)
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

function supportsTs(lang: string | undefined): boolean {
    return typeof lang === "string" && /tsx?|mts|cts/i.test(lang)
}

function replaceExportRender(code: string): string {
    return code.replace(/^export\s+function\s+render/m, "function render")
}

function stripBom(code: string): string {
    return code.charCodeAt(0) === 0xfeff ? code.slice(1) : code
}

export function compileArrangeSfc(code: string, id: string): ArrangeSfcCompileResult {
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

    const descriptor = descriptorResult.descriptor
    const warnings: string[] = []

    const compilerOptions = { runtimeModuleName: "@arrange/framework" }
    const needsTranspile = supportsTs(descriptor.script?.lang) || supportsTs(descriptor.scriptSetup?.lang)

    if (descriptor.scriptSetup || descriptor.script) {
        const script = compileScript(descriptor, {
            genDefaultAs: "_sfc_main",
            inlineTemplate: Boolean(descriptor.template),
            templateOptions: { compilerOptions },
            isProd: true,
        })

        let output = `${script.content}\n_sfc_main.__file = ${JSON.stringify(filename)}`
        if (!descriptor.template) {
            output += "\nexport default _sfc_main"
        } else if (!script.content.includes("export default")) {
            output += "\nexport default _sfc_main"
        }
        return {
            code: output,
            warnings,
            needsTranspile,
        }
    }

    if (!descriptor.template) {
        throw new Error(`Arrange SFC ${filename} 必须包含 <script> 或 <template> 区块`)
    }

    const template = compileTemplate({
        source: descriptor.template.content,
        ast: descriptor.template.ast,
        filename,
        isProd: true,
        compilerOptions,
    })
    if (template.errors.length) {
        throw new Error(
            template.errors
                .map(describeError)
                .join("\n"),
        )
    }

    const codeBlock = replaceExportRender(template.code)
    const output = `const _sfc_main = {__file: ${JSON.stringify(filename)}}\n${codeBlock}\n_sfc_main.render = render\nexport default _sfc_main`
    return { code: output, warnings, needsTranspile }
}
