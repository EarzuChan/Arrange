import ts from 'typescript'
import MagicString from 'magic-string'
import { validateValueUnits } from './valueUnits.ts'
import { parse } from './parse.ts'
import { generateSfaScript } from './compileScript.ts'
import { dirname, resolve } from 'node:path'
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from 'source-map-js'
import { normalizeSfaUnitSyntax, SFA_UNIT_SEPARATOR } from '../core/unitSyntax.ts'
import { modifierArgumentUnits, unitFieldContracts, type UnitFields, type ValueUnit } from '@arrange/shared'

const compilerOptions: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noLib: true, skipLibCheck: true }

// 根据真实声明身份识别值壳，局部同名函数和参数遮蔽不会被改写
export function lowerSfaValues(content: string, filename: string, previousMap?: RawSourceMap): { content: string; map?: RawSourceMap; deps: string[] } {
    const entry = resolve(filename + '.ts')
    const normalizedEntry = normalizeSfaUnitSyntax(content)
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
        if (resolve(file) === entry) return normalizedEntry.content + analysisPrelude
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
        const normalized = normalizeSfaUnitSyntax(script.content).content
        virtuals.set(file, normalized)
        return normalized
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
    const output = new MagicString(normalizedEntry.content)
    let colorHelper: string | undefined

    type LengthPair = { dp: string; px: string }
    type Rule = ValueUnit | UnitFields

    const textOf = (node: ts.Node): string => source.text.slice(node.getStart(source), node.end).replaceAll(SFA_UNIT_SEPARATOR, '')
    const numeric = (value: string): number | undefined => {
        if (!/^[+-]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?$/.test(value.trim())) return
        const result = Number(value.replaceAll('_', ''))
        return Number.isFinite(result) ? result : undefined
    }
    const folded = (value: number): string => String(Object.is(value, -0) ? 0 : value)
    const unwrap = (node: ts.Expression): ts.Expression => {
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return unwrap(node.expression)
        return node
    }
    const zero = (value: string): boolean => value === '0'
    const add = (left: string, right: string, operator: '+' | '-'): string => {
        const leftNumber = numeric(left)
        const rightNumber = numeric(right)
        if (leftNumber !== undefined && rightNumber !== undefined) return folded(operator === '+' ? leftNumber + rightNumber : leftNumber - rightNumber)
        if (zero(left)) return operator === '+' ? right : `-(${right})`
        if (zero(right)) return left
        return `(${left}) ${operator} (${right})`
    }
    const scale = (value: string, operator: '*' | '/', factor: string): string => {
        if (zero(value)) return '0'
        const valueNumber = numeric(value)
        const factorNumber = numeric(factor)
        if (valueNumber !== undefined && factorNumber !== undefined) return folded(operator === '*' ? valueNumber * factorNumber : valueNumber / factorNumber)
        return `(${value}) ${operator} (${factor})`
    }

    const lengthParts = (input: ts.Expression, seen = new Set<ts.Node>()): LengthPair | undefined => {
        const node = unwrap(input)
        if (seen.has(node)) return
        seen.add(node)

        if (ts.isPropertyAccessExpression(node) && (node.name.text === 'dp' || node.name.text === 'px')) {
            const value = textOf(node.expression)
            return node.name.text === 'dp' ? { dp: value, px: '0' } : { dp: '0', px: value }
        }

        if (ts.isCallExpression(node) && node.arguments.length === 1) {
            const kind = expressionKind(node.expression)
            if (kind === 'dp' || kind === 'px') {
                const value = textOf(node.arguments[0])
                return kind === 'dp' ? { dp: value, px: '0' } : { dp: '0', px: value }
            }
        }

        if (ts.isBinaryExpression(node)) {
            const left = lengthParts(node.left, seen)
            const right = lengthParts(node.right, seen)
            if (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.MinusToken) {
                if (!left || !right) return
                const operator = node.operatorToken.kind === ts.SyntaxKind.PlusToken ? '+' : '-'
                return { dp: add(left.dp, right.dp, operator), px: add(left.px, right.px, operator) }
            }
            if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken || node.operatorToken.kind === ts.SyntaxKind.SlashToken) {
                if (left && !right) return { dp: scale(left.dp, node.operatorToken.kind === ts.SyntaxKind.AsteriskToken ? '*' : '/', textOf(node.right)), px: scale(left.px, node.operatorToken.kind === ts.SyntaxKind.AsteriskToken ? '*' : '/', textOf(node.right)) }
                if (!left && right && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return { dp: scale(right.dp, '*', textOf(node.left)), px: scale(right.px, '*', textOf(node.left)) }
                return
            }
        }

        if (ts.isConditionalExpression(node)) {
            const whenTrue = lengthParts(node.whenTrue, seen)
            const whenFalse = lengthParts(node.whenFalse, seen)
            if (!whenTrue || !whenFalse) return
            const condition = textOf(node.condition)
            return { dp: `(${condition}) ? (${whenTrue.dp}) : (${whenFalse.dp})`, px: `(${condition}) ? (${whenTrue.px}) : (${whenFalse.px})` }
        }

        if (ts.isPrefixUnaryExpression(node)) {
            const value = lengthParts(node.operand, seen)
            if (!value) return
            if (node.operator === ts.SyntaxKind.PlusToken) return value
            if (node.operator === ts.SyntaxKind.MinusToken) return { dp: `-(${value.dp})`, px: `-(${value.px})` }
            return
        }

        if (ts.isPropertyAccessExpression(node) && node.name.text === 'value') {
            const declaration = checker.getSymbolAtLocation(node.expression)?.valueDeclaration
            const initializer = declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.getSourceFile() === source ? declaration.initializer : undefined
            if (initializer && ts.isCallExpression(initializer) && initializer.arguments.length === 1) {
                const pair = lengthParts(initializer.arguments[0], seen)
                if (pair) return pair
            }
        }

        const known = expressionKind(node) ?? propertyUnit(node)
        if (known === 'dp' || known === 'px') return known === 'dp' ? { dp: textOf(node), px: '0' } : { dp: '0', px: textOf(node) }

        const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration
        if (declaration && declaration.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
            if (ts.isCallExpression(declaration.initializer) && declaration.initializer.arguments.length === 1) {
                const pair = lengthParts(declaration.initializer.arguments[0], seen)
                if (pair) return pair
            }
            return lengthParts(declaration.initializer, seen)
        }

        return
    }

    const lowerObject = (node: ts.Expression, fields: UnitFields): void => {
        const object = unwrap(node)
        if (!ts.isObjectLiteralExpression(object)) {
            const owner = ts.isPropertyAccessExpression(object) && object.name.text === 'value' ? object.expression : object
            const declaration = checker.getSymbolAtLocation(owner)?.valueDeclaration
            if (declaration && declaration.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer && declaration.initializer !== object) {
                if (ts.isPropertyAccessExpression(object) && object.name.text === 'value' && ts.isCallExpression(declaration.initializer) && declaration.initializer.arguments.length === 1) {
                    lowerObject(declaration.initializer.arguments[0], fields)
                    return
                }

                lowerObject(declaration.initializer, fields)
                return
            }

            if (ts.isCallExpression(object) && ts.isPropertyAccessExpression(object.expression) && object.expression.expression.getText(source) === 'Object' && object.expression.name.text === 'freeze' && object.arguments.length === 1) {
                lowerObject(object.arguments[0], fields)
                return
            }

            if (ts.isCallExpression(object) && hasTag(object.expression, 'arrangeUnref') && object.arguments.length === 1) {
                lowerObject(object.arguments[0], fields)
                return
            }

            visit(node)
            return
        }
        for (const property of object.properties) {
            if (ts.isSpreadAssignment(property)) {
                visit(property.expression)
                continue
            }
            if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
            const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) ? property.name.text : undefined
            if (!name || !fields[name]) continue
            const field = fields[name]
            const value = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
            if (field === 'length') {
                const pair = lengthParts(value)
                if (!pair) throw new Error(`${filename}：单位字段 ${name} 需要由 DP/PX 表达式组成`)
                output.overwrite(property.getStart(source), property.end, `${name}Dp: ${pair.dp}, ${name}Px: ${pair.px}`)
            } else if (typeof field === 'object') lowerObject(value, field)
            else visit(value)
        }
    }

    const lowerArguments = (argumentsList: readonly ts.Expression[], rules: readonly (Rule | undefined)[] | Rule): void => {
        const list = Array.isArray(rules) ? rules : [rules]
        for (const [index, rule] of list.entries()) {
            const argument = argumentsList[index]
            if (!argument || !rule) continue
            if (rule === 'length') {
                const pair = lengthParts(argument)
                if (!pair) throw new Error(`${filename}：单位参数 ${textOf(argument)} 需要由 DP/PX 表达式组成`)
                output.overwrite(argument.getStart(source), argument.end, `${pair.dp}, ${pair.px}`)
            } else if (typeof rule === 'object') lowerObject(argument, rule)
            else visit(argument)
        }
    }

    const argumentRules = (call: ts.CallExpression): readonly (Rule | undefined)[] | undefined => {
        const node = call.expression
        let symbol = checker.getSymbolAtLocation(node)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        const declarations = [...symbol?.declarations ?? []]
        const signature = checker.getResolvedSignature(call)?.declaration
        if (signature && !declarations.includes(signature)) declarations.push(signature)
        const comment = declarations.map(declaration => ts.getJSDocTags(declaration).find(tag => tag.tagName.text === 'arrangeArguments')?.comment).find(value => typeof value === 'string')
        if (typeof comment !== 'string') return
        return comment.trim().split(/\s+/).map(name => name === 'none' ? undefined : name as ValueUnit)
    }
    const hasTag = (node: ts.Node, name: string): boolean => {
        let symbol = checker.getSymbolAtLocation(node)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        return !!symbol?.declarations?.some(declaration => ts.getJSDocTags(declaration).some(tag => tag.tagName.text === name))
    }

    const valueKind = (symbol: ts.Symbol | undefined): string | undefined => {
        if (!symbol) return
        if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        for (const declaration of symbol.declarations ?? []) {
            const tag = ts.getJSDocTags(declaration).find(tag => tag.tagName.text === 'arrangeValue')
            if (typeof tag?.comment === 'string') return tag.comment.trim()
        }
    }

    const typeUnit = (type: ts.Type): ValueUnit | undefined => {
        const symbolUnit = valueKind(type.aliasSymbol) ?? valueKind(type.symbol)
        if (symbolUnit === 'dp' || symbolUnit === 'px' || symbolUnit === 'sp' || symbolUnit === 'color') return symbolUnit
        const unit = type.getProperty('unit')
        if (!unit) return
        const literal = checker.getTypeOfSymbolAtLocation(unit, source)
        return literal.isStringLiteral() && (literal.value === 'dp' || literal.value === 'px' || literal.value === 'sp' || literal.value === 'color') ? literal.value : undefined
    }

    const fieldsUnit = (type: ts.Type, name: string): ValueUnit | undefined => {
        for (const declaration of [...type.aliasSymbol?.declarations ?? [], ...type.symbol?.declarations ?? []]) {
            const tag = ts.getJSDocTags(declaration).find(item => item.tagName.text === 'arrangeFields')
            if (typeof tag?.comment === 'string') {
                const fields = unitFieldContracts[tag.comment.trim()]
                const unit = fields?.[name]
                return typeof unit === 'string' ? unit : undefined
            }
        }
        return type.isUnion() ? type.types.map(item => fieldsUnit(item, name)).find(Boolean) : undefined
    }

    const propertyUnit = (node: ts.Expression): ValueUnit | undefined => ts.isPropertyAccessExpression(node) ? fieldsUnit(checker.getTypeAtLocation(node.expression), node.name.text) : undefined

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
        const typed = typeUnit(checker.getTypeAtLocation(node))
        if (typed) return typed
        const declaration = symbol?.valueDeclaration
        if (declaration?.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) return expressionKind(declaration.initializer, seen)
    }

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            if (ts.isCallExpression(node) && expressionKind(node.expression) === undefined && ts.isPropertyAccessExpression(node.expression)) {
                const method = node.expression.name.text
                const rules = Object.hasOwn(modifierArgumentUnits, method) ? modifierArgumentUnits[method] : undefined
                if (rules) {
                    if (method === 'padding' && node.arguments.length === 1 && lengthParts(node.arguments[0])) {
                        const pair = lengthParts(node.arguments[0])!
                        output.overwrite(node.arguments[0].getStart(source), node.arguments[0].end, `${pair.dp}, ${pair.px}`)
                    } else lowerArguments(node.arguments, rules)
                    visit(node.expression.expression)
                    return
                }
            }

            if (ts.isCallExpression(node) && expressionKind(node.expression) === undefined) {
                const rules = argumentRules(node)
                if (rules) {
                    lowerArguments(node.arguments, rules)
                    visit(node.expression)
                    return
                }
            }

            if (ts.isCallExpression(node) && expressionKind(node.expression) === undefined && hasTag(node.expression, 'arrangeModifierCall') && node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1])) {
                for (const segment of node.arguments[1].elements) {
                    if (!ts.isArrayLiteralExpression(segment) || !ts.isStringLiteral(segment.elements[0]) || !ts.isArrowFunction(segment.elements[1])) continue
                    const body = segment.elements[1].body
                    const name = segment.elements[0].text
                    const rules = Object.hasOwn(modifierArgumentUnits, name) ? modifierArgumentUnits[name] : undefined
                    if (rules && ts.isArrayLiteralExpression(body)) {
                        const argumentsList = body.elements.filter((entry): entry is ts.Expression => !ts.isSpreadElement(entry))
                        if (name === 'padding' && argumentsList.length === 1 && lengthParts(argumentsList[0])) {
                            const pair = lengthParts(argumentsList[0])!
                            output.overwrite(argumentsList[0].getStart(source), argumentsList[0].end, `${pair.dp}, ${pair.px}`)
                        } else lowerArguments(argumentsList, rules)
                    }
                }
                return
            }

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

        if (ts.isPropertyAccessExpression(node) && (node.name.text === 'dp' || node.name.text === 'px' || node.name.text === 'sp')) {
            output.overwrite(node.getStart(source), node.end, textOf(node.expression))
            visit(node.expression)
            return
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

        ts.forEachChild(node, child => { if (child.getStart(source) < normalizedEntry.content.length) visit(child) })
    }

    validateValueUnits(program, source, expressionKind, valueKind, filename, previousMap)
    visit(source)
    if (colorHelper) output.prepend(`import { colorNumber as ${colorHelper} } from '@arrange/framework/internal'\n`)
    const generated = output.toString().replaceAll(SFA_UNIT_SEPARATOR, '')
    const map = output.generateMap({ source: filename, includeContent: true, hires: true }) as unknown as RawSourceMap
    if (previousMap) {
        const generator = SourceMapGenerator.fromSourceMap(new SourceMapConsumer(map))
        generator.applySourceMap(new SourceMapConsumer(previousMap), filename)
        return { content: generated, map: generator.toJSON(), deps }
    }
    return { content: generated, map, deps }
}

function uniqueName(source: string, prefix: string): string {
    let name = prefix
    while (source.includes(name)) name += '_'
    return name
}
