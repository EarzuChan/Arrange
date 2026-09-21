import ts from 'typescript'
import { modifierArgumentUnits, unitFieldContracts, type UnitFields, type ValueUnit } from '@arrange/shared'
import { SourceMapConsumer, type RawSourceMap } from 'source-map-js'

type Rule = ValueUnit | UnitFields

// 只消费正式声明的单位契约，不按局部变量名或函数拼写推测单位
export function validateValueUnits(program: ts.Program, source: ts.SourceFile, expressionKind: (node: ts.Expression) => string | undefined, valueKind: (symbol: ts.Symbol | undefined) => string | undefined, filename: string, map?: RawSourceMap): void {
    const checker = program.getTypeChecker()
    const mapping = map ? new SourceMapConsumer(map) : undefined
    const checked = new Map<ts.Node, Set<Rule>>()
    const symbol = (node: ts.Node) => {
        let result = checker.getSymbolAtLocation(node)
        if (result && result.flags & ts.SymbolFlags.Alias) result = checker.getAliasedSymbol(result)
        return result
    }
    const tag = (node: ts.Node | undefined, name: string) => node && ts.getJSDocTags(node).find(item => item.tagName.text === name)
    const tagged = (node: ts.Node, name: string) => symbol(node)?.declarations?.map(declaration => tag(declaration, name)).find(Boolean)
    const fieldsOf = (type: ts.Type): Rule | undefined => {
        const kind = valueKind(type.aliasSymbol) ?? valueKind(type.symbol)
        if (kind) return kind as ValueUnit
        const unit = type.getProperty('unit')
        if (unit?.declarations?.some(declaration => tag(declaration.parent, 'arrangeValue'))) {
            const literal = checker.getTypeOfSymbolAtLocation(unit, source)
            if (literal.isStringLiteral()) return literal.value as ValueUnit
        }
        for (const declaration of [...type.aliasSymbol?.declarations ?? [], ...type.symbol?.declarations ?? []]) {
            const fields = tag(declaration, 'arrangeFields')?.comment
            if (typeof fields === 'string') return unitFieldContracts[fields.trim()]
        }
        for (const property of type.getProperties()) for (const declaration of property.declarations ?? []) {
            let parent: ts.Node | undefined = declaration.parent
            while (parent && !ts.isSourceFile(parent)) {
                const fields = tag(parent, 'arrangeFields')?.comment
                if (typeof fields === 'string') return unitFieldContracts[fields.trim()]
                parent = parent.parent
            }
        }
        if (type.isUnion()) return type.types.map(fieldsOf).find(Boolean)
    }
    const unwrap = (node: ts.Expression): ts.Expression => {
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return unwrap(node.expression)
        return node
    }
    const initializer = (node: ts.Expression): ts.Expression | undefined => {
        const declaration = symbol(node)?.valueDeclaration
        return declaration?.getSourceFile() === source && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) ? declaration.initializer : undefined
    }
    const fail = (node: ts.Expression, expected: string, actual?: string): never => {
        const generated = source.getLineAndCharacterOfPosition(node.getStart(source))
        const original = mapping?.originalPositionFor({ line: generated.line + 1, column: generated.character })
        const line = original?.line ?? generated.line + 1
        const column = (original?.column ?? generated.character) + 1
        const error = new Error(`单位参数 ${node.getText(source)} 要求 ${expected.toUpperCase()}，${actual ? `实际为 ${actual.toUpperCase()}` : 'SFA 中需要显式值壳或已声明单位的值'}\n来源：${filename}:${line}:${column}`)
        Object.assign(error, { loc: { start: { line, column } } })
        throw error
    }
    const declaredField = (node: ts.Expression): Rule | undefined => {
        if (!ts.isPropertyAccessExpression(node)) return
        const fields = fieldsOf(checker.getTypeAtLocation(node.expression))
        return typeof fields === 'object' ? fields[node.name.text] : undefined
    }
    const arithmeticUnits = (expression: ts.Expression, seen = new Set<ts.Node>()): string[] => {
        const node = unwrap(expression)
        if (seen.has(node)) return []
        seen.add(node)
        const constructed = (ts.isCallExpression(node) || ts.isNewExpression(node)) && expressionKind(node.expression)
        const known = fieldsOf(checker.getTypeAtLocation(expression)) ?? declaredField(node)
        if (constructed || typeof known === 'string') return [constructed || known as string]
        if (ts.isBinaryExpression(node)) return [...arithmeticUnits(node.left, seen), ...arithmeticUnits(node.right, seen)]
        if (ts.isPrefixUnaryExpression(node)) return arithmeticUnits(node.operand, seen)
        const init = initializer(node)
        return init ? arithmeticUnits(init, seen) : []
    }
    const check = (expression: ts.Expression, rule: Rule): void => {
        const node = unwrap(expression)
        let rules = checked.get(node)
        if (rules?.has(rule)) return
        if (!rules) checked.set(node, rules = new Set())
        rules.add(rule)
        if (node.kind === ts.SyntaxKind.UndefinedKeyword || ts.isIdentifier(node) && node.text === 'undefined') return
        if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return check(node.body, rule)
        if (ts.isConditionalExpression(node)) {
            check(node.whenTrue, rule)
            check(node.whenFalse, rule)
            return
        }
        const known = fieldsOf(checker.getTypeAtLocation(expression)) ?? declaredField(node)
        if (typeof rule === 'string') {
            const constructed = (ts.isCallExpression(node) || ts.isNewExpression(node)) && expressionKind(node.expression)
            const actual = constructed || (typeof known === 'string' ? known : undefined)
            if (actual) {
                if (actual !== rule) fail(node, rule, actual)
                return
            }
            if (ts.isBinaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
                // 消融后的算术是普通 JS 算术，只要求声明来源明确，不实现量纲代数
                const units = arithmeticUnits(node)
                if (units.length) {
                    for (const unit of units) if (unit !== rule) fail(node, rule, unit)
                    return
                }
            }
            const valueProperty = checker.getTypeAtLocation(node).getProperty('value')
            const refUnit = valueProperty && fieldsOf(checker.getTypeOfSymbolAtLocation(valueProperty, node))
            if (typeof refUnit === 'string') {
                if (refUnit !== rule) fail(node, rule, refUnit)
                return
            }
            if (ts.isPropertyAccessExpression(node) && node.name.text === 'value') {
                const input = initializer(node.expression)
                if (input && ts.isCallExpression(input) && tagged(input.expression, 'arrangeResult')?.comment === rule) return
            }
            if (ts.isCallExpression(node)) {
                const resultUnit = tagged(node.expression, 'arrangeResult')?.comment
                if (typeof resultUnit === 'string' && resultUnit.trim() === rule) return
            }
            const init = initializer(node)
            if (init) return check(init, rule)
            if (ts.isCallExpression(node) && node.arguments.length && tagged(node.expression, 'arrangeUnref')) return check(node.arguments[0], rule)
            return fail(node, rule)
        }
        if (known === rule) return
        const init = initializer(node)
        if (init) return check(init, rule)
        if (ts.isObjectLiteralExpression(node)) {
            for (const property of node.properties) {
                if (ts.isSpreadAssignment(property)) check(property.expression, rule)
                else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
                    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined
                    if (name && rule[name]) check(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, rule[name])
                }
            }
        } else if (rule === unitFieldContracts.padding) check(node, 'dp')
        else if (rule === unitFieldContracts.brush) check(node, 'color')
        else if (ts.isCallExpression(node) && tagged(node.expression, 'arrangeCheckProps')) check(node.arguments[1], rule)
        else if (ts.isCallExpression(node) && tagged(node.expression, 'arrangeParameterInputs') && ts.isArrayLiteralExpression(node.arguments[0])) {
            for (const entry of node.arguments[0].elements) {
                if (ts.isSpreadElement(entry) && ts.isCallExpression(entry.expression) && tagged(entry.expression.expression, 'arrangeParameterObject')) check(entry.expression.arguments[1], rule)
                else if (ts.isArrayLiteralExpression(entry) && ts.isStringLiteral(entry.elements[0]) && rule[entry.elements[0].text]) check(entry.elements[1], rule[entry.elements[0].text])
            }
        } else {
            const type = checker.getTypeAtLocation(expression)
            if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
                if (Object.keys(rule).length) fail(node, '已声明字段单位的对象')
                return
            }
            for (const [name, field] of Object.entries(rule)) {
                const property = type.getProperty(name)
                if (!property) continue
                const declaration = property.valueDeclaration
                if (declaration && ts.isPropertyAssignment(declaration) && declaration.getSourceFile() === source) check(declaration.initializer, field)
                else if (fieldsOf(checker.getTypeOfSymbolAtLocation(property, node)) !== field) fail(node, typeof field === 'string' ? field : '已声明字段单位的对象')
            }
        }
    }
    const argumentsOf = (node: ts.CallExpression, rules: readonly (Rule | undefined)[]) => {
        for (const [index, rule] of rules.entries()) if (rule && node.arguments[index]) check(node.arguments[index], rule)
    }
    const parameterRule = (type: ts.Type): Rule | undefined => {
        const own = fieldsOf(type)
        if (own) return own
        const signatures = type.getCallSignatures()
        if (signatures.length) return fieldsOf(signatures[0].getReturnType())
    }
    const resolveValue = (node: ts.Expression): ts.Expression => {
        const init = initializer(node)
        if (init) return resolveValue(init)
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'Object' && node.expression.name.text === 'freeze') return resolveValue(node.arguments[0])
        return node
    }
    const definitionType = (node: ts.Expression): ts.Type => {
        if (ts.isCallExpression(node) && tagged(node.expression, 'arrangeResolve') && ts.isStringLiteral(node.arguments[0])) {
            const imported = source.statements.find(statement => ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings) && statement.importClause.namedBindings.name.text === '__ArrangeUnitsFoundation') as ts.ImportDeclaration | undefined
            const namespace = imported?.importClause?.namedBindings
            if (namespace && ts.isNamespaceImport(namespace)) {
                const definition = checker.getTypeAtLocation(namespace.name).getProperty(node.arguments[0].text)
                if (definition) return checker.getTypeOfSymbolAtLocation(definition, node)
            }
        }
        return checker.getTypeAtLocation(node)
    }
    const propRule = (type: ts.Type): Rule | undefined => {
        const constructor = type.getProperty('type')
        if (constructor) return propRule(checker.getTypeOfSymbolAtLocation(constructor, source))
        if (type.aliasTypeArguments?.length) {
            const rule = fieldsOf(type.aliasTypeArguments[0])
            if (rule) return rule
        }
        for (const signature of [...type.getConstructSignatures(), ...type.getCallSignatures()]) {
            const rule = fieldsOf(signature.getReturnType())
            if (rule) return rule
        }
        if (type.isUnion()) return type.types.map(propRule).find(Boolean)
    }
    const checkProps = (definition: ts.Expression, inputs: ts.Expression): void => {
        const type = definitionType(definition)
        const props = type.getProperty('props')
        if (!props) return
        const declarations = checker.getTypeOfSymbolAtLocation(props, source)
        const rules: Record<string, Rule> = {}
        for (const prop of declarations.getProperties()) {
            const rule = propRule(checker.getTypeOfSymbolAtLocation(prop, source))
            if (rule) rules[prop.name] = rule
        }
        check(resolveValue(inputs), rules)
        const target = type.getProperty('contentTarget')
        const targetName = target && checker.getTypeOfSymbolAtLocation(target, source)
        const object = unwrap(resolveValue(inputs))
        if (targetName?.isStringLiteral() && ts.isObjectLiteralExpression(object)) {
            const argument = (name: string): ts.Expression | undefined => {
                const property = object.properties.find(item => ts.isPropertyAssignment(item) && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) && item.name.text === name)
                if (!property || !ts.isPropertyAssignment(property)) return
                const value = unwrap(property.initializer)
                return ts.isArrowFunction(value) && !ts.isBlock(value.body) ? unwrap(value.body) : value
            }
            const selected = argument(targetName.value)
            const parameters = argument('props')
            if (selected && parameters) checkProps(selected, parameters)
        }
    }

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            if (tagged(node.expression, 'arrangeCall') && node.arguments.length >= 3) checkProps(node.arguments[1], node.arguments[2])
            if (tagged(node.expression, 'arrangeCheckProps') && node.arguments.length >= 2) checkProps(node.arguments[0], node.arguments[1])
            const declaration = checker.getResolvedSignature(node)?.declaration
            if (declaration && ts.isMethodDeclaration(declaration) && tag(declaration.parent, 'arrangeModifier')) {
                const name = declaration.name.getText().replaceAll('"', '').replaceAll("'", '')
                const rules = modifierArgumentUnits[name]
                if (rules) {
                    if (name === 'border' && node.arguments.length === 1) check(node.arguments[0], unitFieldContracts.border)
                    else if (name === 'padding') check(node.arguments[0], unitFieldContracts.padding)
                    else argumentsOf(node, rules)
                }
            }
            const argumentTag = tagged(node.expression, 'arrangeArguments')?.comment
            if (typeof argumentTag === 'string') for (const [index, name] of argumentTag.trim().split(/\s+/).entries()) {
                if (name !== 'none' && node.arguments[index]) check(node.arguments[index], unitFieldContracts[name] ?? name as ValueUnit)
            }
            if (tagged(node.expression, 'arrangeModifierCall') && ts.isArrayLiteralExpression(node.arguments[1])) {
                for (const segment of node.arguments[1].elements) {
                    if (!ts.isArrayLiteralExpression(segment) || !ts.isStringLiteral(segment.elements[0]) || !ts.isArrowFunction(segment.elements[1])) continue
                    const name = segment.elements[0].text
                    const body = segment.elements[1].body
                    if (!ts.isArrayLiteralExpression(body)) continue
                    const rules = name === 'border' && body.elements.length === 1 ? [unitFieldContracts.border] : modifierArgumentUnits[name]
                    for (const [index, rule] of (rules ?? []).entries()) if (rule && body.elements[index]) check(body.elements[index], name === 'padding' ? unitFieldContracts.padding : rule)
                }
            }
            if (!expressionKind(node.expression)) {
                const signature = checker.getResolvedSignature(node)
                signature?.parameters.forEach((parameter, index) => {
                    if (!node.arguments[index]) return
                    const rule = parameterRule(checker.getTypeOfSymbolAtLocation(parameter, node))
                    if (rule) check(node.arguments[index], rule)
                })
            }
        }
        if (ts.isVariableDeclaration(node) && node.type && node.initializer) {
            const rule = fieldsOf(checker.getTypeFromTypeNode(node.type))
            if (rule) check(node.initializer, rule)
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const rule = fieldsOf(checker.getTypeAtLocation(node.left))
            if (rule) check(node.right, rule)
        }
        if (ts.isFunctionLike(node) && 'body' in node && node.body && node.type) {
            const rule = fieldsOf(checker.getTypeFromTypeNode(node.type))
            if (rule) {
                const returns = (body: ts.Node): void => {
                    if (ts.isReturnStatement(body) && body.expression) check(body.expression, rule)
                    else if (!ts.isFunctionLike(body)) ts.forEachChild(body, returns)
                }
                if (ts.isBlock(node.body)) returns(node.body)
                else check(node.body as ts.Expression, rule)
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
}
