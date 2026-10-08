import type { BlockStatement, ForInStatement, ForOfStatement, ForStatement, Function, Identifier, Node, ObjectProperty, Program, SwitchCase, SwitchStatement } from '@babel/types'
import { walk } from 'estree-walker'

export function walkIdentifiers(
    root: Node,
    onIdentifier: (node: Identifier, parent: Node | null, parentStack: Node[], isReference: boolean, isLocal: boolean) => void,
    includeAll = false,
    parentStack: Node[] = [],
    knownIds: Record<string, number> = Object.create(null),
): void {

    const rootExp = root.type === 'Program' ? root.body[0].type === 'ExpressionStatement' && root.body[0].expression : root

    walk(root, {
        enter(node: Node & { scopeIds?: Set<string> }, parent: Node | null) {
            parent && parentStack.push(parent)
            if (
                parent && parent.type.startsWith('TS') && !TS_NODE_TYPES.includes(parent.type)
            ) {
                return this.skip()
            }
            if (node.type === 'Identifier') {
                const isLocal = !!knownIds[node.name]
                const isRefed = isReferencedIdentifier(node, parent, parentStack)
                if (includeAll || (isRefed && !isLocal)) {
                    onIdentifier(node, parent, parentStack, isRefed, isLocal)
                }
            } else if (
                node.type === 'ObjectProperty' && parent?.type === 'ObjectPattern'
            ) {

                (node as any).inPattern = true
            } else if (isFunctionType(node)) {
                if (node.scopeIds) {
                    node.scopeIds.forEach(id => markKnownIds(id, knownIds))
                } else {
                    walkFunctionParams(node, id => markScopeIdentifier(node, id, knownIds))
                }
            } else if (node.type === 'BlockStatement') {
                if (node.scopeIds) {
                    node.scopeIds.forEach(id => markKnownIds(id, knownIds))
                } else {
                    walkBlockDeclarations(node, id => markScopeIdentifier(node, id, knownIds))
                }
            } else if (node.type === 'SwitchStatement') {
                if (node.scopeIds) {
                    node.scopeIds.forEach(id => markKnownIds(id, knownIds))
                } else {
                    walkSwitchStatement(node, false, id => markScopeIdentifier(node, id, knownIds))
                }
            } else if (node.type === 'CatchClause' && node.param) {
                if (node.scopeIds) {
                    node.scopeIds.forEach(id => markKnownIds(id, knownIds))
                } else {
                    for (const id of extractIdentifiers(node.param)) {
                        markScopeIdentifier(node, id, knownIds)
                    }
                }
            } else if (isForStatement(node)) {
                if (node.scopeIds) {
                    node.scopeIds.forEach(id => markKnownIds(id, knownIds))
                } else {
                    walkForStatement(node, false, id => markScopeIdentifier(node, id, knownIds))
                }
            }
        },
        leave(node: Node & { scopeIds?: Set<string> }, parent: Node | null) {
            parent && parentStack.pop()
            if (node !== rootExp && node.scopeIds) {
                for (const id of node.scopeIds) {
                    knownIds[id]--
                    if (knownIds[id] === 0) {
                        delete knownIds[id]
                    }
                }
            }
        },
    })
}

export function isReferencedIdentifier(id: Identifier, parent: Node | null, parentStack: Node[]): boolean {

    if (!parent) {
        return true
    }

    if (id.name === 'arguments') {
        return false
    }

    if (isReferenced(id, parent, parentStack[parentStack.length - 2])) {
        return true
    }

    switch (parent.type) {
        case 'AssignmentExpression':
        case 'AssignmentPattern':
            return true
        case 'ObjectProperty':
            return parent.key !== id && isInDestructureAssignment(parent, parentStack)
        case 'ArrayPattern':
            return isInDestructureAssignment(parent, parentStack)
    }

    return false
}

