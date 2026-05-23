import {compileScript, compileTemplate, parse} from "@arrange/vue-compiler-sfc"

const DOM_TAG_PATTERN = /<\s*(div|span|input|canvas|button|section|article|main|header|footer)(\s|>|\/)/
const CLASS_STYLE_PATTERN = /\s(class|style)\s*=/i
const HMR_CLIENT_MARKER = "__ARRANGE_HMR_CLIENT__"
const HOT_EXTENSIONS = new Set([".vue", ".ts", ".tsx", ".js", ".jsx"])

export type ArrangeSfcCompileResult = {
    code: string
    warnings: string[]
    needsEsbuild: boolean
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
import { installArrangeHmrClient as ${HMR_CLIENT_MARKER} } from "@arrange/runtime"
if (import.meta.hot) ${HMR_CLIENT_MARKER}(import.meta.hot)
`
}

function hashId(filename: string, source: string): string {
    let hash = 0x811c9dc5
    const input = `${filename}\0${source}`
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
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
    const descriptorResult = parse(source, {filename})
    if (descriptorResult.errors.length) {
        throw new Error(
            descriptorResult.errors
                .map((error) => error instanceof Error ? error.message : String(error))
                .join("\n"),
        )
    }

    const descriptor = descriptorResult.descriptor
    const warnings: string[] = []
    if (DOM_TAG_PATTERN.test(source)) warnings.push("Arrange does not render DOM/HTML tags; use Box/Row/Column/Text/Input/Canvas etc.")
    if (CLASS_STYLE_PATTERN.test(source)) warnings.push("Arrange ignores class/style attributes; use modifier instead.")
    if (descriptor.styles.length > 0) warnings.push("Arrange ignores SFC <style> blocks; use Modifier and theme tokens instead.")

    const shortId = hashId(filename, source)
    const compilerOptions = {runtimeModuleName: "@arrange/runtime"}
    const needsEsbuild = supportsTs(descriptor.script?.lang) || supportsTs(descriptor.scriptSetup?.lang)

    if (descriptor.scriptSetup || descriptor.script) {
        const script = compileScript(descriptor, {
            id: shortId,
            genDefaultAs: "_sfc_main",
            inlineTemplate: Boolean(descriptor.template),
            templateOptions: {compilerOptions},
            isProd: true,
        })

        let output = script.content
        if (!descriptor.template) {
            output += "\nexport default _sfc_main"
        } else if (!script.content.includes("export default")) {
            output += "\nexport default _sfc_main"
        }
        return {
            code: output,
            warnings,
            needsEsbuild,
        }
    }

    if (!descriptor.template) {
        throw new Error(`Arrange SFC ${filename} contains no <script> or <template> block.`)
    }

    const template = compileTemplate({
        source: descriptor.template.content,
        filename,
        id: shortId,
        isProd: true,
        compilerOptions,
    })
    if (template.errors.length) {
        throw new Error(
            template.errors
                .map((error) => error instanceof Error ? error.message : String(error))
                .join("\n"),
        )
    }

    const codeBlock = replaceExportRender(template.code)
    const output = `const _sfc_main = {}\n${codeBlock}\n_sfc_main.render = render\nexport default _sfc_main`
    return {code: output, warnings, needsEsbuild}
}
