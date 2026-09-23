import ts from 'typescript'
import MagicString, { Bundle } from 'magic-string'
import { createHash } from 'node:crypto'
import type { RawSourceMap } from 'source-map-js'
import { composeSourceMap } from './source-map.ts'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const stateFactories = new Set(['ref', 'shallowRef', 'reactive', 'shallowReactive', 'createScrollState'])

// 在值单位 lowering 之后抽出模板工厂，符号解析确保不误改模板内部局部变量
export function withSfaHmr(code: string, filename: string, script: string, previousMap?: RawSourceMap): { code: string; map: RawSourceMap } {
    const source = ts.createSourceFile(filename + '.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const host = ts.createCompilerHost({ noLib: true })
    host.getSourceFile = name => name === source.fileName ? source : undefined
    const checker = ts.createProgram([source.fileName], { noLib: true }, host).getTypeChecker()
    let setup: ts.MethodDeclaration | undefined
    let definition: ts.CallExpression | undefined
    const find = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === '_sfa_main' && node.initializer && ts.isCallExpression(node.initializer)) definition = node.initializer
        if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'setup') setup = node
        ts.forEachChild(node, find)
    }
    find(source)
    const body = setup?.body
    const returned = body ? [...body.statements].reverse().find(ts.isReturnStatement)?.expression : undefined
    if (!body || !returned || !definition) throw new Error(`${filename}：无法建立 Arrangable HMR 模板边界`)
    const captures = new Set<string>()
    const mutable = new Set<string>()
    for (const statement of body.statements) {
        if (ts.isVariableStatement(statement)) {
            const collect = (name: ts.BindingName) => {
                if (ts.isIdentifier(name)) {
                    captures.add(name.text)
                    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) mutable.add(name.text)
                } else for (const element of name.elements) if (ts.isBindingElement(element)) collect(element.name)
            }
            for (const declaration of statement.declarationList.declarations) collect(declaration.name)
        } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) captures.add(statement.name.text)
    }
    for (const parameter of setup!.parameters) if (ts.isIdentifier(parameter.name)) captures.add(parameter.name.text)
    const expression = new MagicString(code)
    const rewrite = (node: ts.Node) => {
        if (ts.isIdentifier(node)) {
            const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
            const declaration = symbol?.valueDeclaration
            if (declaration && declaration.pos >= setup!.pos && declaration.end <= returned.pos && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
                captures.add(node.text)
                const access = `__hmrScope.${node.text}`
                expression.overwrite(node.getStart(source), node.end, ts.isShorthandPropertyAssignment(node.parent) ? `${node.text}: ${access}` : access)
            }
        }
        ts.forEachChild(node, rewrite)
    }
    rewrite(returned)
    const template = expression.snip(returned.getStart(source), returned.end)
    const output = new MagicString(code)
    const id = filename.replaceAll('\\', '/')
    const properties = [...captures].map(name => `get ${name}() { return ${name} }${mutable.has(name) ? `, set ${name}(value) { ${name} = value }` : ''}`).join(', ')
    output.overwrite(returned.getStart(source), returned.end, `__bindHotTemplate(${JSON.stringify(id)}, { ${properties} })`)
    const imports = new Map<string, string>()
    const dependencies: string[] = []
    for (const node of source.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly && !node.moduleSpecifier.text.startsWith('@arrange/')) dependencies.push(node.moduleSpecifier.text)
    for (const node of source.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && ['@arrange/framework', '@arrange/reactivity'].includes(node.moduleSpecifier.text)) {
        const bindings = node.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) imports.set(item.name.text, item.propertyName?.text ?? item.name.text)
    }
    for (const statement of body.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer
        if (!ts.isIdentifier(declaration.name) || !initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)) continue
        const factory = imports.get(initializer.expression.text)
        if (factory && stateFactories.has(factory)) output.overwrite(initializer.getStart(source), initializer.end, `__hotState(${JSON.stringify(declaration.name.text + ':' + factory)}, () => (${initializer.getText(source)}))`)
    }
    const options = definition.arguments[0]
    if (ts.isObjectLiteralExpression(options)) output.appendLeft(options.getStart(source) + 1, `\n__hmrId: ${JSON.stringify(id)},`)
    let contract = ts.isObjectLiteralExpression(options) ? options.properties.filter(property => property.name && ['props', 'slotNames', 'contentTarget'].includes(property.name.getText(source))).map(property => property.getText(source)).join('\n') : ''
    // provide/inject 和挂载钩子的闭包契约无法自动重放，脚本变化时重挂载该 Arrangable
    const lifecycle = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const imported = imports.get(node.expression.text)
            if (imported && /^(provide|inject|onBeforeMount|onMounted|onBeforeUnmount|onUnmounted|onActivated|onDeactivated)$/.test(imported)) contract += script
        }
        ts.forEachChild(node, lifecycle)
    }
    lifecycle(body)
    const dependencyNames = dependencies.map((dependency, index) => {
        const name = `__hmrDependency${index}`
        output.prepend(`import * as ${name} from ${JSON.stringify(dependency)}\n`)
        return name
    })
    output.append(`\n__registerHot(${JSON.stringify(id)}, _sfa_main, __hmrTemplate, ${JSON.stringify(digest(script))}, ${JSON.stringify(digest(contract))}, [${dependencyNames.join(', ')}])\nif (import.meta.hot) import.meta.hot.accept(next => { if (next) __applyHot(${JSON.stringify(id)}, next.default) })\n`)
    const bundle = new Bundle({ separator: '' })
    bundle.append(`import { bindArrangableHotTemplate as __bindHotTemplate, arrangableHotState as __hotState, registerArrangableHmr as __registerHot, applyArrangableHmr as __applyHot } from '@arrange/framework/internal'\nconst __hmrTemplate = (__hmrScope) => (`)
    bundle.addSource({ content: template, filename })
    bundle.append(')\n')
    bundle.addSource({ content: output, filename })
    const map = bundle.generateMap({ hires: true, includeContent: true }) as unknown as RawSourceMap
    return { code: bundle.toString(), map: composeSourceMap(map, previousMap) }
}