export function isInDestructureAssignment(parent: Node, parentStack: Node[]): boolean {
    if (
        parent && (parent.type === 'ObjectProperty' || parent.type === 'ArrayPattern')
    ) {
        let i = parentStack.length
        while (i--) {
            const p = parentStack[i]
            if (p.type === 'AssignmentExpression') {
                return true
            } else if (p.type !== 'ObjectProperty' && !p.type.endsWith('Pattern')) {
                break
            }
        }
    }
    return false
}

export function isInNewExpression(parentStack: Node[]): boolean {
    let i = parentStack.length
    while (i--) {
        const p = parentStack[i]
        if (p.type === 'NewExpression') {
            return true
        } else if (p.type !== 'MemberExpression') {
            break
        }
    }
    return false
}

export function walkFunctionParams(node: Function, onIdent: (id: Identifier) => void): void {
    for (const p of node.params) {
        for (const id of extractIdentifiers(p)) {
            onIdent(id)
        }
    }
}

export function walkBlockDeclarations(block: BlockStatement | SwitchCase | Program, onIdent: (node: Identifier) => void): void {
    const body = block.type === 'SwitchCase' ? block.consequent : block.body
    for (const stmt of body) {
        if (stmt.type === 'VariableDeclaration') {
            if (stmt.declare) continue
            for (const decl of stmt.declarations) {
                for (const id of extractIdentifiers(decl.id)) {
                    onIdent(id)
                }
            }
        } else if (
            stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration'
        ) {
            if (stmt.declare || !stmt.id) continue
            onIdent(stmt.id)
        } else if (isForStatement(stmt)) {
            walkForStatement(stmt, true, onIdent)
        } else if (stmt.type === 'SwitchStatement') {
            walkSwitchStatement(stmt, true, onIdent)
        }
    }
}

function isForStatement(stmt: Node): stmt is ForStatement | ForOfStatement | ForInStatement {
    return (stmt.type === 'ForOfStatement' || stmt.type === 'ForInStatement' || stmt.type === 'ForStatement')
}

function walkForStatement(stmt: ForStatement | ForOfStatement | ForInStatement, isVar: boolean, onIdent: (id: Identifier) => void) {
    const variable = stmt.type === 'ForStatement' ? stmt.init : stmt.left
    if (
        variable && variable.type === 'VariableDeclaration' && (variable.kind === 'var' ? isVar : !isVar)
    ) {
        for (const decl of variable.declarations) {
            for (const id of extractIdentifiers(decl.id)) {
                onIdent(id)
            }
        }
    }
}

function walkSwitchStatement(stmt: SwitchStatement, isVar: boolean, onIdent: (id: Identifier) => void) {
    for (const cs of stmt.cases) {
        for (const stmt of cs.consequent) {
            if (
                stmt.type === 'VariableDeclaration' && (stmt.kind === 'var' ? isVar : !isVar)
            ) {
                for (const decl of stmt.declarations) {
                    for (const id of extractIdentifiers(decl.id)) {
                        onIdent(id)
                    }
                }
            }
        }
        walkBlockDeclarations(cs, onIdent)
    }
}

export function extractIdentifiers(
    param: Node,
    nodes: Identifier[] = [],
): Identifier[] {
    switch (param.type) {
        case 'Identifier':
            nodes.push(param)
            break

        case 'MemberExpression':
            let object: any = param
            while (object.type === 'MemberExpression') {
                object = object.object
            }
            nodes.push(object)
            break

        case 'ObjectPattern':
            for (const prop of param.properties) {
                if (prop.type === 'RestElement') {
                    extractIdentifiers(prop.argument, nodes)
                } else {
                    extractIdentifiers(prop.value, nodes)
                }
            }
            break

        case 'ArrayPattern':
            param.elements.forEach(element => {
                if (element) extractIdentifiers(element, nodes)
            })
            break

        case 'RestElement':
            extractIdentifiers(param.argument, nodes)
            break

        case 'AssignmentPattern':
            extractIdentifiers(param.left, nodes)
            break
    }

    return nodes
}

