import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { compileScript, parse } from '@arrange/compiler'
import { SourceMapConsumer } from 'source-map-js'

export type SfaDiagnostic = Readonly<{ file: string; line: number; column: number; message: string; code: string }>

const declarations = `import * as __Arrange from '@arrange/framework'
import * as __Foundation from '@arrange/framework/foundation'
type __Parameters<D> = D extends __Arrange.ArrangableDefinition ? __Arrange.ArrangableProps<D> : never
type __Values<D> = { [K in keyof __Parameters<D>]: () => __Parameters<D>[K] }
declare function __arrangeGetters<D, P>(definition: D, parameters: P & Record<Exclude<keyof P, keyof __Parameters<D>>, never>): { [K in keyof P]: () => P[K] }
type __Selected<D, P> = D extends { readonly contentTarget: infer K } ? K extends keyof P ? P[K] extends () => infer Target ? Target : never : never : never
type __DynamicParameters<D, P> = D extends { readonly contentTarget: string } ? { props?: () => __Parameters<__Selected<D, P>> } : unknown
declare function __arrangeCheck<D, P extends __Values<D>>(definition: D, parameters: P & __DynamicParameters<D, P>, line: number, column: number): P
type __ContentNames<D, P> = D extends { readonly contentTarget: string } ? __ContentNames<__Selected<D, P>, {}> : D extends { readonly slotNames: readonly (infer N)[] } ? N : never
declare function __arrangeCheckSlots<D, S, P>(definition: D, contents: S & Record<Exclude<keyof S, __ContentNames<D, P> | '_'>, never>, line: number, column: number, parameters: P): S
`

// 虚拟 TS 文件保留真实定义及参数类型，既检查 script，也检查模板调用
export function checkSfaProject(configPath: string, roots: readonly string[]): SfaDiagnostic[] {
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    if (config.error) return [{ file: configPath, line: 1, column: 1, message: ts.flattenDiagnosticMessageText(config.error.messageText, '\n'), code: `TS${config.error.code}` }]
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath))
    if (parsed.errors.length) return parsed.errors.map(error => ({ file: configPath, line: 1, column: 1, message: ts.flattenDiagnosticMessageText(error.messageText, '\n'), code: `TS${error.code}` }))
    const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, allowImportingTsExtensions: true, allowArbitraryExtensions: true }
    const files = roots.flatMap(root => root.endsWith('.sfa') ? [resolve(root)] : ts.sys.readDirectory(resolve(root), ['.sfa'], ['**/node_modules/**', '**/dist/**', '**/build/**']))
    const diagnostics: SfaDiagnostic[] = []
    const virtuals = new Map<string, { text: string; map?: SourceMapConsumer; templateLine: number }>()
    const host = ts.createCompilerHost(options)
    const originalRead = host.readFile.bind(host)
    const originalExists = host.fileExists.bind(host)
    const normalize = (file: string) => resolve(file).replaceAll('\\', '/')
    const isVirtual = (file: string) => file.endsWith('.sfa.ts')

    const virtual = (file: string): { text: string; map?: SourceMapConsumer; templateLine: number } | undefined => {
        const key = normalize(file)
        const cached = virtuals.get(key)
        if (cached) return cached
        const sourceFile = file.slice(0, -3)
        const source = originalRead(sourceFile)
        if (source === undefined) return undefined
        try {
            let result = parse(source, { filename: sourceFile })
            if (result.errors.length) throw result.errors[0]
            if (!result.descriptor.script) result = parse(`${source}\n<script></script>`, { filename: sourceFile })
            const script = compileScript(result.descriptor, { genDefaultAs: '_sfa_main', templateOptions: { compilerOptions: { arrangeTypecheck: true, runtimeModuleName: '@arrange/framework/internal' } } })
            const entry = { text: declarations + script.content + '\nexport default _sfa_main\n', map: script.map ? new SourceMapConsumer(script.map) : undefined, templateLine: result.descriptor.template?.loc.start.line ?? 1 }
            virtuals.set(key, entry)
            return entry
        } catch (error) {
            const located = error as { message?: string; loc?: { start?: { line: number; column: number } } }
            diagnostics.push({ file: sourceFile, line: located.loc?.start?.line ?? 1, column: located.loc?.start?.column ?? 1, message: located.message ?? String(error), code: 'SFA' })
            const entry = { text: 'export default undefined', templateLine: 1 }
            virtuals.set(key, entry)
            return entry
        }
    }

    host.fileExists = file => isVirtual(file) ? originalExists(file.slice(0, -3)) : originalExists(file)
    host.readFile = file => isVirtual(file) ? virtual(file)?.text : originalRead(file)
    host.getSourceFile = (file, languageVersion) => {
        const text = host.readFile(file)
        return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true)
    }
    host.resolveModuleNames = (names, containing) => names.map(name => {
        if (name.endsWith('.sfa')) {
            const resolved = ts.resolveModuleName(name + '.ts', containing, options, host).resolvedModule
            if (resolved) return resolved
        }
        return ts.resolveModuleName(name, containing, options, host).resolvedModule
    })

    const program = ts.createProgram(files.map(file => file + '.ts'), options, host)
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
        if (!diagnostic.file || !isVirtual(diagnostic.file.fileName)) {
            const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
            diagnostics.push({ file: diagnostic.file?.fileName ?? configPath, line: (position?.line ?? 0) + 1, column: (position?.character ?? 0) + 1, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), code: `TS${diagnostic.code}` })
            continue
        }
        const entry = virtual(diagnostic.file.fileName)!
        const position = diagnostic.start ?? 0
        const generated = diagnostic.file.getLineAndCharacterOfPosition(position)
        const scriptLine = generated.line + 1 - declarations.split('\n').length + 1
        const mapped = scriptLine > 0 ? entry.map?.originalPositionFor({ line: scriptLine, column: generated.character }) : undefined
        let line = mapped?.line ?? 1
        let column = (mapped?.column ?? 0) + 1
        const locate = (node: ts.Node) => {
            if (position < node.getFullStart() || position >= node.end) return
            if (ts.isCallExpression(node) && ['__arrangeCheck', '__arrangeCheckSlots'].includes(node.expression.getText(diagnostic.file))) {
                line = Number(node.arguments[2].getText(diagnostic.file)) + entry.templateLine - 1
                column = Number(node.arguments[3].getText(diagnostic.file))
            }
            ts.forEachChild(node, locate)
        }
        locate(diagnostic.file)
        diagnostics.push({ file: diagnostic.file.fileName.slice(0, -3), line, column, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), code: `TS${diagnostic.code}` })
    }
    return diagnostics
}