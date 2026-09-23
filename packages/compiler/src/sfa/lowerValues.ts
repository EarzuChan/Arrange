import ts from 'typescript'
import MagicString from 'magic-string'
import { validateValueUnits } from './valueUnits.ts'
import { parse } from './parse.ts'
import { generateSfaScript } from './compileScript.ts'
import { dirname, resolve } from 'node:path'
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from 'source-map-js'

const compilerOptions: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noLib: true, skipLibCheck: true }

// 根据真实声明身份识别值壳，局部同名函数和参数遮蔽不会被改写
export function lowerSfaValues(content: string, filename: string, previousMap?: RawSourceMap): { content: string; map?: RawSourceMap; deps: string[] } {
    const entry = resolve(filename + '.ts')
    const configPath = ts.findConfigFile(dirname(entry), ts.sys.fileExists)
    const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined
    const configured = configPath && config && !config.error ? ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options : {}
    const options = { ...configured, ...compilerOptions, noLib: false, types: [] }
    const host = ts.createCompilerHost(options)
    const read = host.readFile.bind(host)
    const exists = host.fileExists.bind(host)
    const virtuals = new Map<string, string>()
    const analysisPrelude = "\nimport * as __ArrangeUnitsFoundation from '@arrange/framework/foundation'\nimport * as __Foundation from '@arrange/framework/foundation'\n/** @arrangeCheckProps */\ndeclare function __arrangeCheck(...args: any[]): any\n"
    host.readFile = file => {
        if (resolve(file) === entry) return content + analysisPrelude
        if (!file.endsWith('.sfa.ts')) return read(file)
        const cached = virtuals.get(file)
        if (cached !== undefined) return cached
        const sfaFile = file.slice(0, -3)
        const text = read(sfaFile)
        if (text === undefined) return undefined
        const parsed = parse(text, { filename: sfaFile })
        if (parsed.errors.length) throw parsed.errors[0]
        const descriptor = parsed.descriptor.script ? parsed.descriptor : parse(text + '\n<script></script>', { filename: sfaFile }).descriptor
        const script = generateSfaScript(descriptor, {})
        virtuals.set(file, script.content)
        return script.content
    }
    host.fileExists = file => resolve(file) === entry || (file.endsWith('.sfa.ts') ? exists(file.slice(0, -3)) : exists(file))
    host.resolveModuleNames = (names, containing) => names.map(name => ts.resolveModuleName(name.endsWith('.sfa') ? name + '.ts' : name, containing, options, host).resolvedModule)
    host.getSourceFile = (file, version) => {
        const text = host.readFile(file)
        return text === undefined ? undefined : ts.createSourceFile(file, text, version, true)
    }

    const program = ts.createProgram([entry], options, host)
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(entry)!
    const deps = program.getSourceFiles().filter(file => file !== source && !program.isSourceFileDefaultLibrary(file) && !file.fileName.replaceAll('\\', '/').includes('/node_modules/')).map(file => file.fileName.endsWith('.sfa.ts') ? file.fileName.slice(0, -3) : file.fileName)
    const output = new MagicString(content)
    let colorHelper: string | undefined

    const valueKind = (symbol: ts.Symbol | undefined): string | undefined => {
        if (!symbol) return
        if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        for (const declaration of symbol.declarations ?? []) {
            const tag = ts.getJSDocTags(declaration).find(tag => tag.tagName.text === 'arrangeValue')
            if (typeof tag?.comment === 'string') return tag.comment.trim()
        }
    }

    const expressionKind = (node: ts.Expression, seen = new Set<ts.Node>()): string | undefined => {
        if (seen.has(node)) return
        seen.add(node)
        if (ts.isParenthesizedExpression(node)) return expressionKind(node.expression, seen)
        if (ts.isCallExpression(node) && node.arguments.length === 1) {
            const symbol = checker.getSymbolAtLocation(node.expression)
            const resolved = symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
            if (resolved?.declarations?.some(declaration => ts.getJSDocTags(declaration).some(tag => tag.tagName.text === 'arrangeUnref'))) return expressionKind(node.arguments[0], seen)
        }
        const symbol = checker.getSymbolAtLocation(node)
        const kind = valueKind(symbol)
        if (kind) return kind
        const declaration = symbol?.valueDeclaration
        if (declaration?.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) return expressionKind(declaration.initializer, seen)
    }

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            const kind = expressionKind(node.expression)
            if (kind) {
                if (kind === 'color' && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'hsl') {
                    colorHelper ??= uniqueName(content, '__arrangeColorNumber')
                    output.appendLeft(node.getStart(source), `${colorHelper}(`)
                    output.appendLeft(node.end, ')')
                    for (const argument of node.arguments ?? []) visit(argument)
                    return
                }
                if (node.arguments?.length !== 1 || ts.isSpreadElement(node.arguments[0])) throw new Error(`${filename}：${kind} 值壳必须提供一个明确的参数`)
                const argument = node.arguments[0]
                if (kind === 'color') {
                    colorHelper ??= uniqueName(content, '__arrangeColorNumber')
                    output.overwrite(node.getStart(source), argument.getStart(source), `${colorHelper}(`)
                } else output.overwrite(node.getStart(source), argument.getStart(source), '(')
                output.overwrite(argument.end, node.end, ')')
                visit(argument)
                return
            }
        }

        if (ts.isTypeReferenceNode(node) && valueKind(checker.getSymbolAtLocation(node.typeName))) {
            output.overwrite(node.getStart(source), node.end, 'number')
            return
        }

        // 值壳作为运行时 prop 构造声明时，拆壳后的真实类型是 Number
        if ((ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) && ts.isPropertyAssignment(node.parent) && node.parent.initializer === node) {
            let symbol = checker.getSymbolAtLocation(node)
            if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
            if (valueKind(symbol) && symbol?.declarations?.some(ts.isClassDeclaration)) {
                output.overwrite(node.getStart(source), node.end, 'Number')
                return
            }
        }

        if (ts.isAsExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Object' && ts.isTypeReferenceNode(node.type) && node.type.typeArguments?.length === 1) {
            const type = checker.getTypeFromTypeNode(node.type.typeArguments[0])
            if (valueKind(type.symbol)) output.overwrite(node.expression.getStart(source), node.expression.end, 'Number')
        }

        if (ts.isPropertyAccessExpression(node) && node.name.text === 'value' && valueKind(checker.getTypeAtLocation(node.expression).symbol)) {
            output.remove(node.expression.end, node.end)
            visit(node.expression)
            return
        }

        ts.forEachChild(node, child => { if (child.getStart(source) < content.length) visit(child) })
    }

    validateValueUnits(program, source, expressionKind, valueKind, filename, previousMap)
    visit(source)
    if (colorHelper) output.prepend(`import { colorNumber as ${colorHelper} } from '@arrange/framework/internal'\n`)
    const map = output.generateMap({ source: filename, includeContent: true, hires: true }) as unknown as RawSourceMap
    if (previousMap) {
        const generator = SourceMapGenerator.fromSourceMap(new SourceMapConsumer(map))
        generator.applySourceMap(new SourceMapConsumer(previousMap), filename)
        return { content: output.toString(), map: generator.toJSON(), deps }
    }
    return { content: output.toString(), map, deps }
}

function uniqueName(source: string, prefix: string): string {
    let name = prefix
    while (source.includes(name)) name += '_'
    return name
}