function markKnownIds(name: string, knownIds: Record<string, number>) {
    if (name in knownIds) {
        knownIds[name]++
    } else {
        knownIds[name] = 1
    }
}

function markScopeIdentifier(
    node: Node & { scopeIds?: Set<string> },
    child: Identifier,
    knownIds: Record<string, number>,
) {
    const { name } = child
    if (node.scopeIds && node.scopeIds.has(name)) {
        return
    }
    markKnownIds(name, knownIds);
    (node.scopeIds || (node.scopeIds = new Set())).add(name)
}

export const isFunctionType = (node: Node): node is Function => {
    return /Function(?:Expression|Declaration)$|Method$/.test(node.type)
}

export const isStaticProperty = (node: Node): node is ObjectProperty => node && (node.type === 'ObjectProperty' || node.type === 'ObjectMethod') && !node.computed

export const isStaticPropertyKey = (node: Node, parent: Node): boolean => isStaticProperty(parent) && parent.key === node

// 引用判断逻辑来源于 Babel，保留独立实现以免引入整套运行时依赖
// 来源：https://github.com/babel/babel/blob/main/packages/babel-types/src/validators/isReferenced.ts
// 许可：https://github.com/babel/babel/blob/main/LICENSE
function isReferenced(node: Node, parent: Node, grandparent?: Node): boolean {
    switch (parent.type) {
        case 'MemberExpression':
        case 'OptionalMemberExpression':
            if (parent.property === node) {
                return !!parent.computed
            }
            return parent.object === node

        case 'JSXMemberExpression':
            return parent.object === node
        case 'VariableDeclarator':
            return parent.init === node

        case 'ArrowFunctionExpression':
            return parent.body === node

        case 'PrivateName':
            return false

        case 'ClassMethod':
        case 'ClassPrivateMethod':
        case 'ObjectMethod':
            if (parent.key === node) {
                return !!parent.computed
            }
            return false

        case 'ObjectProperty':
            if (parent.key === node) {
                return !!parent.computed
            }
            return !grandparent || grandparent.type !== 'ObjectPattern'
        case 'ClassProperty':
            if (parent.key === node) {
                return !!parent.computed
            }
            return true
        case 'ClassPrivateProperty':
            return parent.key !== node

        case 'ClassDeclaration':
        case 'ClassExpression':
            return parent.superClass === node

        case 'AssignmentExpression':
            return parent.right === node

        case 'AssignmentPattern':
            return parent.right === node

        case 'LabeledStatement':
            return false

        case 'CatchClause':
            return false

        case 'RestElement':
            return false

        case 'BreakStatement':
        case 'ContinueStatement':
            return false

        case 'FunctionDeclaration':
        case 'FunctionExpression':
            return false

        case 'ExportNamespaceSpecifier':
        case 'ExportDefaultSpecifier':
            return false

        case 'ExportSpecifier':
            if (grandparent?.type === 'ExportNamedDeclaration' && grandparent.source) {
                return false
            }
            return parent.local === node

        case 'ImportDefaultSpecifier':
        case 'ImportNamespaceSpecifier':
        case 'ImportSpecifier':
            return false

        case 'ImportAttribute':
            return false

        case 'JSXAttribute':
            return false

        case 'ObjectPattern':
        case 'ArrayPattern':
            return false

        case 'MetaProperty':
            return false

        case 'ObjectTypeProperty':
            return parent.key !== node

        case 'TSEnumMember':
            return parent.id !== node

        case 'TSPropertySignature':
            if (parent.key === node) {
                return !!parent.computed
            }

            return true
    }

    return true
}

export const TS_NODE_TYPES: string[] = [
    'TSAsExpression',
    'TSTypeAssertion',
    'TSNonNullExpression',
    'TSInstantiationExpression',
    'TSSatisfiesExpression',
]

export function unwrapTSNode(node: Node): Node {
    if (TS_NODE_TYPES.includes(node.type)) {
        return unwrapTSNode((node as any).expression)
    } else {
        return node
    }
}
