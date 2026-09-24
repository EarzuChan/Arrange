import { parseExpression } from '@babel/parser'
import type { Expression } from '@babel/types'
import { SourceMapGenerator } from 'source-map-js'
import { camelize } from '@arrange/shared'
import { NodeTypes, createSimpleExpression, type RootNode, type TemplateChildNode, type ElementNode, type DirectiveNode, type ExpressionNode, type SimpleExpressionNode, type SourceLocation } from './ast.ts'
import { BindingTypes, type CompilerOptions } from './options.ts'
import { processExpression, stringifyExpression } from './transforms/transformExpression.ts'
import type { TransformContext } from './transform.ts'
import { helperNameMap } from './runtimeHelpers.ts'
import { normalizeSfaUnitSyntax, restoreBabelNodePositions } from './unitSyntax.ts'

export interface RawSourceMap {
    file?: string
    sourceRoot?: string
    version: string
    sources: string[]
    names: string[]
    sourcesContent?: string[]
    mappings: string
}
export interface CodegenResult { code: string; preamble: string; ast: RootNode; map?: RawSourceMap }

export function generate(ast: RootNode, options: CompilerOptions = {}): CodegenResult {
    const helpers = new Set<string>()
    const setup: string[] = []
    const bindings = options.bindingMetadata ?? {}
    const filename = options.filename ?? '模板.sfa'

    const map = new SourceMapGenerator({ file: filename })
    map.setSourceContent(filename, ast.source)

    let position = 0
    const locations: SourceLocation[] = []

    const helper = (name: string) => {
        helpers.add(name)
        return `_${name}`
    }

    const context: TransformContext = {
        inline: options.inline ?? true,
        isTS: options.isTS ?? true,
        prefixIdentifiers: true,
        bindingMetadata: bindings,
        identifiers: Object.create(null),
        expressionPlugins: options.expressionPlugins ?? ['typescript'],
        onError: options.onError ?? (error => { throw error }),
        helperString(symbol) {
            ast.helpers.add(symbol)
            return helper(helperNameMap[symbol])
        },
    }

    const expression = (node: ExpressionNode | undefined): string => {
        if (!node) return 'undefined'

        return node.type === NodeTypes.SIMPLE_EXPRESSION ? stringifyExpression(processExpression({ ...node }, context)) : stringifyExpression(node)
    }

    const modifierGetter = (node: ExpressionNode | undefined, identity: number): string | undefined => {
        if (options.arrangeTypecheck || node?.type !== NodeTypes.SIMPLE_EXPRESSION) return
        let current: Expression
        try {
            const normalized = normalizeSfaUnitSyntax(node.content)
            current = parseExpression(normalized.content, { plugins: ['typescript'] })
            restoreBabelNodePositions(current, normalized.restore)
        } catch { return }
        const segments: { method: string; args: string[] }[] = []
        const methods = new Set(['padding', 'width', 'height', 'size', 'requiredWidth', 'requiredHeight', 'requiredSize', 'fillMaxWidth', 'fillMaxHeight', 'fillMaxSize', 'widthIn', 'heightIn', 'sizeIn', 'defaultMinSize', 'offset', 'absoluteOffset', 'align', 'weight', 'zIndex', 'background', 'border', 'clip', 'alpha', 'graphicsLayer', 'clickable', 'hoverable', 'focusable', 'verticalScroll', 'horizontalScroll', 'animateContentSize', 'paint', 'text', 'textField'])
        while (current.type === 'CallExpression' && current.callee.type === 'MemberExpression' && !current.callee.computed && current.callee.property.type === 'Identifier' && methods.has(current.callee.property.name)) {
            if (current.arguments.some(argument => argument.type === 'SpreadElement' || argument.type === 'ArgumentPlaceholder')) return
            const args = current.arguments.map(argument => expression(createSimpleExpression(node.content.slice(argument.start!, argument.end!), false, node.loc)))
            segments.unshift({ method: current.callee.property.name, args })
            current = current.callee.object as Expression
        }
        if (!segments.length || current.type !== 'Identifier' || !bindings.__arrangeModifierRoots?.includes(current.name)) return
        const name = `__modifier${identity}`
        const invocation = `${helper('arrangeModifier')}(${current.name}, [${segments.map(segment => `[${JSON.stringify(segment.method)}, () => [${segment.args.join(', ')}]]`).join(', ')}], ${JSON.stringify(`${filename}:${node.loc.start.line}:${node.loc.start.column}`)})`
        if (Object.values(context.identifiers).some(count => count > 0)) return invocation
        setup.push(`const ${name} = ${invocation}`)
        return name
    }

    const directive = (node: ElementNode, name: string) => node.props.find(prop => prop.type === NodeTypes.DIRECTIVE && prop.name === name) as DirectiveNode | undefined

    const location = (loc: SourceLocation) => JSON.stringify(`${filename}:${loc.start.line}:${loc.start.column}`)

    const key = (node: ElementNode): string => {
        for (const prop of node.props) {
            if (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'key') return JSON.stringify(prop.value?.content ?? true)
            if (prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.content === 'key') return expression(prop.exp)
        }

        return 'undefined'
    }

    const emit = (text: string, loc: SourceLocation): string => {
        const index = locations.push(loc) - 1
        return `\u0000${index}\u0000${text}`
    }

    const children = (nodes: TemplateChildNode[]): string => {
        const lines: string[] = []

        for (let index = 0; index < nodes.length; index++) {
            const node = nodes[index]
            if (node.type !== NodeTypes.ELEMENT) continue

            const conditional = directive(node, 'if')
            if (conditional) {
                const id = position++
                const branches = [{ node, condition: conditional.exp }]
                while (index + 1 < nodes.length) {
                    const next = nodes[index + 1]
                    if (next.type === NodeTypes.COMMENT) {
                        index++
                        continue
                    }
                    if (next.type !== NodeTypes.ELEMENT) break

                    const condition = directive(next, 'else-if')
                    if (!condition && !directive(next, 'else')) break

                    branches.push({ node: next, condition: condition?.exp })
                    index++

                    if (!condition) break
                }
                const body = branches.map((branch, branchIndex) => `${branchIndex ? 'else ' : ''}${branch.condition ? `if (${expression(branch.condition)}) ` : ''}{\n${element(branch.node, true)}\n}`).join(' ')
                lines.push(emit(`${helper('arrangeScope')}(${id}, () => {\n${body}\n}, undefined, ${location(node.loc)})`, node.loc))
            } else {
                if (directive(node, 'else-if') || directive(node, 'else')) throw new SyntaxError('a-else 必须紧邻对应条件分支')

                lines.push(element(node))
            }
        }
        return lines.join('\n')
    }
    const element = (node: ElementNode, skipIf = false, skipFor = false): string => {
        const loop = !skipFor && directive(node, 'for')

        if (loop) {
            const parsed = loop.forParseResult
            if (!parsed) throw new SyntaxError('a-for 缺少有效的条目与集合表达式')
            const id = position++
            const source = expression(parsed.source)
            const aliases = [parsed.value, parsed.key, parsed.index].map((value, index) => value?.type === NodeTypes.SIMPLE_EXPRESSION ? value.content : `__item${id}_${index}`)
            for (const alias of aliases) for (const name of alias.match(/[A-Za-z_$][\w$]*/g) ?? []) context.identifiers[name] = (context.identifiers[name] ?? 0) + 1
            const identity = key(node)
            const body = element(node, skipIf, true)
            for (const alias of aliases) for (const name of alias.match(/[A-Za-z_$][\w$]*/g) ?? []) context.identifiers[name]--
            return `${helper('arrangeScope')}(${id}, () => ${helper('arrangeList')}(${id}, ${source}, (${aliases.join(', ')}) => ${identity}, (${aliases.join(', ')}) => {\n${body}\n}), undefined, ${location(node.loc)})`
        }

        const id = position++
        if (node.tag === 'Template') return `${helper('arrangeScope')}(${id}, () => {\n${children(node.children)}\n}, ${key(node)}, ${location(node.loc)})`
        if (node.tag === 'Slot') {
            const named = node.props.find(prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'name')
            const name = named?.type === NodeTypes.ATTRIBUTE ? named.value?.content ?? 'default' : 'default'
            setup.push(`const __content${id} = ${helper('useSlots')}()[${JSON.stringify(name)}]`)
            return `${helper('invokeContent')}(${id}, __content${id})`
        }

        const binding = bindings[node.tag]
        const definition = binding ? expression(createSimpleExpression(node.tag)) : options.arrangeTypecheck ? `__Foundation.${node.tag}` : `${helper('resolveArrangable')}(${JSON.stringify(node.tag)})`
        const parameters: string[] = []
        const fixedParameters: string[] = []
        const parameterNames: string[] = []
        const checkParameters: string[] = []
        let dynamicShape = false
        const constants: string[] = []
        const sources: string[] = []

        for (const prop of node.props) {
            if (prop.type === NodeTypes.ATTRIBUTE) {
                if (prop.name === 'key') continue

                const name = camelize(prop.name)
                const value = emit(JSON.stringify(prop.value?.content ?? true), prop.loc)
                parameters.push(`[${JSON.stringify(name)}, () => ${value}]`)
                fixedParameters.push(`${JSON.stringify(name)}: () => ${value}`)
                parameterNames.push(name)
                checkParameters.push(`${JSON.stringify(name)}: () => ${value}`)
                constants.push(name)
                sources.push(`${JSON.stringify(name)}: ${location(prop.loc)}`)
            } else if (prop.name === 'bind') {
                if (prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.content === 'key') continue

                if (!prop.arg) {
                    dynamicShape = true
                    parameters.push(`...${helper('parameterObject')}(${position++}, () => (${expression(prop.exp)}))`)
                    checkParameters.push(`...__arrangeGetters(${definition}, ${expression(prop.exp)})`)
                    continue
                }
                const staticName = prop.arg.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic
                const name = staticName ? JSON.stringify(camelize((prop.arg as SimpleExpressionNode).content)) : `${helper('arrangeParameterName')}(${expression(prop.arg)})`
                const value = emit(expression(prop.exp), prop.exp?.loc ?? prop.loc)
                const getter = staticName && (prop.arg as SimpleExpressionNode).content === 'modifier' ? modifierGetter(prop.exp, position++) : undefined
                const read = getter ?? `() => (${value})`
                parameters.push(`[${name}, ${read}]`)
                checkParameters.push(`${staticName ? name : `[${name}]`}: ${read}`)

                if (staticName) fixedParameters.push(`${name}: ${read}`)
                else dynamicShape = true

                if (staticName) {
                    parameterNames.push(camelize((prop.arg as SimpleExpressionNode).content))
                    sources.push(`${name}: ${location(prop.loc)}`)
                    if (prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION && (/^(?:true|false|null|undefined|-?\d+(?:\.\d+)?|"[^"\\]*"|'[^'\\]*'|`[^`$]*`)$/s.test(prop.exp.content.trim()) || bindings[prop.exp.content] === BindingTypes.LITERAL_CONST)) constants.push(camelize((prop.arg as SimpleExpressionNode).content))
                }
            }
        }

        const slots: string[] = []
        const slotNames: string[] = []
        const defaultChildren: TemplateChildNode[] = []

        for (const child of node.children) {
            const slot = child.type === NodeTypes.ELEMENT && directive(child, 'slot')

            if (slot && child.type === NodeTypes.ELEMENT) {
                const name = slot.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? slot.arg.content : 'default'
                slots.push(`${JSON.stringify(name)}: () => {\n${children(child.children)}\n}`)
                slotNames.push(name)
            } else defaultChildren.push(child)
        }

        if (defaultChildren.some(child => child.type === NodeTypes.ELEMENT)) {
            slots.push(`default: () => {\n${children(defaultChildren)}\n}`)
            slotNames.push('default')
        }

        let inputs = dynamicShape ? `${helper('parameterInputs')}([${parameters.join(', ')}], ${location(node.loc)})` : `{${fixedParameters.join(', ')}}`
        let contents = `{${slots.join(', ')}}`

        if (!options.arrangeTypecheck && !dynamicShape && !Object.values(context.identifiers).some(count => count > 0)) {
            setup.push(`const __inputs${id} = Object.freeze(${inputs})`)
            setup.push(`const __contents${id} = Object.freeze(${contents})`)
            inputs = `__inputs${id}`
            contents = `__contents${id}`
        }

        if (options.arrangeTypecheck) {
            if (dynamicShape) inputs = `{${checkParameters.join(', ')}}`
            inputs = `__arrangeCheck(${definition}, ${inputs}, ${node.loc.start.line}, ${node.loc.start.column})`
            contents = `__arrangeCheckSlots(${definition}, ${contents}, ${node.loc.start.line}, ${node.loc.start.column}, ${inputs})`
        }

        let plan = ''
        if (!options.arrangeTypecheck && !dynamicShape && (!binding || binding === BindingTypes.SETUP_CONST)) {
            const names = Object.keys(Object.fromEntries(parameterNames.map(name => [name, true])))
            setup.push(`const __parameters${id} = ${helper('prepareParameters')}(${definition}, ${JSON.stringify(names)}, ${JSON.stringify(slotNames)}, ${location(node.loc)})`)
            plan = `parameters: __parameters${id}, `
        }

        return emit(`${helper('callArrangable')}(${id}, ${definition}, ${inputs}, ${contents}, { ${plan}key: ${key(node)}, constants: ${JSON.stringify(constants)}, source: ${location(node.loc)}, sources: {${sources.join(', ')}} })`, node.loc)
    }

    const body = children(ast.children)
    const marked = setup.length ? `(() => {\n${setup.join('\n')}\nreturn () => {\n${body}\n}\n})()` : `() => {\n${body}\n}`
    const preamble = `import { ${[...helpers].map(name => `${name} as _${name}`).join(', ')} } from ${JSON.stringify(options.runtimeModuleName ?? '@arrange/framework/internal')}\n`
    let code = ''
    let line = 1
    let column = 0
    let offset = 0

    const append = (text: string) => {
        code += text
        for (const character of text) {
            if (character === '\n') {
                line++
                column = 0
            }
            else column++
        }
    }

    for (const marker of marked.matchAll(/\u0000(\d+)\u0000/g)) {
        append(marked.slice(offset, marker.index))
        const loc = locations[Number(marker[1])]
        map.addMapping({ generated: { line, column }, original: { line: loc.start.line, column: loc.start.column - 1 }, source: filename })
        offset = marker.index! + marker[0].length
    }

    append(marked.slice(offset))
    ast.transformed = true
    return { ast, code, preamble, map: JSON.parse(map.toString()) }
}
