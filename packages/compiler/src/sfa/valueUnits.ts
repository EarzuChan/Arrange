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
    const isUnrefCall = (node: ts.Expression): node is ts.CallExpression => {
        if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false
        if (tagged(node.expression, 'arrangeUnref')) return true
        if (!ts.isIdentifier(node.expression)) return false
        const declaration = symbol(node.expression)?.declarations?.find(ts.isImportSpecifier)
        if (!declaration) return false
        const imported = declaration.propertyName ?? declaration.name
        return ts.isIdentifier(imported) && imported.text === 'unref'
    }
    const unitAccess = (node: ts.Expression): node is ts.PropertyAccessExpression => {
        return ts.isPropertyAccessExpression(node) && ['dp', 'px', 'sp'].includes(node.name.text) && !checker.getTypeAtLocation(node.expression).getProperty(node.name.text)
    }
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
    const objectInitializer = (node: ts.Expression): ts.Expression | undefined => {
        const value = unwrap(node)
        if (ts.isPropertyAccessExpression(value) && value.name.text === 'value') {
            const owner = initializer(value.expression)
            if (owner && ts.isCallExpression(owner) && owner.arguments.length === 1) return owner.arguments[0]
        }
        if (isUnrefCall(value)) return objectInitializer(value.arguments[0]) ?? value.arguments[0]
        return initializer(value)
    }
    const fail = (node: ts.Expression, expected: string, actual?: string): never => {
        const generated = source.getLineAndCharacterOfPosition(node.getStart(source))
        const original = mapping?.originalPositionFor({ line: generated.line + 1, column: generated.character })
        const line = original?.line ?? generated.line + 1
        const column = (original?.column ?? generated.character) + 1
        const expressionText = node.getText(source).replaceAll('/*@arrange-unit*/', '')
        const error = new Error(`单位参数 ${expressionText} 要求 ${expected.toUpperCase()}，${actual ? `实际为 ${actual.toUpperCase()}` : 'SFA 中需要显式值壳或已声明单位的值'}\n来源：${filename}:${line}:${column}`)
        Object.assign(error, { loc: { start: { line, column } } })
        throw error
    }
    const declaredField = (node: ts.Expression): Rule | undefined => {
        if (!ts.isPropertyAccessExpression(node)) return
        const fields = fieldsOf(checker.getTypeAtLocation(node.expression))
        return typeof fields === 'object' ? fields[node.name.text] : undefined
    }
    type Dimension = 'number' | 'dp' | 'px' | 'length' | 'sp' | 'color' | 'unknown' | 'invalid'
    const dimension = (expression: ts.Expression, seen = new Set<ts.Node>()): Dimension => {
        const node = unwrap(expression)
        if (seen.has(node)) return 'unknown'
        seen.add(node)

        if (ts.isNumericLiteral(node)) return 'number'
        if (unitAccess(node)) return node.name.text as 'dp' | 'px' | 'sp'

        if (isUnrefCall(node)) return dimension(node.arguments[0], new Set(seen))

        const constructed = (ts.isCallExpression(node) || ts.isNewExpression(node)) && expressionKind(node.expression)
        const known = constructed || fieldsOf(checker.getTypeAtLocation(expression)) as string | undefined || declaredField(node) as string | undefined
        if (known === 'dp' || known === 'px' || known === 'length') return known
        if (known === 'sp' || known === 'color') return known

        if (ts.isConditionalExpression(node)) {
            const whenTrue = dimension(node.whenTrue, new Set(seen))
            const whenFalse = dimension(node.whenFalse, new Set(seen))
            return whenTrue === whenFalse ? whenTrue : whenTrue === 'unknown' ? whenFalse : whenFalse === 'unknown' ? whenTrue : whenTrue === 'dp' && whenFalse === 'px' || whenTrue === 'px' && whenFalse === 'dp' ? 'length' : 'invalid'
        }

        if (ts.isPrefixUnaryExpression(node)) return dimension(node.operand, new Set(seen))

        if (ts.isBinaryExpression(node)) {
            const left = dimension(node.left, new Set(seen))
            const right = dimension(node.right, new Set(seen))
            const operator = node.operatorToken.kind
            if (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.MinusToken) {
                if (left === right) return left
                if (left === 'length' && (right === 'dp' || right === 'px') || right === 'length' && (left === 'dp' || left === 'px')) return 'length'
                if (left === 'dp' && right === 'px' || left === 'px' && right === 'dp') return 'length'
                return left === 'unknown' ? right : right === 'unknown' ? left : 'invalid'
            }
            if (operator === ts.SyntaxKind.AsteriskToken) {
                if (left === 'number') return right
                if (right === 'number') return left
                return left === 'unknown' ? right === 'unknown' ? 'unknown' : 'invalid' : 'invalid'
            }
            if (operator === ts.SyntaxKind.SlashToken) {
                if (left === 'number' && right === 'number') return 'number'
                if (right === 'number') return left
                return 'invalid'
            }
        }

        if (ts.isPropertyAccessExpression(node) && node.name.text === 'value') {
            const init = initializer(node.expression)
            if (init && ts.isCallExpression(init) && init.arguments.length) return dimension(init.arguments[0], new Set(seen))
        }

        const init = initializer(node)
        if (init) return dimension(init, new Set(seen))

        const type = checker.getTypeAtLocation(expression)
        if (type.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.NumberLiteral)) return 'number'
        return 'unknown'
    }
    const matches = (expected: string, actual: string): boolean => expected === 'length' ? actual === 'dp' || actual === 'px' || actual === 'length' : expected === actual
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
            if (unitAccess(node)) {
                if (rule === node.name.text || rule === 'length' && (node.name.text === 'dp' || node.name.text === 'px')) return
                fail(node, rule, node.name.text)
            }
            const constructed = (ts.isCallExpression(node) || ts.isNewExpression(node)) && expressionKind(node.expression)
            const actual = constructed || (typeof known === 'string' ? known : undefined)
            if (actual) {
                if (rule === 'length' ? actual !== 'dp' && actual !== 'px' && actual !== 'length' : actual !== rule) fail(node, rule, actual)
                return
            }
            const actualDimension = dimension(node)
            if (actualDimension !== 'unknown' && (actualDimension !== 'number' || rule === 'length')) {
                const valid = rule === 'length' ? actualDimension === 'dp' || actualDimension === 'px' || actualDimension === 'length' : actualDimension === rule
                if (!valid) fail(node, rule, actualDimension)
                return
            }
            if (rule === 'length' && ts.isPropertyAccessExpression(node) && (node.name.text === 'dp' || node.name.text === 'px')) return
            const valueProperty = checker.getTypeAtLocation(node).getProperty('value')
            const refUnit = valueProperty && fieldsOf(checker.getTypeOfSymbolAtLocation(valueProperty, node))
            if (typeof refUnit === 'string') {
                if (!matches(rule, refUnit)) fail(node, rule, refUnit)
                return
            }
            if (ts.isPropertyAccessExpression(node) && node.name.text === 'value') {
                const input = initializer(node.expression)
                if (input && ts.isCallExpression(input) && tagged(input.expression, 'arrangeResult')?.comment === rule) return
            }
            if (ts.isCallExpression(node)) {
                const resultUnit = tagged(node.expression, 'arrangeResult')?.comment
                if (typeof resultUnit === 'string' && matches(rule, resultUnit.trim())) return
            }
            const init = initializer(node)
            if (init) return check(init, rule)
            if (isUnrefCall(node)) return check(node.arguments[0], rule)
            return fail(node, rule)
        }
        if (known === rule) return
        const init = objectInitializer(node)
        if (init) return check(init, rule)
        if (ts.isObjectLiteralExpression(node)) {
            for (const property of node.properties) {
                if (ts.isSpreadAssignment(property)) check(property.expression, rule)
                else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
                    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined
                    if (name && rule[name]) check(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, rule[name])
                }
            }
        } else if (rule === unitFieldContracts.padding) check(node, 'length')
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
                else {
                    const actual = fieldsOf(checker.getTypeOfSymbolAtLocation(property, node))
                    const compatible = typeof field === 'string' && typeof actual === 'string' ? matches(field, actual) : actual === field
                    if (!compatible) fail(node, typeof field === 'string' ? field : '已声明字段单位的对象')
                }
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
                const rules = Object.hasOwn(modifierArgumentUnits, name) ? modifierArgumentUnits[name] : undefined
                if (rules) {
                    if (name === 'border' && node.arguments.length === 1) check(node.arguments[0], unitFieldContracts.border)
                    else if (name === 'padding') check(node.arguments[0], unitFieldContracts.padding)
                    else argumentsOf(node, rules)
                }
            }
            const argumentTag = tagged(node.expression, 'arrangeArguments')?.comment ?? (() => {
                const declaration = checker.getResolvedSignature(node)?.declaration
                return declaration ? tag(declaration, 'arrangeArguments')?.comment : undefined
            })()
            if (typeof argumentTag === 'string') for (const [index, name] of argumentTag.trim().split(/\s+/).entries()) {
                if (name !== 'none' && node.arguments[index]) check(node.arguments[index], unitFieldContracts[name] ?? name as ValueUnit)
            }
            if (tagged(node.expression, 'arrangeModifierCall') && ts.isArrayLiteralExpression(node.arguments[1])) {
                for (const segment of node.arguments[1].elements) {
                    if (!ts.isArrayLiteralExpression(segment) || !ts.isStringLiteral(segment.elements[0]) || !ts.isArrowFunction(segment.elements[1])) continue
                    const name = segment.elements[0].text
                    const body = segment.elements[1].body
                    if (!ts.isArrayLiteralExpression(body)) continue
                    const rules = name === 'border' && body.elements.length === 1 ? [unitFieldContracts.border] : Object.hasOwn(modifierArgumentUnits, name) ? modifierArgumentUnits[name] : undefined
                    for (const [index, rule] of (rules ?? []).entries()) if (rule && body.elements[index]) check(body.elements[index], name === 'padding' ? unitFieldContracts.padding : rule)
                }
            }
            if (!expressionKind(node.expression)) {
                const signature = checker.getResolvedSignature(node)
                const declaration = signature?.declaration
                if (!(declaration && ts.isMethodDeclaration(declaration) && tag(declaration.parent, 'arrangeModifier'))) signature?.parameters.forEach((parameter, index) => {
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
            else {
                const left = dimension(node.left)
                if (left === 'length' || left === 'dp' || left === 'px' || left === 'sp' || left === 'color') check(node.right, left === 'length' ? 'length' : left)
            }
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
